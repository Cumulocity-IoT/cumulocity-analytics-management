# Raw-binary HTTP connectivity bundle (DIRECT_UPLOAD.md R1)

**Status: previously "confirmed blocker" — retracted, see Round 7.** Four real deploy rounds
plus first-party `apama-in-c8y` source evidence had convinced us `apama-ctrl`'s
`config/connectivity/` only ever loads a fixed platform set and extensions can't add to it. The
Analytics Builder Block SDK's *own test suite* proves that's wrong: `analytics_builder build
extension` + upload + restart **does** get a custom bundle read and connecting, in an official,
passing test. Two structural differences between that working example and ours (subdirectory
name not matching the yaml's basename; missing `.properties` file) have now been fixed here —
**not yet re-verified against a live correlator**, so treat this as a new, well-evidenced
hypothesis to test, not a confirmed fix.

## Why a connectivity bundle is required at all

The fetch/upload step needs to move a GitHub release asset (a zip) and its upload to
`/inventory/binaries` end-to-end as **exact binary bytes**, with nothing in the path re-encoding
or reinterpreting the content. Every HTTP-capable API already available to EPL code in this
project fails that requirement for one of two reasons:

- **The "generic" HTTP APIs are JSON-only, not just JSON-by-default.** `GenericRequest`
  (`reqId, method, path, queryParams, isPaging, body: any, headers`) and the
  `HttpTransport`/`Request`/`Response` API that `FetchExtensionListener.mon`'s own Identity API
  calls use are documented as *always* going through a JSON codec — this is a project-level
  choice baked in when the HTTP Client bundle was added to whatever image `apama-ctrl` runs, not
  something a caller can opt out of per-request. Sending a binary zip through a JSON codec would
  corrupt it (JSON has no lossless binary representation without an explicit encoding step the
  generic API doesn't offer).
- **The one EPL type built for raw bytes (`chunk`) can't travel through a chain to a listener.**
  ApamaDoc is explicit that *"you cannot send, emit, route, or enqueue an event that has a chunk
  type field"* — so even if something upstream produced raw bytes, there's no way to get them
  from a connectivity chain into a monitor's event listener without first converting to
  something an event can carry (this bundle uses Base64-encoded `string` for that).

The only Apama mechanism that avoids the JSON codec entirely is a **custom connectivity chain**
in "mapping to events" mode (`apama.eventMap` → codec chain → transport, defined in a
`config/connectivity/` YAML) — it can be built with only a `base64Codec` on the specific binary
field, with no JSON/String codec anywhere in the pipeline. That YAML can only be picked up by
`apama-ctrl` from an Analytics Builder **extension** `.zip`, not from an EPL App (EPL Apps have
no `config/connectivity/` of their own) — hence this bundle needing to exist as a separate
extension at all, alongside `FetchExtensionListener.mon`.

**Update, see Round 7 below**: an earlier version of this doc claimed the extension-packaging
path above doesn't work at all — that was wrong. The Analytics Builder Block SDK's own test
suite proves a custom `config/connectivity/<name>/` bundle *can* be delivered this way; our
bundle was just missing two things every real working example has (matching
subdirectory/file-basename naming, and a `.properties` file). Both are now fixed here, pending a
live retest.

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

- `config/connectivity/FetchExtension/FetchExtension.yaml` — two dynamic chains,
  `GitHubFetchChain` and `InventoryUploadChain`, each: `apama.eventMap` → `base64Codec` (binary
  payload field only) → `HTTPClientTransport`. No JSON, no String codec. Nested one level under
  its own `FetchExtension/` subdirectory, filename matching the subdirectory name — the same
  pattern every real connectivity bundle we've found follows (see "Round 7" below for why the
  filename match, not just the subdirectory nesting, turned out to matter).
- `config/connectivity/FetchExtension/FetchExtension.properties` — exists only because every
  real working example pairs a `.properties` file with its `.yaml`; see "Round 7". Not used for
  `${...}` static substitution here since `FetchExtension.yaml`'s `@{HOST}`/`@{PORT}` tokens are
  filled at runtime via `createDynamicChain()`'s `substitutions` argument instead.
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
`config/connectivity/fetch-extension-chains.yaml` — not nested. **Fix attempted**: moved it to
`config/connectivity/FetchExtension/fetch-extension-chains.yaml`, matching the subdirectory
nesting.

**Round 4 — that didn't fix it.** Redeployed clean (log confirmed the file extracted correctly
to `config/connectivity/FetchExtension/fetch-extension-chains.yaml`). Same exact `Unknown
dynamicChain GitHubFetchChain` error, and the file was still absent from the correlator's
`Reading configuration file` list — which was **byte-for-byte identical across every restart
tested** (`restEndpoint`, `CumulocityClient`, `CumulocityDeviceService`,
`CumulocityNotifications2.0`, `HTTPClientGeneric`), regardless of what any applied extension
contained.

**Round 5 — seemingly confirmed from first-party source.** Cumulocity's own `apama-ctrl` product
source (`Cumulocity-IoT/apama-in-c8y`) has exactly those same five subdirectories baked into
`src/apama-ctrl/base/config/connectivity/`, and a real customer-demo example there
(`DU-batching.mon`) that calls `ConnectivityPlugins.createDynamicChain()` only ever targets a
chain template that's already one of those five. This looked decisive enough to write up as a
**confirmed blocker** — wrongly, as Round 7 below shows.

**Round 6 — a real customer sample (`Cumulocity-IoT/apama-mqttservice-idp-poc`) checked for a
counterexample.** Its `extensions/` folder does define genuinely custom `config/connectivity/`
bundles (`mqttservice`, `binaries`) with no JSON codec — but that folder turned out to be a full
Designer/Eclipse Apama *project* (`.project`/`.dependencies` metadata, a project-root
`config/CorrelatorConfig.yaml` — meaningless for anything merged into an already-running
`apama-ctrl`), with no Dockerfile/CI/deploy script anywhere in the repo. Read as the "custom
microservice / standalone project" path, not an `analytics_builder build extension` artifact —
so it didn't move the needle either way. It did rule out one theory: neither custom bundle there
has a `.properties`/`.settings` file, so that pairing isn't universally required.

**Round 7 — the actual, decisive counterexample: the Analytics Builder Block SDK's own test
suite.** `apama-in-c8y`'s `test/block-sdk/Extensions_Plugins` runs exactly our mechanism —
`analytics_builder build extension` → `upload extension --restart` — against a `SimplePlugin`
fixture with its own `config/connectivity/HTTPClient/{HTTPClient.yaml, HTTPClient.properties,
.settings}`. The test's own assertions, against a real correlator log, prove it works:
```python
self.assertGrep('apama-ctrl.1.out', 'Reading configuration file.*HTTPClient.properties')
self.assertGrep('apama-ctrl.1.out', 'Connecting .*no.such.host.example.com')
```
This directly contradicts Round 4/5's conclusion — a custom, non-platform `config/connectivity/`
bundle delivered via an Analytics Builder extension *is* read and connected by `apama-ctrl`.
Comparing that fixture's `HTTPClient/HTTPClient.yaml` to ours turned up two real, fixable
differences, both now applied to this bundle:
1. **Naming convention**: every real example (the five platform bundles, `SimplePlugin`,
   `mqttservice`/`binaries`) has the subdirectory name match the yaml's basename exactly. Ours
   was the only mismatch (`FetchExtension/fetch-extension-chains.yaml`). **Fixed**: renamed to
   `FetchExtension/FetchExtension.yaml`.
2. **Missing `.properties` file**: every platform bundle and `SimplePlugin` pair a `.properties`
   file with the `.yaml`; ours had none. **Fixed**: added
   `FetchExtension/FetchExtension.properties` (existence-only — our substitutions are runtime
   `@{...}` tokens via `createDynamicChain()`, not static `.properties`-driven `${...}` ones).

One difference remains unexplained and untested: `SimplePlugin`'s working chain is a
`startChains:` entry (auto-started at correlator boot), while ours is `dynamicChains:` (a
template only instantiated on demand via `createDynamicChain()`). Both fixes above are
well-evidenced; whether `dynamicChains:` specifically needs anything further is the open
question the next live test will answer.

## Open/unverified specifics (flag these if the next test fails here)

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
