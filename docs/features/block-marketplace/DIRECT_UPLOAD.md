# Spec: Event-Driven Extension Deploy via `apama-ctrl` (CORS Workaround)

**Status: R1's earlier "confirmed blocker" call was wrong — retracted.** Four real deploy rounds
plus first-party `apama-in-c8y` source evidence had shown `apama-ctrl`'s `config/connectivity/`
only ever loading a fixed platform set, with no way for an extension to add to it. The Analytics
Builder Block SDK's own test suite (`test/block-sdk/Extensions_Plugins`) disproves that: it runs
the identical mechanism (`analytics_builder build extension` → upload → restart) against a
custom bundle and proves, via real correlator log assertions, that it gets read and connects.
Two real structural gaps between that working example and ours (subdirectory/filename mismatch,
missing `.properties` file) are now fixed in `repository/connectivity-bundle/`. **Not yet
re-verified against a live correlator** — see "Round 7" in
`repository/connectivity-bundle/README.md` for the full evidence trail and what's still open.

Three tiers of confidence:
- **Verified in practice** (real `apama-ctrl`, multiple rounds of test → fix): Q1 (proxy MO
  lookup/create), Q2 (PAT delivery), and the `RECEIVED` status event — all in
  `repository/epl/FetchExtensionListener.mon`, deployed as an EPL App.
- **Best-effort draft, never run** (R1/R2/R3, Q4's remaining status transitions): the actual
  fetch+upload, in the same file plus a new `repository/connectivity-bundle/` folder (custom
  connectivity chains — required because the JSON-codec-only "generic" HTTP client API every
  verified piece above uses would corrupt binary content; see R1). Written from documented Apama
  connectivity-plugin behavior, not from a working test. `uploadHost` (the tenant's own API
  hostname, needed to create the upload chain) is now resolved at startup via
  `GET /tenant/currentTenant`'s `domain` field — reusing the already-verified `GenericRequest`
  mechanism rather than an unconfirmed env-var-from-EPL path — but that specific field's
  presence/shape is itself unverified against a real response; if it's wrong, `uploadHost` stays
  empty and every request fails fast with a clear "server misconfigured" status rather than
  silently pointing at the wrong host. Q3 (update-vs-create) also remains unresolved and
  unimplemented — the current code always attempts a fresh upload, no existing-extension check.
  Also fixed since first written, found by a real EPL parser (an IDE linter, not a guess): **EPL
  has no ternary (`? :`) operator at all** — `emitStatus()` and `splitUrl()` both used one;
  rewritten as plain `if`/`else` into a local variable. Worth remembering for any future EPL code
  in this project, not just these two spots.
- **Confirmed by a real EPL App activation failure, then fixed**: `FetchExtensionListener.mon`
  originally called `new RawHttpChainFactory()` (a monitor type defined in the
  `connectivity-bundle` extension) to create the connectivity chains — the EPL App failed to
  activate until every reference to that monitor type was removed. *Event* types from the same
  extension (`GitHubAssetRequest`/`Response`, etc.) resolve fine via `using`; it's specifically
  monitor types that Cumulocity's per-EPL-App namespace isolation blocks across this boundary.
  Fixed by calling `ConnectivityPlugins.createDynamicChain()` directly from
  `FetchExtensionListener.mon` instead (a string-keyed runtime lookup against the extension's
  YAML, not a compile-time type reference) — `RawHttpChainFactory` has been deleted from
  `connectivity-bundle` entirely. See R1 and `repository/connectivity-bundle/README.md` for the
  full writeup. This also retroactively answers Q1/R1's earlier open question about
  Extension/EPL-App type visibility — no longer a guess.

## Background

`NFR4` and `FR18` in [REQUIREMENTS.md](REQUIREMENTS.md) establish the current accepted state:
GitHub release-asset bytes cannot be read by browser `fetch()`/XHR at all —
`release-assets.githubusercontent.com` sends no `Access-Control-Allow-Origin` header on any
response, redirect chain or not (verified live; see `CONCEPT.md`). The accepted mitigation
today is a native browser download plus one manual "hand the file to the upload step" click
(`FR18`). A fully hands-free version was explicitly called out as **out of scope** unless a
proxy is introduced (`REQUIREMENTS.md`, "Explicitly Out of Scope": *"blocked by the CORS
constraint in NFR4 unless a proxy is introduced, which is out of scope for the zero-backend
goal"*).

This spec proposes introducing exactly that proxy — routing the asset fetch through
`apama-ctrl` (the tenant's existing Apama/CEP microservice) instead of the browser, since a
server-side fetch has no CORS restriction at all. **This is a deliberate reversal of NFR1's
"no new backend component" position**, not a loophole around it: `apama-ctrl` already runs for
every tenant using Analytics Builder, so no *new* microservice is added, but it does take on a
new responsibility (arbitrary outbound HTTP fetch + inventory write, triggered by a Cumulocity
event) that it doesn't have today. That trade-off needs explicit sign-off against NFR1/NFR4
before this is built, not just an implementation.

## Goal

Let a user deploy a pre-built extension `.zip` from a GitHub Release (see
"Extension: deploying already-built extensions from GitHub Releases" in `CONCEPT.md`) with a
single action in `analytics-ui`, by having an Apama monitor fetch the asset and upload it to
the tenant's inventory server-side, instead of the browser doing it.

## Proposed flow

1. `analytics-ui` posts a Cumulocity event describing the asset to fetch (schema below).
2. An Apama monitor/block deployed to `apama-ctrl`, subscribed to that event type, receives it.
3. The block issues an HTTP GET for the asset URL and captures the response body.
4. The block uploads the resulting bytes as a Cumulocity `Binary` extension (same
   `pas_extension`/`build_information` fragment shape `ExtensionAddComponent` already produces
   today client-side).
5. `analytics-ui` observes the new/updated extension via the
   [Inventory Notification API](https://cumulocity.com/api/core/#tag/Inventory-notification-API)
   and updates the "Manage extensions" tab.

```
analytics-ui                    Cumulocity core                    apama-ctrl (Apama monitor)
     |                                |                                     |
     |--- GET /identity/externalIds/c8y_Serial/c8y_FetchUploadProxy ----->  |
     |<-- proxy managed object id (or 404, see Q1 resolution below) ------  |
     |--- POST /event (c8y_FetchExtension, source=<proxy mo id>) -------->  |
     |                                |--- notify subscribed monitor ----->|
     |                                |                                     |--- GET asset URL (server-side, no CORS)
     |                                |                                     |--- POST /inventory/binaries (zip)
     |<-- inventory notification (extension created/updated) ------------- |
     |--- refresh "Manage extensions" tab                                  |
```

## Event schema

```json
{
  "type": "c8y_FetchExtension",
  "source": { "id": "<id of the c8y_FetchUploadProxy managed object, see Q1 resolution below>" },
  "text": "Deploy extension from GitHub Release",
  "c8y_FetchExtension": {
    "requestId": "<TBD — see Q5, not in the original sketch>",
    "url": "<asset download URL>",
    "name": "<extension/asset name>",
    "headers": { "<TBD — see Q2>": "..." }
  }
}
```

This already differs from the original one-liner in two ways that matter: a `requestId` for
correlation (Q5) and a `headers` field so auth can travel with the request instead of being
assumed (Q2) — both explained below. `source` is no longer an open question — see Q1.

## Open risks — must be resolved before implementation

- **R1 — retracted "confirmed blocker", now an evidenced-but-unverified fix.**
  `GenericRequest` is JSON-only (confirmed against ApamaDoc: `reqId, method, path, queryParams,
  isPaging, body: any, headers` — no binary support), and the "generic"
  `HttpTransport`/`Request`/`Response` API every verified piece of this spec uses
  (`FetchExtensionListener.mon`'s Identity API calls, `HttpOutputBlock`, `EnhancedHttpOutput`) is
  documented as *always* going through a JSON codec — not a runtime option, a project-level
  choice baked in when the HTTP Client bundle was added to whatever image `apama-ctrl` runs.
  Using it for the fetch would silently corrupt every zip. That part still stands: some custom
  connectivity chain is genuinely required.

  The fix — a **custom connectivity chain** (Apama's "mapping to events" mode) defined in
  `repository/connectivity-bundle/config/connectivity/FetchExtension/FetchExtension.yaml` and
  deployed as an Analytics Builder extension — went through four real rounds against a live
  `apama-ctrl`, the last two of which (summarized; full detail in
  `repository/connectivity-bundle/README.md`) seemed to **confirm this whole approach was a dead
  end**:
  1–2. Two real bugs found and fixed in earlier rounds (a monitor missing `onload()`;
     `FetchExtensionListener.mon` referencing a monitor type across the Extension/EPL-App
     boundary, which Cumulocity's namespace isolation blocks for monitor types specifically, not
     event types) — see the file for detail, not superseded.
  3–4. The YAML, even nested one level under its own `FetchExtension/` subdirectory to match
     every known connectivity-config path pattern, never appeared in the correlator's `Reading
     configuration file` list at startup — which was the same fixed five platform bundles every
     time, regardless of the applied extension's contents. Cumulocity's own `apama-ctrl` product
     source (`Cumulocity-IoT/apama-in-c8y`) has exactly those five baked into
     `src/apama-ctrl/base/config/connectivity/`, which read as decisive first-party confirmation
     that extensions can't add to that folder at all.

  **That conclusion was wrong — found by checking the Analytics Builder Block SDK's own test
  suite** (`apama-in-c8y`'s `test/block-sdk/Extensions_Plugins`), which runs the *identical*
  mechanism (`analytics_builder build extension` → `upload extension --restart`) against a
  `SimplePlugin` fixture with its own custom `config/connectivity/HTTPClient/` bundle, and
  asserts against a real correlator log that it's read and connects:
  ```python
  self.assertGrep('apama-ctrl.1.out', 'Reading configuration file.*HTTPClient.properties')
  self.assertGrep('apama-ctrl.1.out', 'Connecting .*no.such.host.example.com')
  ```
  Comparing that fixture to ours found two real, fixable gaps, both now applied to
  `repository/connectivity-bundle/`:
  1. **Naming convention**: every real example (the five platform bundles, `SimplePlugin`, and
     `mqttservice`/`binaries` in a customer sample checked along the way — see below) has its
     subdirectory name match its yaml's basename exactly. Ours didn't
     (`FetchExtension/fetch-extension-chains.yaml`). **Fixed**: renamed to
     `FetchExtension/FetchExtension.yaml`.
  2. **Missing `.properties` file**: every platform bundle and `SimplePlugin` pairs a
     `.properties` file with the `.yaml`; ours had none. **Fixed**: added
     `FetchExtension/FetchExtension.properties` (existence-only — our chain's `@{HOST}`/`@{PORT}`
     tokens are filled at runtime via `createDynamicChain()`'s `substitutions` argument, not
     static `.properties`-driven `${...}` substitution).

  **Not yet re-verified against a live correlator.** One difference from `SimplePlugin` remains
  untested: its working chain is a `startChains:` entry (auto-started at boot); ours is
  `dynamicChains:` (instantiated on demand). Whether `dynamicChains:` needs anything further is
  the open question the next deploy attempt will answer.

  A customer sample (`Cumulocity-IoT/apama-mqttservice-idp-poc`) checked partway through this
  investigation turned out not to be directly relevant either way — its custom
  `config/connectivity/` bundles live inside a full Designer/Eclipse Apama *project*
  (`.project`/`.dependencies` metadata, a project-root `config/CorrelatorConfig.yaml`), the
  "custom microservice / standalone project" path, not an `analytics_builder build extension`
  artifact. It was useful for one negative result: neither of its custom bundles has a
  `.properties`/`.settings` file, ruling out an unrelated theory that missing `.settings` was
  the real differentiator.

  See "Round 7" in `repository/connectivity-bundle/README.md` for the full round-by-round
  evidence trail.
- **R2: EPL/monitor memory model for bulk binary payloads is still unproven — now with a
  placeholder number, not a real one.** `FetchExtensionListener.mon`'s `MAX_ASSET_BASE64_LENGTH`
  guards against oversized assets, but its value (~20 MB raw) is a guess, not a tested limit —
  and the guard only rejects *after* the full body is already in memory (there's no way to
  reject earlier with this design), so it caps the damage rather than preventing it. Analytics
  Builder blocks and EPL monitors are built around small, frequent event-driven messages, not
  bulk file transfer — some community extensions bundle dozens of blocks (see the 58KB
  `contrib-blocks-1.0.1.zip` example in `CONCEPT.md`, tiny by this measure, but not every
  extension will be).
- **R3 — moot while R1 is blocked.** The `InventoryUploadRequest` event shape (one JSON string
  part `managedObject` — no `build_information`/zip-content-analysis, unlike
  `analyzeZipContent()`'s browser-side equivalent — plus one Base64→binary part `file`) is still
  a reasonable design if a working connectivity chain is ever established, but there's currently
  no chain for it to travel over. Revisit once/if R1 has a real path forward.

  `uploadHost` resolution (`GET /tenant/currentTenant`'s `domain` field) and the
  `apama.eventMap` hand-written-event-type question are both moot for the same reason — neither
  is reachable while `createDynamicChain()` fails before either would matter.

## Security considerations (absent from the original sketch)

- **Authorization surface.** Anyone able to post a `c8y_FetchExtension` event against the
  right `source` can apparently cause `apama-ctrl` to fetch an arbitrary URL and load the
  result as an extension — i.e. arbitrary remote code execution into the CEP engine, gated
  only by event-creation permission on that source. This needs an explicit statement of who
  can trigger it (which role/permission) and why that's an acceptable trust boundary — today's
  browser-side upload flow is already gated by the user's own Cumulocity session and
  `ROLE_CEP_MANAGEMENT_ADMIN` (see `AnalyticsNavigationFactory.canActivate()`); this flow must
  be gated at least as tightly.
- **Credential handling (Q2).** Private repositories need an `Authorization` header — this
  codebase already has `RepositoryService.getRepositoryAccessToken()` for exactly that reason
  on the browser side. If a PAT has to travel to the monitor to build that header, doing it via
  the event payload puts a secret in plaintext in Cumulocity's event history, readable by
  anyone with event-read on that source. `HttpOutputBlock` already supports
  `credentialsFromTenantOptions` (pulling Basic Auth credentials from Tenant Options via
  `FindTenantOptions` instead of the request), which is the right pattern to reuse here **if**
  R1 is resolved in favor of this block being usable at all — the event itself should carry no
  secret.
- **SSRF.** The block will fetch a URL supplied (indirectly) by a browser client. Even scoped
  to "GitHub release assets," this is a fetch-arbitrary-URL primitive running server-side with
  the tenant's network access — worth at least a sentence on whether the URL is validated
  against an allowlist (e.g. must resolve to `github.com`/`*.githubusercontent.com`) before the
  monitor fetches it.

## Open questions

- **Q1 — event `source` — resolved.** A dedicated, non-device managed object serves as the
  event source, rather than binding this to any real device/asset: looked up by external id
  (`idType` `c8y_Serial`, `externalId` value `c8y_FetchUploadProxy` — chosen as a simple,
  self-describing convention; a plain managed object, no `c8y_IsDevice` fragment, since it's
  only an anchor for events, not a real device), created on first use if it doesn't exist yet.
  Both sides need to agree on this lookup:
  - **`apama-ctrl` side** (implemented as a spike): `repository/epl/FetchExtensionListener.mon`
    resolves/creates the proxy managed object on monitor load via `GenericRequest` against the
    Identity API (`GET`/`POST /identity/externalIds/...` and `/identity/globalIds/.../externalIds`
    — there's no dedicated external-id EPL event type, see R1's research), then listens for
    `c8y_FetchExtension` events with that id as `source`. Deliberately stops at logging the
    received event for now — see "Spike scope" below and R1/R2, still open for the actual
    fetch/upload.
  - **`analytics-ui` side** (implemented and verified — see "Verified in practice" below):
    `analytics-ui/src/shared/fetch-extension.service.ts`'s `FetchExtensionService` resolves the
    same managed object via `IdentityService.detail({type: 'c8y_Serial', externalId:
    'c8y_FetchUploadProxy'})` and uses its `managedObject.id` as the event's `source`; on a 404
    (the EPL app hasn't run yet) it fails with a clear message rather than creating the managed
    object itself, exactly as decided above. Wired into
    `ReleaseDeployWizardComponent` as a second, clearly-labeled "Send via event (experimental)"
    button alongside the existing, renamed "Download" button (the original native-download +
    drop-area flow — renamed from "Deploy" since that's a more honest description of what it
    actually does, now that there are two visibly different options side by side).

  **Verified in practice** (2026-07-17, real `apama-ctrl` instance, EPL app deployed via the
  standard EPL Apps mechanism), across two runs:

  *Run 1 — bootstrap, first deploy:*
  ```
  looking up proxy managed object external id c8y_Serial/c8y_FetchUploadProxy (reqId 11167)
  Cumulocity returned error "404 Not Found" ... External id not found ...
  proxy managed object not found, creating it
  created proxy managed object, id=65858222
  bound external id c8y_FetchUploadProxy to managed object 65858222
  ready, listening for c8y_FetchExtension events with source=65858222
  ```

  *Run 2 — analytics-ui's `FetchExtensionService` sending a real `c8y_FetchExtension` event*
  (see the `analytics-ui` side below): the monitor received it correctly, with the exact
  `url`/`name`/`requestId` fragment the UI sent — confirming the UI ↔ event ↔ monitor path
  works end to end — but then crashed:
  ```
  received c8y_FetchExtension event id=858223 text=Deploy extension from GitHub Release: Abs-1.0.1.zip
    params={... "c8y_FetchExtension":any(dictionary<any,any>,{"name":"Abs-1.0.1.zip","requestId":"73czia","url":"https://github.com/..."}), ...}
  CastException - Type mismatch: Trying to cast dictionary<any,any> to dictionary<string,any>
  ```
  Nested JSON objects inside an `Event`'s `params` (and, it turns out, inside a
  `GenericResponse`'s body too — see below) deserialize as `dictionary<any,any>` — both keys
  *and* values wrapped in `any` — not `dictionary<string,any>` like the top-level `params`
  dictionary itself. **Fixed** in both places that made this mistake:
  `onFetchExtensionEvent`'s fragment parsing (the one that actually crashed) and
  `handleLookupComplete`'s parsing of the identity-lookup response body (which uses the
  identical pattern but hadn't been exercised yet in either run — both runs so far took the
  404/create branch, never the "found existing" branch that parses a real body). Both now cast
  to `dictionary<any,any>` and look up entries with `<any> "key"` instead of `"key"`.

  Also since corrected here: the file's `package apamax.blockmarketplace.fetchextension;`
  declaration was removed (no longer present in the current file) — the correlator logs the
  injected monitor as `eplfiles.FetchExtensionListener.FetchExtensionListener` regardless, which
  is what led to noticing the package statement wasn't doing anything useful under the EPL Apps
  deployment mechanism in the first place.

  *Run 3 — same UI action, after the cast fix:* clean parse, no exception —
  ```
  received c8y_FetchExtension event id=857217 text=Deploy extension from GitHub Release: Abs-1.0.1.zip
    params={... "c8y_FetchExtension":any(dictionary<any,any>,{"name":"Abs-1.0.1.zip","requestId":"ddq3kl","url":"https://github.com/..."}), ...}
  c8y_FetchExtension fragment: url=https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/download/1.0.1/Abs-1.0.1.zip name=Abs-1.0.1.zip requestId=ddq3kl
  ```
  This closes out everything Q1's spike set out to prove: the proxy managed object
  lookup/create bootstrap, and the full UI → event → monitor → fragment-parsed-correctly path,
  all confirmed working against a real tenant. What's genuinely still open is unchanged from
  before — R1/R2 (the actual fetch/upload) and Q2–Q6 — this spike never touched those.

  Still unverified by this run: the re-run behavior (does a second monitor load correctly find
  the now-existing managed object via the lookup path instead of hitting create again?) and the
  actual event flow (no `c8y_FetchExtension` event was sent in this test, so `onFetchExtensionEvent`
  was never exercised).

  **Spike scope**: `FetchExtensionListener.mon` intentionally only proves out the lookup/create
  bootstrap and event subscription — not the fetch+upload itself, since R1/R2 (binary transport
  between two `HttpTransport` connections, EPL's memory model for multi-megabyte payloads) are
  still open and shouldn't be tackled in the same step as getting the source/event plumbing
  right.
- **Q2 — auth header delivery.** See "Credential handling" above; resolve before writing the
  event schema for real.
- **Q3 — update vs. create semantics.** `ExtensionAddComponent.onFile()` today checks for an
  existing extension by name and prompts for update confirmation
  (`showUpdateConfirmation()`/`ConfirmationModalComponent`) before overwriting. Does the
  monitor-side flow replicate that check, silently overwrite, or silently create a duplicate?
  This needs a decision, not a default.
- **Q4 — error surfacing — resolved, partially implemented.** The monitor emits
  `c8y_FetchExtensionStatus` events against the same proxy managed object as progress/error
  markers for each request (`repository/epl/FetchExtensionListener.mon`'s `emitStatus()`),
  carrying `requestId`, `status` (`RECEIVED`/`DOWNLOADING`/`UPLOADING`/`SUCCEEDED`/`FAILED`),
  and a `message`. Because these are plain Cumulocity Events against a real managed object,
  they show up on Cumulocity's own Monitoring/Events page for that object automatically —
  **no new UI needed on the `analytics-ui` side to close this gap**, unlike the original framing
  assumed. `FAILED`'s `message` should mirror the same categories
  `GitHubReleaseError.mapErrorResponse()` already produces for the browser-side flow (401/403,
  429 rate limit, 404 asset, timeout, oversized zip) — that mapping is documented as a follow-up
  in the action's doc comment, not yet coded, since it needs R1/R2's real fetch/upload logic to
  have something to report on. **Implemented so far**: `RECEIVED`, emitted for real the moment
  the monitor parses an incoming request (verified in practice, see below).
  `DOWNLOADING`/`UPLOADING`/`SUCCEEDED`/`FAILED` are documented, not implemented — deliberately
  not stubbed with fake calls, since there's nothing real to report until R1/R2 land.
- **Q5 — request correlation — resolved by the same mechanism as Q4.** Every
  `c8y_FetchExtensionStatus` event carries the originating `requestId`, so `analytics-ui` (or
  anyone watching the Monitoring page) can filter/correlate the whole trail for a given request
  without needing a separate propagation mechanism through the eventual `Binary` managedObject —
  querying Events by `source` + a `requestId` match in `params` is enough. Still open: whether
  `analytics-ui` should actively poll/subscribe to these status events (e.g. via the Events API
  or a realtime notification) to reflect progress in the wizard UI itself, or whether pointing
  the user at the tenant's own Monitoring page is an acceptable v1 (no additional
  `analytics-ui` code needed for that path).
- **Q6 — the final bullet in the original sketch** ("in the dialog to 'deploy release' there
  must be an option to directly upload the selected zip") was never reconciled with the rest of
  the doc: does this mean keep the existing manual drag-and-drop path as a fallback alongside
  this event-driven one (recommended — R1/R2 above are real open risks that might sink the
  monitor-side approach entirely), or something else? Needs an explicit decision, since as
  written it reads as a leftover thought.

## Explicitly out of scope (for now)

- Changing how `apama-ctrl` parses/loads an extension once uploaded (`REQUIREMENTS.md`'s
  existing exclusion still applies — this spec only changes how bytes reach `apama-ctrl`, not
  what it does with them afterward).
- Centrally managed, team-shared GitHub tokens — still deferred per `REQUIREMENTS.md`.
- Any change to the existing browser-side manual-download flow (`FR18`) for tenants/browsers
  where this event-driven path isn't available or hasn't been enabled.

## Relationship to REQUIREMENTS.md

If this spec is approved, `REQUIREMENTS.md`'s NFR1 ("no new backend component may be
introduced... where a capability requires more than what the browser can safely do... it must
be called out explicitly as an accepted trade-off") and the "Explicitly Out of Scope" line
about a download-proxy both need to be updated to reflect the decision, with a pointer back
here — silently shipping this without updating those would leave the requirements doc
contradicting the actual implementation.
