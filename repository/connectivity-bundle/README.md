# Raw-binary HTTP connectivity bundle (DIRECT_UPLOAD.md R1)

**Status: CONFIRMED BLOCKER, four real rounds against a live `apama-ctrl`.** This approach —
delivering a custom (non-JSON-codec) connectivity chain via an Analytics Builder extension
`.zip` — does not work. See "Round 4" below for the final, decisive finding, and
[DIRECT_UPLOAD.md](../../docs/features/block-marketplace/DIRECT_UPLOAD.md) R1 for the full
writeup and what to try instead if this is ever revisited. Kept in the repo as a record of what
was tried and why it failed, not as something to build on further as-is.

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

- `config/connectivity/FetchExtension/fetch-extension-chains.yaml` — two dynamic chains,
  `GitHubFetchChain` and `InventoryUploadChain`, each: `apama.eventMap` → `base64Codec` (binary
  payload field only) → `HTTPClientTransport`. No JSON, no String codec. Nested one level under
  its own `FetchExtension/` subdirectory — **confirmed required** by a real deploy failure (see
  "Build and deploy" below): every other connectivity config `apama-ctrl` actually reads follows
  this same `config/connectivity/<name>/<file>` pattern; a file dropped directly at
  `config/connectivity/<file>.yaml` (no subdirectory) is silently never read at all.
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
   **Fixed**: added a no-op `onload() {}`. That got the extension deploying cleanly (confirmed —
   see round 3 below).
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

**Round 3 — extension deployed cleanly, EPL App activated, real event flowed through — but the
chain itself was never registered:**
```
ERROR - Error on line 133 in action createDynamicChain in event com.softwareag.connectivity.ConnectivityPlugins:
PluginException - Unknown dynamicChain GitHubFetchChain (in plugin method createDynamicChain)
```
Checked the correlator's own startup log for every `config/connectivity` file it actually read —
`fetch-extension-chains.yaml` wasn't among them at all. Every config file `apama-ctrl` *did* read
follows one pattern: `config/connectivity/<name>/<file>` — one level nested inside its own named
subdirectory (`restEndpoint/restEndpoint.yaml`, `CumulocityClient/config.properties`,
`HTTPClientGeneric/HTTPClientGenericList.yaml`, etc.). Ours sat directly at
`config/connectivity/fetch-extension-chains.yaml` — not nested — so the working theory was that
the deploy tooling's aggregation step needed that same nesting. Moved it to
`config/connectivity/FetchExtension/fetch-extension-chains.yaml` to match, and rebuilt.

**Round 4 — CONFIRMED BLOCKER, not fixed by the subdirectory move.** Redeployed clean (log
confirmed `Extracting connectivity-bundle.zip/files/config/connectivity/FetchExtension/fetch-extension-chains.yaml`
landed on disk in the right place). Same exact `PluginException - Unknown dynamicChain
GitHubFetchChain` error on the next real event, and `fetch-extension-chains.yaml` was *still*
absent from the correlator's `Reading configuration file` list at startup. That list —
`restEndpoint`, `CumulocityClient`, `CumulocityDeviceService`, `CumulocityNotifications2.0`,
`HTTPClientGeneric` — has been **byte-for-byte identical across every restart tested**,
regardless of which extensions were applied or how their subfolders were named. These aren't
examples of a naming convention extensions can follow — they're a fixed set of platform-built-in
connectivity bundles baked into the base `apama-ctrl` project template. `engine_deploy`'s
`connectivity.yaml` generation does not scan `config/connectivity/` content contributed by an
uploaded Analytics Builder extension at all; it only ever includes that fixed set.

**Conclusion**: this whole approach is a dead end via `analytics_builder build extension`. The
original SDK-doc line this was based on ("building via Software AG Designer... creates a
corresponding folder inside `config/connectivity`") almost certainly describes a full Apama
*project* build (a genuinely different deployable artifact), not an Analytics Builder extension
zip.

**Round 5 — confirmed from first-party source, not just empirical inference.** Cumulocity's own
`apama-ctrl` product source repo (`Cumulocity-IoT/apama-in-c8y`) settles this definitively.
`src/apama-ctrl/base/config/connectivity/` contains exactly five subdirectories —
`CumulocityClient`, `CumulocityDeviceService`, `CumulocityNotifications2.0`, `HTTPClientGeneric`,
`restEndpoint` — **byte-for-byte the same list** every restart's `Reading configuration file`
log ever showed, confirming these are baked into the base product build, not discovered from
any extension. The repo's own top-level README describes `src/extensions` (a *different*
directory from `config/connectivity`) as *"non-productised extensions that can be applied to
apama-ctrl, e.g. `inputLog` etc"* — a narrow, separate mechanism, not a general path for adding
connectivity chains. And a real, working customer-demo example
(`customer-demos/DU-batching/DU-batching.mon`) that legitimately calls
`ConnectivityPlugins.createDynamicChain()` only ever targets a chain template name that's
*already* one of those five bundles (`HTTPClientGenericJSONChain`) — it never defines a new one.
Checked whether any of those five pre-loaded templates could be reused instead of registering
our own: no — `HTTPClientGeneric/HTTPClientGenericList.yaml` (the least JSON-committed of them)
still runs `jsonCodec`/`stringCodec`/`messageListCodec` end to end, so it would corrupt binary
content exactly like the ones already ruled out in R1's opening paragraph. There is no pre-loaded
chain to fall back to, and no way to add one via an extension.

If R1 is revisited, the real candidate is the "custom microservice" option `REQUIREMENTS.md`
already named and deferred — an actual custom `apama-ctrl` image built from a real
`src/apama-ctrl/base`-style project (or equivalent), not another variation on extension
packaging.

**Round 6 — a real customer sample (`Cumulocity-IoT/apama-mqttservice-idp-poc`) reinforces this,
doesn't contradict it.** That repo's `extensions/` folder does define genuinely custom
`config/connectivity/` bundles (`mqttservice`, `binaries` — real Pulsar/AVRO-based dynamic
chains, no JSON codec), which at first glance looks like a counterexample. It isn't one: that
folder (and its sibling `mqttclient/`) is a full Software AG Designer/Eclipse Apama *project* —
confirmed by `.project`/`.dependencies` Eclipse metadata and, decisively, a **project-root**
`config/CorrelatorConfig.yaml` (the file that configures which bundles a whole standalone
correlator process loads at startup — meaningless for anything applied as an extension to an
already-running `apama-ctrl`). No Dockerfile, CI workflow, or `cumulocity.json` exists anywhere
in that repo for `extensions/`; the only deploy script present (`deployPythonApp.py`) does
something unrelated (PUTs Python source to a `apama_PythonApp` managed object). This is a full
correlator project meant to run as its own process/microservice, not an `analytics_builder
build extension` artifact applied via Cumulocity's "Manage Extensions" upload — the exact
distinction this doc already draws between "custom microservice" and "extension packaging."

This also retires a theory raised while investigating this sample: that the missing piece might
be a `.properties`/`.settings` file (`analytics_builder build extension` is documented elsewhere
as omitting those from its output). It isn't — neither `mqttservice` nor `binaries` has a
`.settings` file either; only the standard `CumulocityNotifications2.0` bundle does. The real
dividing line is deployment mechanism (full project/own correlator vs. extension applied to a
shared `apama-ctrl`), not packaging shape.

## Open/unverified specifics (superseded — kept for the historical record)

- Exact `apama.eventMap` field-name-matching conventions for a hand-written (non-SDK-generated)
  custom event type — the docs show it working via reflection/annotation over the event's own
  fields, but every real example is SDK-generated, not hand-written.
- Whether `metadata.http.contentLength` (or equivalent) is reliably present before the body
  arrives, needed for an earlier-rejection oversized-payload guard (see R2 in `DIRECT_UPLOAD.md`
  — still no confirmed real memory ceiling, just a conservative placeholder threshold enforced
  *after* the full body is already in memory).
- ~~Whether `apama-ctrl` expects `config/connectivity/` at the zip root or under `files/`~~ —
  **resolved: neither was the real issue.** `files/` nesting is fine (deploy tooling strips it).
  What actually mattered: the YAML must sit in its own named subdirectory under
  `config/connectivity/`, not directly in it — see "Round 3" above.
- ~~Whether an EPL App loaded after this extension can resolve `using` references to types this
  extension defines~~ — **resolved, see "What's in here, and why it's separate" above.** Event
  types: yes. Monitor types: no, confirmed by a real activation failure — the IDE's own error
  turned out to be correct, not a false positive as first assumed here.
