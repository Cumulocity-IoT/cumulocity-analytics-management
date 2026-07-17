# Raw-binary HTTP connectivity bundle (DIRECT_UPLOAD.md R1)

**Status: best-effort draft, unverified against a live correlator.** Written from documented
Apama connectivity-plugin behavior (see sources in
[DIRECT_UPLOAD.md](../../docs/features/block-marketplace/DIRECT_UPLOAD.md) R1), not from a
working test.

## What's in here, and why it's separate from FetchExtensionListener.mon

This is deliberately a **minimal** extension: just the custom connectivity chains and the event
types they map onto — nothing else. `repository/epl/FetchExtensionListener.mon` (the actual
`c8y_FetchExtension` listener/orchestration logic, verified working as an EPL App) `using`s the
event types defined here, but deliberately stays deployed separately as an EPL App rather than
being bundled into this same extension. That split matters:

- **This bundle changes rarely** (it's infrastructure — chain wiring, not business logic) and
  needs a full extension rebuild + `apama-ctrl` restart to change at all, since custom
  connectivity YAML can only be deployed that way (see below).
- **`FetchExtensionListener.mon` changes often** during iteration and stays on the fast EPL Apps
  edit/save/reload loop that already produced multiple verified rounds of test → fix. Bundling
  it into this extension would force a full rebuild+restart for every tweak to listener logic
  that has nothing to do with the connectivity chains.
- **Confirmed by a real EPL App activation failure**: *event* type definitions from this
  extension (`GitHubAssetRequest`/`Response`, `InventoryUploadRequest`/`Response`) resolve fine
  from `FetchExtensionListener.mon`'s `using` statements — but a *monitor* type
  (`RawHttpChainFactory`, since removed — see below) could not be `new`'d across that boundary;
  the EPL App failed to activate until every reference to it was deleted. Cumulocity's
  per-EPL-App namespace isolation ("event definitions from one module cannot be used in other
  modules" — EPL Apps docs) apparently applies to monitor types specifically, not to event
  types. **Practical rule for this split going forward: only exchange event types across the
  extension/EPL-App boundary, never a monitor type** — call
  `ConnectivityPlugins.createDynamicChain()` directly from the EPL App instead of wrapping it in
  a helper monitor the extension would own; it's a plain string-keyed runtime lookup against
  this bundle's YAML, not a compile-time type reference, so it isn't affected by the isolation.

## Why this needs to be an extension at all, not an EPL App

The "generic" `HttpTransport`/`Request`/`Response` API (what every verified EPL-App piece of
this project uses, including `FetchExtensionListener.mon`'s own Identity API calls) is
documented as *always* going through a JSON codec — not a runtime option, a project-level choice
baked into whatever image `apama-ctrl` runs. That would silently corrupt binary content. Getting
a raw/binary body requires a custom connectivity chain (Apama's "mapping to events" mode), which
can only be defined in a `config/connectivity/` folder inside an Analytics Builder **extension**
`.zip` — not an EPL App.

## What's in here

- `config/connectivity/fetch-extension-chains.yaml` — two dynamic chains, `GitHubFetchChain` and
  `InventoryUploadChain`, each: `apama.eventMap` → `base64Codec` (binary payload field only) →
  `HTTPClientTransport`. No JSON, no String codec.
- `monitors/RawHttpEvents.mon` — just the custom EPL event types the chains map onto
  (`GitHubAssetRequest`/`Response`, `InventoryUploadRequest`/`Response`). No helper monitor —
  `FetchExtensionListener.mon` calls `ConnectivityPlugins.createDynamicChain()` directly instead
  (see "What's in here, and why it's separate" above for why a monitor type didn't work here).

Binary content is carried end-to-end as a **Base64-encoded EPL `string`**, never raw bytes — the
EPL `chunk` type was the only other candidate and is explicitly disqualified (confirmed against
ApamaDoc: *"you cannot send, emit, route, or enqueue an event that has a chunk type field"*),
which rules it out for anything a chain has to deliver to a monitor's listener.

## Build and deploy

Same mechanism `analytics-service`'s own backend already uses to build extensions
(`analytics-service/app.py`'s `_build_extension()`), via the `analytics_builder` CLI from the
[Apama Analytics Builder Block SDK](https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk).
`repository/builder/Dockerfile` packages that CLI (same base image + SDK clone
`analytics-service/Dockerfile` uses) so you don't need Apama installed locally:

```
docker build -t apama-extension-builder repository/builder

docker run --rm \
  -v "$(pwd)/repository/connectivity-bundle:/input:ro" \
  -v "$(pwd)/dist:/output" \
  apama-extension-builder --input /input --output /output/connectivity-bundle.zip
```

**Verified working** (2026-07-17, via Docker Desktop's `linux/amd64` emulation on Apple
Silicon — the upstream image is amd64-only) — real output:
```
files/README.md
files/config/connectivity/fetch-extension-chains.yaml
files/monitors/RawHttpEvents.mon
files/events/connectivity-bundle_metadata.evt      <- auto-generated by the tool
```

1. **Confirmed by a real deploy attempt, not just a build**: `files/` nesting is fine —
   `apama-ctrl`'s own deploy tooling (`engine_deploy`) strips the `files/` prefix on extraction
   (`Extracting connectivity-bundle.zip/files/config/connectivity/fetch-extension-chains.yaml`
   → deployed at `/host_deploy/Project_extended/config/connectivity/...`), so packaging was
   never the problem.
2. **Real bug found and fixed**: that same deploy attempt failed outright —
   ```
   ERROR: Failed to generate initialization list as the project has below error(s):
   /host_deploy/Project_extended/monitors/RawHttpEvents.mon: 70: no onload action in monitor RawHttpChainFactory
   ```
   Every monitor in an Apama project needs an `onload` action for the deploy tooling's
   initialization-list generation, even one like `RawHttpChainFactory` that's only ever
   instantiated on demand (`new RawHttpChainFactory`) and has no startup work of its own.
   **Fixed**: added a no-op `onload() {}`. Not yet re-verified — next deploy attempt will show
   whether that was the only problem.
3. **Upload** — drag-and-drop the zip into `analytics-ui`'s existing "Manage extensions" →
   "Upload a *.zip file" dialog, the same one used for every other extension.
4. **Restart** — click "Restart to deploy extension" on that same page
   (`extension-grid.component.ts`'s `restartCep()`) — extensions are only read on startup.
5. Only after that restart has completed should `repository/epl/FetchExtensionListener.mon` be
   (re-)deployed as an EPL App — see its own header comment.

**Also confirmed by this attempt**: `apama-ctrl` has a crash-loop circuit breaker
("safe mode") that disables *all* extensions tenant-wide (not just this one) if it detects
repeated restarts in a row — if a future deploy attempt seems to silently not load anything,
check the logs for `apama_safe_mode` before assuming this bundle's YAML/code is the problem;
it may just need one clean restart to clear.

## Open/unverified specifics (flag these if the first test fails here)

- Exact `apama.eventMap` field-name-matching conventions for a hand-written (non-SDK-generated)
  custom event type — the docs show it working via reflection/annotation over the event's own
  fields, but every real example is SDK-generated, not hand-written.
- Whether `metadata.http.contentLength` (or equivalent) is reliably present before the body
  arrives, needed for an earlier-rejection oversized-payload guard (see R2 in `DIRECT_UPLOAD.md`
  — still no confirmed real memory ceiling, just a conservative placeholder threshold enforced
  *after* the full body is already in memory).
- **Whether `apama-ctrl` expects `config/connectivity/` at the zip root or under `files/`** — the
  build is now confirmed to produce the latter (see above); which one `apama-ctrl` actually reads
  is still open. If chains don't load after a restart, this is the first thing to check.
- ~~Whether an EPL App loaded after this extension can resolve `using` references to types this
  extension defines~~ — **resolved, see "What's in here, and why it's separate" above.** Event
  types: yes. Monitor types: no, confirmed by a real activation failure — the IDE's own error
  turned out to be correct, not a false positive as first assumed here.
