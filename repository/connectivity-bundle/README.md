# Raw-binary HTTP connectivity bundle (DIRECT_UPLOAD.md R1)

**Status: CONFIRMED WORKING END TO END — a real GitHub release asset fetch + upload succeeded
against a live tenant (Round 29/30). This bundle now only covers the GitHub fetch half — the
upload half was removed (Round 26) in favor of the standard
`FormRequest`/`CumulocityRequestInterface` APIs, called directly from
`FetchExtensionListener.mon`, no custom connectivity chain needed. See Rounds 7–30 below for the
full history.** The earlier "confirmed blocker" call (extensions can never add to
`config/connectivity/`) was wrong — see Round 7. Rounds 8–19 got the GitHub fetch half fully
working: extension placement, `apama.eventMap`/`mapperCodec` config-schema and ordering bugs,
`HTTPClientTransport` payload-type rejections, manual redirect-following, and replacing
`base64Codec` with `stringCodec` (`encoding: Latin-1`) as the real, correct tool for this
direction — this content is **not actually Base64**, despite the bundle's history assuming it
would be. Rounds 20–25 got a *second* custom chain (`InventoryUploadChain`) to the point of
reaching Cumulocity's real `/inventory/binaries` endpoint and getting back a real HTTP response
— proof the whole approach could have worked — before Round 26 found a cleaner path entirely:
`com.softwareag.connectivity.httpclient.FormRequest`, the standard multipart API, runs over a
platform-baked-in chain that's already binary-safe for form uploads, and
`com.apama.cumulocity.CumulocityRequestInterface` handles authentication and host resolution
automatically (confirmed against its own real source: it reads `C8Y_USER`/`C8Y_PASSWORD`/
`C8Y_BASEURL` from the correlator's environment). `InventoryUploadChain` and its event types
were removed entirely — see `repository/epl/FetchExtensionListener.mon`'s `startUpload()` for
the replacement. Round 27: a real end-to-end run confirmed both halves now work mechanically -
the entire GitHub fetch (connect, redirect, reconnect, clean teardown) ran with zero errors for
the first time ever, and the new `FormRequest`/`CumulocityRequestInterface` upload path
connected, authenticated, and got back a real, structured HTTP response (`406 Not Acceptable`,
not a network/codec crash) - strong validation the whole Round 26 rewrite works. Fixed a missing
`Accept` header (the real, official `FormTest.mon` example sets this and this rewrite initially
didn't). Round 28: the fix worked - `406` became `400 Bad Request`, meaning Cumulocity is now
validating actual request content - but `onInventoryUploadResponse()` never logged the response
body, so the real validation error was invisible. Fixed the same way every prior diagnosis in
this file has (Rounds 22/25): log it unconditionally on failure, rather than guess at the cause
(a missing `build_information` field, found by checking the real browser-side reference
implementation, is one real candidate, but unconfirmed). Round 29: the logging paid off
immediately - Cumulocity's real error was `"Missing field in object. The fields 'name' and
'type' are necessary for this request"`, even though `name` was already being sent. Root cause:
`formMetadata` only declared content-type metadata for the `file` part, not `object`, so
Cumulocity never parsed the `object` part as JSON at all. Added `"object": {"contentType":
"application/json"}` and `"type": "application/zip"` to the metadata JSON itself. **Not yet
re-verified against a live correlator** - EPL App only, no extension changes this round.

## Why a connectivity bundle is required at all

The fetch/upload step needs to move a GitHub release asset (a zip) and its upload to
`/inventory/binaries` end-to-end as **exact binary bytes**, with nothing in the path re-encoding
or reinterpreting the content. Every HTTP-capable API already available to EPL code in this
project fails that requirement for one of two reasons:

- **The "generic" HTTP APIs are JSON-only for a plain GET/JSON `Request` — but not for a
  multipart `FormRequest` (see Round 26).** `GenericRequest`
  (`reqId, method, path, queryParams, isPaging, body: any, headers`) and a plain
  `HttpTransport`/`Request`/`Response` call (what `FetchExtensionListener.mon`'s own Identity
  API calls use) go through a JSON codec unconditionally, corrupting arbitrary binary content —
  confirmed still true for a raw GET response, which is why `GitHubFetchChain` here still
  exists. But `com.softwareag.connectivity.httpclient.FormRequest`, running over the *same*
  underlying platform-baked chain, turns out to bypass that codec entirely for multipart
  payloads (content-type-filtered `jsonCodec`, event-type-scoped `stringCodec`) — confirmed by
  reading the chain's own real definition, not assumed. That's why the `/inventory/binaries`
  upload no longer needs a custom chain of its own; only the raw GitHub GET does.
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
  extension (`GitHubAssetRequest`/`Response` - the only ones left, since `InventoryUploadRequest`/
  `Response` were removed in Round 26) resolve fine from `FetchExtensionListener.mon`'s `using`
  statements — but a *monitor* type
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

- `FetchExtension.yaml` (project root, not under `config/connectivity/` — see "Round 8") — one
  dynamic chain, `GitHubFetchChain`: `apama.eventMap` → `mapperCodec` → `stringCodec`
  (`encoding: Latin-1`, binary payload field only) → `HTTPClientTransport`. No JSON codec.
  `apama.eventMap`'s config was a real, confirmed bug (see "Round 9") — fixed to use
  `defaultEventType`, the only option that actually applies to a `dynamicChains:` entry. There
  used to also be an `InventoryUploadChain` here for the `/inventory/binaries` upload — removed
  in Round 26, replaced with the standard `FormRequest`/`CumulocityRequestInterface` APIs called
  directly from `FetchExtensionListener.mon`, no custom chain needed for that half any more.
- `FetchExtension.properties` (also project root) — exists only because every real working
  example pairs a `.properties` file with its `.yaml`; see "Round 7". Not used for `${...}`
  static substitution here since `FetchExtension.yaml`'s `@{HOST}`/`@{PORT}` tokens are filled at
  runtime via `createDynamicChain()`'s `substitutions` argument instead.
- `monitors/RawHttpEvents.mon` — just the custom EPL event types the chain maps onto
  (`GitHubAssetRequest`/`Response`). No helper monitor — `FetchExtensionListener.mon` calls
  `ConnectivityPlugins.createDynamicChain()` directly instead (see "What's in here, and why
  it's separate" above for why a monitor type didn't work here).

Binary content is carried end-to-end as an EPL `string` via `stringCodec`'s `encoding: Latin-1`
— a lossless byte↔char roundtrip, **not actually Base64** despite this bundle's name and
earlier revisions assuming it would be (see Round 18). The EPL `chunk` type was the only other
candidate for carrying raw bytes and is explicitly disqualified (confirmed against ApamaDoc:
*"you cannot send, emit, route, or enqueue an event that has a chunk type field"*), which rules
it out for anything a chain has to deliver to a monitor's listener.

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

**Round 8 — a third-party suggestion (put the yaml at the extension's project root, not under
`config/connectivity/` at all) tested, and it's the one that actually fixed the "Unknown
dynamicChain" error.** Moved `FetchExtension.yaml`/`FetchExtension.properties` from
`config/connectivity/FetchExtension/` to the connectivity-bundle project's own root (alongside
`README.md`, `monitors/`) and rebuilt — the builder just mirrors the input directory verbatim,
so the zip now has `files/FetchExtension.yaml` at the top level, no `config/` folder at all.
This contradicts every real example this doc has cited (all of them nest under
`config/connectivity/<name>/`) — worth flagging as inconsistent with the evidence trail above —
but the real correlator log settled it: redeployed, and `PluginException - Unknown dynamicChain
GitHubFetchChain` was **gone**, replaced by a real plugin-configuration error (see Round 9). So
whatever `apama-ctrl`'s actual extension-merge logic does with `config/connectivity/` content
from an uploaded extension, root-level placement is what got this specific YAML recognized and
its `dynamicChains:` registered. This doesn't retroactively make the `config/connectivity/`
nesting theory wrong for `startChains:`/platform bundles — it may be that dynamically-created
chains from an *uploaded extension* specifically need root placement, unlike the boot-time
`SimplePlugin` case. Not fully explained, but empirically confirmed to matter.

**Round 9 — chain registered, but a real config-schema bug in `apama.eventMap`.** Next error:
```
WARN - Exception while creating plugin apama.eventMap: Invalid configuration for host plug-in:
  unrecognized configuration property 'eventTypes' in chain github-fetch-github.com
ERROR - PluginException - Invalid configuration for host plug-in: unrecognized configuration
  property 'eventTypes' in chain github-fetch-github.com (in plugin method createDynamicChain)
```
`apama.eventMap` has no `eventTypes` option — that was carried over by mistake from
`base64Codec`'s config (which *does* have `eventTypes`, confirmed against the [official Base64
codec docs](https://github.com/Cumulocity-IoT/apama-cep/blob/main/product-doc/content/standard-connectivity-plugins/codec-connectivity-plug-ins-bundle/the-base64-codec-connectivity-plug-in.md)).
Checked every real `apama.eventMap` usage findable in `apama-in-c8y` (`restEndpoint.yaml`,
`HTTPClientGenericList.yaml`, `HTTPServer.yaml`, `DataRecorder.yaml`,
`BlockSDKConfigArgsAreNotIgnored`'s `HTTPClient.yaml`): the real options are
`defaultEventType`, `subscribeChannels`, `defaultChannel`, `allowMissing`, `suppressLoopback` —
never `eventTypes`. The decisive pattern: `subscribeChannels`/`defaultChannel` only ever appear
in `startChains:` examples; the one `dynamicChains:` example found (`HTTPServer.yaml`'s
`HTTPServerChain`) uses `apama.eventMap` with **only** `defaultEventType` — because for a
dynamic chain, channel wiring comes from `createDynamicChain()`'s own `channels`/
`defaultChannelTowardsHost` arguments at instantiation time, not the static YAML. **Fixed**:
both chains' `apama.eventMap` now declare only `defaultEventType` (the response event type
built for chain→EPL traffic; the request event going EPL→chain is already concretely typed, so
needs no declaration). `base64Codec`'s `eventTypes`/`fields` config was already correct per the
official docs and is unchanged. Rebuilt and redeployed.

**Round 10 — chain connected for real, then a genuine `HTTPClientTransport` protocol error.**
The correlator log this time showed real progress past every prior blocker:
```
<connectivity.chain.github-fetch-github.com> Connectivity chain created, subscribed to [GitHubFetchChannel-github.com]
WARN - <connectivity.HTTPClientTransport.github-fetch-github.com> Caught exception processing a request: No request Id
WARN - Failed to parse the event "{...,requestId:(null)}(null)" from github-fetch-github.com due to the error: Unknown control message
```
`GitHubFetchChain` registered and issued a real HTTP connection to `github.com:443` — but the
message that reached `HTTPClientTransport` had no `metadata.requestId`/`metadata.http.path`, so
the transport rejected it as malformed. The chain was missing a `mapperCodec` step entirely —
`apama.eventMap` alone just wraps an event's own fields under `payload.*`; it doesn't know how
to populate the `metadata.http.*`/`metadata.requestId` fields `HTTPClientTransport` actually
needs. Every real chain example that reaches an HTTP transport (`SimplePlugin`'s `HTTPClient.yaml`,
`binaries.yaml`) has a `mapperCodec` step between `apama.eventMap` and the transport for exactly
this. **Fixed**: added `mapperCodec` to both chains, mirroring those two real examples —
`copyFrom`/`defaultValue` to populate `metadata.http.path`/`metadata.http.method` on the way to
the transport, `mapFrom` to build `payload.statusCode`/`payload.payload` (matching our EPL
event's own field names) on the way back. `metadata.requestId` is a static `"0"`, not per-request
— confirmed safe since `onGitHubAssetResponse()`'s `on GitHubAssetResponse() as resp` listener
has no requestId filter (this design assumes a single in-flight fetch per dynamic chain
instance); it's purely `HTTPClientTransport`'s own internal bookkeeping requirement, unrelated to
EPL-level correlation. `InventoryUploadChain` got the analogous fix, but its POST/multipart
specifics past this point are still unverified (see below) — `GitHubFetchChain` is the only one
actually exercised by a live test so far. Rebuilt and redeployed.

**Round 11 — the request actually reached `HTTPClientTransport`, which then rejected its body
type.**
```
WARN - <connectivity.HTTPClientTransport.github-fetch-github.com> Caught exception processing a request: Incorrect type in get (you asked for buffer but it's actually map)
WARN - Failed to parse the event "{...http:{method:GET,...path:/Cumulocity-IoT/.../Abs-1.0.1.zip},requestId:0}{payload:{statusCode:400}}"...
```
`metadata.http.path`/`method`/`requestId` were all correctly populated this time (Round 10's fix
worked) — but Round 10's `mapperCodec` only ever *copied* `payload.path` into
`metadata.http.path`, never touching the original top-level `payload` field. `apama.eventMap`
auto-wraps every incoming event's fields under `payload.*`, so `payload` was still the leftover
map `{path: "..."}` by the time it reached `HTTPClientTransport` — which expects a buffer there
(the request body), not a map, and a GET has no body to give it anyway. Confirmed against the
[official Mapper codec
docs](https://github.com/Cumulocity-IoT/apama-cep/blob/develop/product-doc/content/standard-connectivity-plugins/codec-connectivity-plug-ins-bundle/the-mapper-codec-connectivity-plug-in.md):
actions run in a fixed order (`copyFrom`, `mapFrom`, `forEach`, `set`, `defaultValue`) regardless
of YAML key order, and `set` unconditionally overwrites a field. **Fixed**: added
`set: [payload: ""]` to `GitHubFetchChain`'s `towardsTransport` rules, applied after `copyFrom`
extracts the path — clearing the leftover map to an empty body. Rebuilt and redeployed.

**Round 12 — closer still: the empty string itself was the wrong payload *type*, not just the
wrong value.**
```
WARN - <connectivity.HTTPClientTransport.github-fetch-github.com> Caught exception processing a request: HTTPClient payloads must be binary buffers or dictionary having string key and either string or binary value (did you mean to use the StringCodec to encode a string to a buffer?)
```
`set: [payload: ""]` produced an EPL string, but `HTTPClientTransport` only accepts a binary
buffer or a string/binary-valued dict — never a bare string — and says so directly. **Fixed**:
added a `stringCodec` step (confirmed against the [official String codec
docs](https://github.com/Cumulocity-IoT/apama-cep/blob/develop/product-doc/content/standard-connectivity-plugins/codec-connectivity-plug-ins-bundle/the-string-codec-connectivity-plug-in.md),
which supports the same `eventTypes`/`fields` scoping as `base64Codec`), scoped to
`GitHubAssetRequest`'s `payload` field only — so it only ever encodes our empty request string
into a buffer, and never touches `GitHubAssetResponse`'s real binary body (already handled by
`base64Codec`, going the other direction). Not added to `connectivityPlugins:` — following
`mapperCodec`'s precedent from Round 10/11 (worked without a local declaration, evidently already
registered platform-wide by the base bundles), on the theory `stringCodec` is the same kind of
already-global plugin (used undeclared in `restEndpoint.yaml` too). `InventoryUploadChain`
shouldn't need this at all: its payload, once `base64Codec` decodes the `file` field, is exactly
a string-keyed dict of string/binary values — the shape `HTTPClientTransport`'s own error
message says is natively accepted, no `stringCodec` required. Rebuilt and redeployed.

**Round 13 — the connection to `github.com` itself succeeded; the next failure is specific to
following its redirect.**
```
INFO - <connectivity.HTTPClientTransport.github-fetch-github.com> Connecting to https://github.com:443
INFO - <connectivity.chain.github-fetch-github.com> Connectivity chain created, subscribed to [GitHubFetchChannel-github.com]
WARN - <connectivity.HTTPClientTransport.github-fetch-github.com> {0} Failed to perform HTTP redirect: Incorrect type in get (you asked for integer but it's actually string)
```
Real progress: the request now leaves the correlator, connects to GitHub, and gets far enough
to receive a redirect response (GitHub release assets 302 to an S3-backed host — expected). The
failure is specifically in *following* that redirect, not in the original request, which is the
key clue: `metadata.requestId` was set to the quoted string `"0"` via `defaultValue`. The
initial send tolerated that; `HTTPClientTransport`'s own internal request-tracking, exercised
specifically when reconstructing the follow-up request for a redirect, requires it to be an
actual integer. **Fixed**: changed `metadata.requestId: "0"` to the unquoted YAML integer
`metadata.requestId: 0` in both chains (`InventoryUploadChain`'s untested but given the same
fix preemptively, since the bug is generic to `HTTPClientTransport`, not GitHub-specific).
Rebuilt and redeployed.

**Round 14 — the real cause: identical error persisted. `requestId` typing wasn't it at all.**
```
WARN - <connectivity.HTTPClientTransport.github-fetch-github.com> {0} Failed to perform HTTP redirect: Incorrect type in get (you asked for integer but it's actually string)
```
Same exact error, unchanged, on a real retest — Round 13's fix (still correct, still kept) was
not the cause. The other `@{...}`-substituted, non-string field is `port` — tried unquoting it
next (`port: @{PORT}`), which the IDE's own YAML linter immediately rejected: `@` is a YAML
reserved character, invalid as the start of an unquoted scalar. That's decisive: every real
chain we've cited quotes its `@{...}` tokens regardless of the target field's type
(`tls: "@{tls}"`, `numClients: "@{numClients}"` in `binaries.yaml`), which only makes sense if
Apama's substitution mechanism coerces the resolved value to the field's declared config-schema
type *after* substitution — meaning neither `requestId` nor `port` quoting was ever the bug.
Reverted the invalid unquoted `port`.

Checked the [official HTTPClientTransport
docs](https://github.com/Cumulocity-IoT/apama-cep/blob/develop/product-doc/content/standard-connectivity-plugins/the-http-client-transport-connectivity-plug-in-bundle/configuring-the-http-client-transport.md)
for `followRedirects` directly, and found the real cause in the very first sentence: *"For
security reasons, redirects to a different host or to a different protocol... are not
followed."* GitHub release assets always redirect cross-host (`github.com` → an S3-backed CDN
host) — exactly the case this transport refuses to follow automatically, regardless of
`followRedirects`. The "Incorrect type in get" error is this transport hitting some internal
edge case while attempting a redirect it was never going to complete by design — not a
type/config bug in our YAML at all.

**Fixed properly, not just worked around**: set `followRedirects: false` and handle the
redirect in EPL instead, following the exact pattern in that documentation suite's own
[worked redirect
example](https://github.com/Cumulocity-IoT/apama-cep/blob/develop/product-doc/content/standard-connectivity-plugins/the-http-client-transport-connectivity-plug-in-bundle/mapping-events-between-epl-and-http-client-requests.md)
(`payload.resource: metadata.http.headers.location`):
1. `GitHubFetchChain`'s `mapperCodec` now also maps `payload.location: metadata.http.headers.location`
   (confirmed field name against that same doc page) — empty/absent for a normal 200 response,
   since `allowMissing: true` is already set.
2. `RawHttpEvents.mon`'s `GitHubAssetResponse` gained a `location` field.
3. `FetchExtensionListener.mon`: `startFetch()` now delegates to a new `startFetchAt(requestId,
   url, name, redirectDepth)`; `onGitHubAssetResponse()` checks for a 301/302/303/307/308
   status with a non-empty `location` and calls `startFetchAt()` again against that URL
   (`redirectDepth + 1`), bounded by a new `MAX_REDIRECTS := 5` constant to prevent a redirect
   loop from running forever.

Both the extension *and* the EPL App need redeploying for this round (`RawHttpEvents.mon`'s new
field is part of the extension; `FetchExtensionListener.mon`'s redirect-following logic is part
of the EPL App). Rebuilt and redeployed.

**Round 15 — the redirect itself now arrives with no `HTTPClientTransport` error at all; the
last bug was ours.**
```
WARN - Failed to parse the event "...{payload:{statusCode:302},location:https://release-assets.githubusercontent.com/...}"
  from github-fetch-github.com due to the error: Unable to parse event ...GitHubAssetResponse:
  Incoming event map does not contain a value for statusCode and missing entries are not allowed
```
Real, decisive progress in this log: no more transport-level exception anywhere — the 302 and
its full `Location` URL (signed S3 query string included) arrived cleanly. The only remaining
problem is entirely in our own `mapperCodec` output shape: the dump shows
`payload:{payload:{statusCode:302},location:...}` — `statusCode` landed *nested inside*
`payload.payload`, not at `payload.statusCode` directly, so `apama.eventMap` couldn't find it
to build `GitHubAssetResponse`. Root cause: Round 10's `mapFrom` list ran
`payload.statusCode: metadata.http.statusCode` **before** `payload.payload: payload`. Per the
[official Mapper codec
docs](https://github.com/Cumulocity-IoT/apama-cep/blob/develop/product-doc/content/standard-connectivity-plugins/codec-connectivity-plug-ins-bundle/the-mapper-codec-connectivity-plug-in.md),
rules run in the order listed, and *"if setting a payload field on a payload that is not a
map, the payload is first overwritten with an empty map"* — the top-level `payload` arrives as
a raw binary buffer, so setting the nested `payload.statusCode` field first silently wiped it
to `{}` before the next rule could copy the real body into `payload.payload`. The real,
confirmed-working `binaries.yaml` example orders its equivalent rule
(`payload.payload.data: payload`) *first*, for exactly this reason — ours had it backwards.
**Fixed**: reordered both chains' `"*": towardsHost: mapFrom:` lists to capture
`payload.payload: payload` before any other rule touches `payload`. Rebuilt and redeployed.

**Round 16 — `statusCode` parsed fine this time (Round 15's fix worked); one more codec-scoping
bug, exposed specifically by an empty response body.**
```
WARN - Failed to parse the event "...{payload:[],location:https://release-assets.githubusercontent.com/...}" from
  github-fetch-github.com due to the error: Unable to parse event ...GitHubAssetResponse: Unable to parse
  string from the buffer '[]': Invalid datatype, could not cast to string
```
GitHub's 302 has `content-length: 0` (visible in the response headers logged) — no body at
all — so `payload.payload: payload` correctly captured an empty *buffer*. The problem: that
buffer never got converted to a string by `base64Codec`, so `apama.eventMap` failed trying to
cast a raw buffer straight into `GitHubAssetResponse.payload` (an EPL `string`). Root cause:
`base64Codec`'s `eventTypes:` scoping filters by the message's `sag.type` metadata - but on the
`towardsHost` (response) side, `sag.type` isn't assigned until `apama.eventMap`'s
`defaultEventType` runs, which is the *last* step in this direction, after `base64Codec`. The
`eventTypes` filter therefore never matched anything, and `base64Codec` silently skipped every
response, on every prior round too - this bug was always there, just never surfaced until a
response happened to have an empty body (a non-empty buffer error-casts differently, or perhaps
would have surfaced the same way; this is the first response that got far enough to hit it).
The real, confirmed-working `binaries.yaml` example never has this problem because its
`base64Codec` is completely unscoped (bare `- base64Codec`, no `eventTypes`/`fields` at all).
**Fixed (superseded by Round 17 below — this fix was too broad)**: removed `eventTypes:` from
`GitHubFetchChain`'s `base64Codec`, keeping only `fields: [payload]` — reasoned as safe since
this chain only ever carries `GitHubAssetRequest`/`Response` anyway. `InventoryUploadChain`'s
`base64Codec` was left alone: it's scoped on the *outbound* (request) side, where `sag.type` is
already set correctly (the event is concretely typed when sent from EPL) before `base64Codec`
runs. Rebuilt and redeployed.

**Round 17 — Round 16's fix broke the direction it hadn't touched.**
```
WARN - <connectivity.base64Codec.github-fetch-github.com> Error while transforming message: Field 'payload' :
  Incorrect type in get (you asked for buffer but it's actually string); Message<metadata={...,
  sag.type:apamax.blockmarketplace.fetchextension.raw.GitHubAssetRequest,...}, payload=> will be dropped.
```
Unscoping `base64Codec` entirely meant it now ran unconditionally on the *outbound*
`GitHubAssetRequest` too — whose `payload` field is the plain empty string `""` (set by
`mapperCodec`'s `set` rule), not a buffer. `base64Codec` going `towardsTransport` expects to
*encode* a buffer to base64, and errored trying to read a string as one; the request was
dropped before ever reaching `HTTPClientTransport`. Round 16's own diagnosis of the inbound
problem was correct — `sag.type` really isn't assigned for a response until
`apama.eventMap`'s `defaultEventType` runs, the last step in that direction — but the fix
needed to solve *that* specifically, not remove scoping altogether and break the outbound case
that was already working.

**Fixed properly**: restored `base64Codec`'s `eventTypes: [GitHubAssetResponse]` scope (so
outbound `GitHubAssetRequest` is correctly skipped again), and added a `classifierCodec` step
to assign `sag.type` early on the inbound path, *before* `base64Codec` runs there:
```yaml
- classifierCodec:
    rules:
      - apamax.blockmarketplace.fetchextension.raw.GitHubAssetResponse:
          - metadata.http.statusCode:
```
The empty rule value matches on the field merely being *present* (the same catch-all pattern
used in the official Mapper codec docs' own worked example, e.g. `- InternalError: -
metadata.http.statusCode:`) — `metadata.http.statusCode` is always set on a response and never
set on an outbound request before it's sent, so this rule can only ever fire in the inbound
direction; it can't misfire the other way. Positioning matters just as much as the rule
content: the chain list order (`apama.eventMap → mapperCodec → base64Codec → classifierCodec →
stringCodec → HTTPClientTransport`) means `towardsHost` (inbound) processing runs
bottom-to-top, so `classifierCodec`, sitting *below* `base64Codec`, now runs *before* it on
that path — tagging `sag.type` in time for `base64Codec`'s `eventTypes` scope to actually
match. Not added to `connectivityPlugins:` — following the same precedent as `mapperCodec`/
`stringCodec` (undeclared, evidently already registered platform-wide). Rebuilt and redeployed.

**Round 18 — `classifierCodec` worked exactly as designed; `base64Codec` itself was the wrong
tool, not a scoping problem at all.**
```
WARN - <connectivity.base64Codec.github-fetch-github.com> Error while transforming message: Field 'payload' :
  Incorrect type in get (you asked for string but it's actually buffer); Message<metadata={...,
  sag.type:apamax.blockmarketplace.fetchextension.raw.GitHubAssetResponse,...statusCode:302,...}, payload=[]>
  will be dropped.
```
`sag.type` is confirmed correctly set to `GitHubAssetResponse` in this log — `classifierCodec`
worked. `base64Codec`'s `eventTypes` scope now matched, and it still failed, with the *opposite*
type complaint from Round 16 (`asked for string but it's actually buffer`, not the other way
round). That flip was the real signal: re-reading `base64Codec`'s own docs literally settles
it. Its direction semantics are fixed, not adaptive:
- `towardsTransport` (outbound): field must be a **buffer**; the codec **encodes** it to a
  Base64 string.
- `towardsHost` (inbound): field must be a **Base64 string already**; the codec **decodes** it
  to a buffer.

Our raw HTTP response body is a genuine buffer straight off the wire — GitHub never
base64-encodes response bodies. `towardsHost` needed the *encode* operation (buffer→string),
but `base64Codec` only offers *decode* on that side. No scoping fix, ordering fix, or
`classifierCodec` trick could ever have closed that gap — `base64Codec` fundamentally isn't
built to encode inbound binary into a string; it assumes the wire already carries Base64 text
(e.g. a JSON API with a base64-encoded field), which was never true for a raw HTTP GET/download.
This also means `InventoryUploadChain`'s `base64Codec` usage (on `payload.file`, outbound) was
*also* backwards — needing decode (string→buffer, to send real bytes as the multipart body),
while `base64Codec` outbound only offers encode — just never caught yet since that chain hasn't
been exercised by a live test.

`stringCodec`'s own docs describe the *opposite*, correct pairing for both chains:
`towardsTransport` converts string→buffer; `towardsHost` converts buffer→string — exactly what
both directions need here. Its default `encoding: UTF-8` isn't safe for arbitrary binary (a zip
file has no guarantee of being valid UTF-8), so this uses `encoding: Latin-1` instead — a
lossless 1-byte-to-1-character mapping (every byte 0–255 round-trips exactly), covering the same
need Base64 was originally chosen for (getting arbitrary binary safely through an EPL `string`
field, since `chunk` can't cross an event boundary) without actually needing real Base64 at all.

**Fixed**: replaced `base64Codec` with `stringCodec` (`encoding: Latin-1`) in both chains —
`GitHubFetchChain`'s `payload` field and `InventoryUploadChain`'s `payload.file` field. Neither
needs `eventTypes` scoping any more (field-scoping alone is enough, and direction is now
correctly handled by the codec itself), so `classifierCodec` — Round 17's workaround for
`base64Codec`'s scoping/timing problem — is no longer needed either; removed. Also removed the
`base64Codec:` entry from `connectivityPlugins:` (nothing references it any more), and updated
every "Base64" reference in `RawHttpEvents.mon`, `FetchExtensionListener.mon` (including
renaming `MAX_ASSET_BASE64_LENGTH` → `MAX_ASSET_LENGTH`, with a corrected byte-count value —
Latin-1 has no size overhead, unlike Base64's real 4/3 expansion, so the same 20&nbsp;MB ceiling
is now a direct byte count) and this bundle's naming/comments that assumed real Base64. This
bundle's *name* (`connectivity-bundle`, "Raw-binary HTTP connectivity bundle") still accurately
describes what it does; only the specific encoding mechanism changed. Rebuilt and redeployed.

**Round 19 — the redirect was followed successfully, real content came back, and one small
`mapperCodec` gap was all that was left.**
```
INFO - <connectivity.chain.github-fetch-release-assets.githubusercontent.com> Connectivity chain created,
  subscribed to [GitHubFetchChannel-release-assets.githubusercontent.com]
WARN - Failed to parse the event "...content-length:1544,...statusReason:OK,...method:GET},requestId:0}{}"
  from github-fetch-release-assets.githubusercontent.com due to the error: Unable to parse event
  ...GitHubAssetResponse: Incoming event map does not contain a value for location and missing entries
  are not allowed
```
This is the real milestone: `startFetchAt()`'s redirect-following (Round 14) worked exactly as
designed — a second dynamic chain was created against `release-assets.githubusercontent.com`
(the actual S3-backed asset host from the `Location` header), and it received a genuine `200
OK` with `content-length:1544` — the actual file bytes, for the first time in this whole
investigation. The only remaining problem: this normal 200 response has no `Location` header at
all (correctly, it's not a redirect), so `payload.location`'s `mapFrom` rule
(`metadata.http.headers.location` as source) had nothing to map and never created the
`payload.location` key at all — not even as an empty value, the key was simply *absent*.
`allowMissing: true` didn't help here because it only suppresses `mapperCodec`'s own error when
a rule's source is missing; it doesn't make `apama.eventMap`'s separate, later construction
step tolerate a missing key - every field of the target event type still needs a value there,
regardless of `allowMissing`. **Fixed**: added a `defaultValue: [payload.location: ""]`,
which - per the Mapper codec's fixed action order (`copyFrom, mapFrom, forEach, set,
defaultValue`) - runs after `mapFrom` and backfills the key whenever that rule didn't create
it. Rebuilt and redeployed - this was the first round with a real, non-empty asset body in
play, so it was also the first real test of `MAX_ASSET_LENGTH`/`startUpload()`/
`InventoryUploadChain` end to end.

**Round 20 — two real, independent bugs on `InventoryUploadChain`'s first live exercise.**
```
INFO - <connectivity.chain.inventory-upload-empty> Connectivity chain created, subscribed to [InventoryUploadChannel-empty]
WARN - <connectivity.HTTPClientTransport.inventory-upload-empty> {0} Caught exception processing a request:
  Incorrect type in get (you asked for buffer but it's actually map)
```
1. **`uploadHost` resolved to the literal string `"empty"`, not a real hostname** - visible
   directly in the chain/channel names (`inventory-upload-empty`,
   `InventoryUploadChannel-empty`). `resolveUploadHost()`'s `dictionary<any,
   any>.getOrDefault(<any> "domain")` returns an empty `any` when the `"domain"` key is
   missing, and calling `.valueToString()` on *that* produces the literal text `"empty"` - a
   genuine EPL gotcha, not a real value. That string has `length() > 0`, so the existing check
   (`if uploadHost.length() > 0`) wrongly treated it as a successfully resolved hostname, and
   every downstream chain then tried to connect to a host literally named `empty`. **Fixed**:
   check `body.hasKey(<any> "domain")` first, instead of trusting `.valueToString()`'s length.
   Whether the real Cumulocity tenant response genuinely lacks a `"domain"` field, or it's
   nested somewhere this code isn't looking, is still open - the error branch already logs the
   raw body, so the next test's logs should show the real shape if this still fails.
2. **`InventoryUploadChain`'s outbound `mapperCodec` was missing the same restructuring
   `GitHubFetchChain` needed back in Round 11** - simply never caught until this chain was
   finally exercised for real. `apama.eventMap` auto-wraps every field of our concretely-typed
   `InventoryUploadRequest` event under `payload.*` - and since the event's own fields happen
   to be named `payload` and `metadata` too, that produced `payload.payload = {file,
   managedObject}` and `payload.metadata = {contentType}`, not the flat `{file, managedObject}`
   dict directly at the top-level `payload` `HTTPClientTransport` actually needs (confirmed
   against its own docs: *"If the payload is a dictionary, then `metadata.contentType` must be
   set to... `multipart/form-data`"*). **Fixed**: added `mapFrom: [payload: payload.payload,
   metadata.contentType: payload.metadata.contentType]`, promoting both up to where the
   transport expects them - `mapFrom`, not `set`/`copyFrom`, for the same reason Round 15's fix
   needed it: read the nested source before anything else touches the container.

Both the extension (`FetchExtension.yaml`) and the EPL App (`FetchExtensionListener.mon`'s
`resolveUploadHost()`) need redeploying this round. Rebuilt and redeployed.

**Round 21 — retest, `uploadHost` still `"empty"`; likely only the EPL App had been
redeployed, not the extension.** The `InventoryUploadChain` "buffer but map" error was also
unchanged from Round 20, which pointed the same way - if the extension zip's `mapperCodec` fix
never actually reached the running `apama-ctrl`, its behavior wouldn't change either. Rather
than guess at a *third* `uploadHost` fix without more information, `resolveUploadHost()` was
changed to log the raw `/tenant/currentTenant` body unconditionally (not just in the failure
branch) and to also reject a resolved value that's literally the string `"empty"`, so the next
full test's logs would show the real body shape regardless of which branch fired.

**Round 22 — the raw body settled it: this tenant's response has no `domain` field at all.**
```
ERROR - FetchExtensionListener: GET /tenant/currentTenant had no usable 'domain' field - see raw body logged above
```
The unconditional logging from Round 21 paid off immediately - the real, full raw body was
right there in the log, and grepping through it confirmed `domain` simply isn't one of its
keys (not a missing-value quirk, not a nesting problem - the field doesn't exist for this
tenant). But the *same* raw body's tail showed something reliably usable instead: every
Cumulocity resource object in that dump - each nested application, each owner - carries its
own `self` URL, and `/tenant/currentTenant`'s own response is no exception (it ends in
`.../tenant/currentTenant`). **Fixed**: `resolveUploadHost()` now reads `body`'s own `self`
field and reuses `splitUrl()` (already proven against real GitHub URLs) to extract just the
host from it, instead of a `domain` field this tenant doesn't have. Updated
`uploadHost`/`resolveUploadHost()`'s doc comments to match. Rebuilt and redeployed.

**Round 23 — a second real test run (after Round 22's fix) failed outright, on a completely
different bug: dynamic chain instances were never being destroyed.**
```
ERROR - PluginException - Cannot create a chain instance with duplicate id "github-fetch-github.com"
  (in plugin method createDynamicChain)
WARN - Ignoring top-level exception because ondie() is not present
```
`resolveUploadHost()`'s fix worked (this failure happens later, inside `startFetchAt()`,
meaning `uploadHost` resolved fine) - but the very first real `createDynamicChain()` call in
this new test run collided with the *previous* test run's chain instance, which was still
alive under the exact same id (`"github-fetch-" + host`, with no per-request uniqueness at
all). Checked `ConnectivityPlugins.mon`'s real source
(`Cumulocity-IoT/apama-cep`'s `apama-src/correlator-plugins/connectivity/monitors/ConnectivityPlugins.mon`):
`createDynamicChain()` returns a `Chain` object specifically so callers can call `.destroy()`
"once" when done with it - every call site in this file had been discarding that return value
entirely, so no chain instance was *ever* destroyed, across every round of testing so far. This
also confirms a risk flagged earlier in this conversation (before it had any concrete evidence):
two genuinely concurrent top-level fetches to the same host would collide the same way, since
the id was never unique per-request either.

**Fixed**: both `startFetchAt()`/`onGitHubAssetResponse()` and `startUpload()`/
`onInventoryUploadResponse()` now capture the returned `Chain`, thread it through to the
response handler as a parameter, and call `.destroy()` there - unconditionally, before deciding
what to do next (a redirect creates a fresh chain for the next hop regardless; success/failure
need this one no further either way). Chain and channel ids now also include `requestId`, not
just the host, closing the concurrent-request collision risk in the same change. Rebuilt and
redeployed.

**Round 24 — a full real run showed the fetch side working perfectly; `InventoryUploadChain`
still failed with the identical error Round 20 was supposed to fix.** With Round 23's lifecycle
fix deployed, a real end-to-end log showed exactly the intended sequence: GitHub connect →
redirect followed → old chain destroyed → new chain to the CDN host → asset received → that
chain destroyed → `uploadHost` resolved correctly to the real tenant domain → upload chain
created. Real, working proof that Rounds 14/19/22/23 all hold up together in one continuous
run. But the very next step failed with the exact same
```
WARN - Caught exception processing a request: Incorrect type in get (you asked for buffer but it's actually map)
```
byte-for-byte identical to Round 20's original report. Several exchanges were spent
suspecting (and, at least once, confirming) a stale deployment - the extension zip genuinely
hadn't reached the running `apama-ctrl` more than once during this investigation - before a
rebuild-and-confirm cycle ruled that out for certain this time: the fix was verifiably present
in the deployed zip, yet the identical failure persisted.

That forced a re-examination of the fix itself, which turned up a real bug hiding inside a fix
that looked correct on inspection: the two `mapFrom` rules
```yaml
mapFrom:
  - payload: payload.payload
  - metadata.contentType: payload.metadata.contentType
```
run in listed order (same fixed-order rule from Round 15), and the first one **replaces the
entire top-level `payload` container** with just `{file, managedObject}` - which destroys the
sibling key `payload.metadata` in the process, since reassigning the whole `payload` variable
wipes every key it previously held, not only `payload.payload`. By the time the second rule
tried to read `payload.metadata.contentType`, that path no longer existed - so
`metadata.contentType` (top-level) was never actually set, `HTTPClientTransport` had no way to
know this was a multipart request, and defaulted to buffer-handling on what was, by then,
correctly a dict. **Fixed**: swapped the order - read `metadata.contentType` out of
`payload.metadata` *first*, while it still exists, then replace `payload` with the promoted
file/managedObject dict second. Rebuilt and redeployed.

**Round 25 — the multipart request actually reached Cumulocity's real Inventory API. Two
issues left, both concrete and well-evidenced, not guesses.**
```
WARN - Can't find filename in the form metadata. Data will be sent as a string not as a binary payload
WARN - Failed to parse the event ...statusReason:Unauthorized,...content-type:application/vnd.com.nsn.cumulocity.error+json...
  payload:[0x7B,0x22,0x6D,...] due to the error: Unable to parse string from the buffer... Invalid datatype, could not cast to string
```
Real, decisive confirmation Round 24's fix worked: the first `WARN` is `HTTPClientTransport`
correctly recognizing the multipart dict (just noting it couldn't find a `filename` field, a
minor detail, not an error) and sending a genuine request. The `401 Unauthorized` with a
correctly-decoded JSON error body (`"Full authentication is required to access this resource"`,
hex-decoded from the raw bytes in the log) is a *real HTTP response from the real Cumulocity
API* - proof the entire connectivity/encoding pipeline works end to end. Two real, separate
issues surfaced by this success:
1. **The response body itself failed to parse** - `InventoryUploadChain`'s `stringCodec` was
   only ever scoped to the outbound `payload.file` field; it had no equivalent for the inbound
   response body, the exact gap Round 18 fixed for `GitHubFetchChain`'s response side, just
   never carried over here since this chain hadn't received a real response body until now.
   **Fixed**: added the bare `payload` field alongside `payload.file` in the same `stringCodec`
   instance.
2. **No authentication was ever configured** - the `HTTPClientTransport` config's
   `authentication:` block had been commented out since this bundle's very first draft
   (flagged in `DIRECT_UPLOAD.md` from the start as "Authentication for step 2 is not free").
   Investigated properly before guessing at credentials: `GenericRequest`'s own authentication
   turns out to be handled entirely by `apama-ctrl`'s internal microservice-to-platform
   bootstrap layer, beneath the connectivity-plugin YAML entirely - not something a raw
   `HTTPClientTransport` chain can reuse (that's a generic plugin for *any* external HTTP
   endpoint, unlike the special-purpose Cumulocity IoT transport). Confirmed against
   Cumulocity's own official microservice-runtime docs
   (`Cumulocity-IoT/c8y-docs`): every microservice container — and `apama-ctrl` runs as one —
   gets `C8Y_USER`/`C8Y_PASSWORD` injected as OS environment variables automatically (the
   application user's own credentials, for `PER_TENANT` isolation, which matches a
   single-tenant `apama-ctrl` deployment). **Fixed**: uncommented the `authentication:` block,
   using `${C8Y_USER}`/`${C8Y_PASSWORD}` (not the placeholder `CUMULOCITY_USERNAME`/`PASSWORD`
   names this had before, never confirmed real) and `authenticationType: HTTP_BASIC` (not
   `basic`, also never a valid value - confirmed against the official docs' enum:
   `HTTP_BASIC`/`HTTP_DIGEST`/`none`). Whether the correlator's `${...}` substitution can
   actually see these OS env vars specifically (versus only a `.properties` file or explicit
   correlator command-line args, per `HTTPClientTransport`'s own docs) is **not yet
   confirmed** - this is the next real open question, testable only against a live correlator.
   Rebuilt.

**Round 26 — a real, unprompted proposal ("can't we use the standard HttpTransport with a
FormRequest?") turned out to be right, and simpler than everything Rounds 20–25 built.**
Investigated properly rather than assumed - read the real event definitions
(`Cumulocity-IoT/apama-cep`'s `HTTPClientEvents.mon`), the real chain they run over
(`HTTPClientGeneric/HTTPClientGenericList.yaml`, one of the five platform-baked-in bundles), and
a real official test (`Cumulocity_cor_1029/Input/FormTest.mon`) that uses this exact API against
this exact endpoint (`/inventory/binaries`). Three things fell out of that reading, all
confirmed against real source, not assumed:
1. **`FormRequest` is binary-safe on this chain for the reason Round 18 already established
   mattered**: the chain's `jsonCodec` has `filterOnContentType: true` (skips anything whose
   `metadata.contentType` isn't `application/json` - `FormRequest`'s own `mapperCodec` rule sets
   it to `multipart/form-data`), and `stringCodec` is scoped to plain `Request`/`Response` event
   types, not `FormRequest`. So a `FormRequest` payload passes through untouched by either
   codec - no custom chain, no Latin-1 detour needed for this half.
2. **`FormRequest`'s own `formMetadata` field** (`dictionary<string, dictionary<string,
   string>>`, e.g. `{"file": {"filename": ..., "contentType": ...}}`) is almost certainly what
   Round 25's `"Can't find filename in the form metadata"` warning was pointing at - our
   hand-built multipart dict never supplied this at all.
3. **`com.apama.cumulocity.CumulocityRequestInterface`** (confirmed against its own real source,
   `Cumulocity_RequestInterface.mon`) is the officially documented way to call Cumulocity's own
   APIs from EPL, and reads `C8Y_USER`/`C8Y_PASSWORD`/`C8Y_BASEURL` from the correlator's own
   environment (`com.apama.correlator.Component.getInfo("envp")`) automatically when running in
   microservice mode - which also *resolves* Round 25's open question (can EPL read these env
   vars at all) rather than leaving it untested: yes, via `Component`, just not via `${...}`
   YAML substitution the way this bundle's own chains use it.

**Net effect**: `InventoryUploadChain` and its `InventoryUploadRequest`/`Response` event types
are gone entirely from this bundle. `repository/epl/FetchExtensionListener.mon`'s
`startUpload()` now builds a `FormRequest` via `CumulocityRequestInterface.connectToCumulocity()`
directly, with `object`/`file` as the multipart field names (Cumulocity's real, documented
`/inventory/binaries` convention - not `managedObject`, an earlier revision's unconfirmed
guess). Response correlation uses this file's own `on Response(id = ...) as resp { ... }`
closure pattern (matching every other request/response call in this file) rather than
`FormRequest.execute()`'s callback parameter, since that takes a plain `action<Response>` with
no confirmed way to bind extra context (`requestId`) in EPL. This bundle now only needs to cover
the GitHub fetch half; the upload half is untested against a live correlator on this new path.

**Round 27 — a real end-to-end run confirmed the whole Round 26 rewrite works mechanically; one
missing header left.**
```
INFO - <connectivity.HTTPClientTransport.github-fetch-github.com-73vpq6> {0} Connecting to https://github.com:443
INFO - <connectivity.chain.github-fetch-github.com-73vpq6> Connectivity chain created, subscribed to [...]
INFO - Connectivity chain shutdown completed; reason: Chain destroyed by EPL
INFO - FetchExtensionListener: following redirect for requestId=73vpq6 to https://release-assets.githubusercontent.com/...
INFO - <connectivity.HTTPClientTransport.github-fetch-release-assets.githubusercontent.com-73vpq6> {0} Connecting to https://release-assets.githubusercontent.com:443
INFO - Connectivity chain shutdown completed; reason: Chain destroyed by EPL
ERROR - FetchExtensionListener: upload failed for requestId=73vpq6, statusCode=406 statusMessage=Not Acceptable
```
Two real, decisive confirmations in this one log: the entire GitHub fetch flow (connect,
redirect to the S3-backed CDN host, reconnect, clean chain teardown on both hops) ran with
**zero errors, for the first time in this whole investigation** - Rounds 14/19/23's fixes all
holding up together in one continuous real run. And the new upload path connected to
Cumulocity's real API, authenticated (implicitly - a `406`, not a `401`, means it got past auth
entirely), and returned a real, structured HTTP response - no network error, no codec crash.
Strong validation the whole `FormRequest`/`CumulocityRequestInterface` design from Round 26 is
sound. The remaining problem was mundane: no `Accept` header on the request. The official
`FormTest.mon` example (the same real, first-party test that confirmed this whole approach)
explicitly sets `r.setHeader("accept", "application/json")` - missed in the Round 26 rewrite.
**Fixed**: added the same header. EPL App only; rebuilt and redeployed.

**Round 28 — the `Accept` fix worked; `406` became `400 Bad Request` - but with no visibility
into why.**
```
ERROR - FetchExtensionListener: upload failed for requestId=g12mub, statusCode=400 statusMessage=Bad Request
```
Progress, not a regression: `400` means Cumulocity got far enough to actually validate the
request's content and reject it as malformed - a fundamentally different, more specific
failure than `406`'s pure content-negotiation rejection. But `onInventoryUploadResponse()`
never logged the response body at all, so the real validation error (which Cumulocity's API
almost always returns as a JSON error body, exactly like the real `401` body decoded in Round
25) was invisible - guessing at the cause here would repeat exactly the mistake this file's own
history keeps warning against.

One real, unconfirmed candidate surfaced while checking the actual browser-side reference
implementation for the `object` part's shape (`analytics-ui/src/shared/wizard/
extension-add.component.ts`): a **new** extension's real metadata object is
`{pas_extension: name, name: name, build_information: buildInformation}` - our EPL code sends
only `{name, pas_extension}`, missing `build_information` entirely (data this server-side code
has no way to produce without replicating `analyzeZipContent()`'s ZIP-parsing logic in EPL, a
nontrivial undertaking). This may or may not be what Cumulocity is actually rejecting - **not
yet confirmed**.

**Fixed for diagnosis, not a guessed content fix**: `onInventoryUploadResponse()` now logs
`resp.payload.data.valueToString()` (the `AnyExtractor`'s own underlying `any` field)
unconditionally on failure - the same logging-before-guessing principle that already resolved
the `uploadHost`/`domain` question (Round 22) and confirmed the real `401` error body (Round
25). Rebuilt and redeployed.

**Round 29 — the logging paid off immediately: Cumulocity's real validation error, and it
wasn't the `build_information` theory at all.**
```
ERROR - FetchExtensionListener: upload failed for requestId=l6hloa, statusCode=400 statusMessage=Bad Request
  body={error:"inventory/Bad Request", info:"https://cumulocity.com/api/core/",
  message:"Missing field in object. The fields 'name' and 'type' are necessary for this request."}
```
The genuinely puzzling part: `metadataJson` already included `"name"`, but Cumulocity reported
it missing anyway - a strong signal the `object` multipart part wasn't being parsed as JSON at
all, not that a field was actually absent from it. `FormRequest`'s `formMetadata` is per-part,
and this bundle's only entry was for `"file"` (`filename`/`contentType`) - `"object"` had no
metadata at all, so Cumulocity had no declared content-type to know it should parse that part
as JSON rather than treat it as an opaque blob (explaining why *both* `name` and `type` read as
"missing", even with `name` genuinely present in the string). **Fixed**: added `"object":
{"contentType": "application/json"}` to `formMetadata`, and added the actually-missing `"type":
"application/zip"` field to `metadataJson` itself (Cumulocity's error named both fields as
required; only one was a real content gap). EPL App only; redeployed - **the upload succeeded**,
confirmed via the real extension appearing in Cumulocity's "Manage extensions" UI. This is the
first fully successful end-to-end run of the entire fetch+upload flow.

**Round 30 — cosmetic follow-up: the uploaded extension's "Build information" panel was
empty.** The UI's extension-details page (`analytics-ui/src/manage/extension-details.component.ts`)
reads `build_information.build_type` (and optionally `repository.name`/`repository.url`)
directly off the managed object - our `metadataJson` never included a `build_information`
fragment at all. Separately, a *different* panel ("Blocks"/"Files") falls back to
`build_information.monitors`/`files` only when apama-ctrl hasn't loaded the extension yet -
that needs the browser's full `analyzeZipContent()` treatment (unzip, find every `.mon` file,
parse its generated `_metadata.evt` for category/description/inputs/outputs), which EPL has no
ZIP-parsing capability to replicate; not attempted here. **Fixed the directly actionable part**:
added a minimal `"build_information":{"build_type":"external"}` to `metadataJson`, matching the
same minimal shape `analytics-service`'s own server-side build flow uses (`app.py`/
`c8y_agent.py`) for the same field. EPL App only; not yet re-verified against a live correlator.

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
