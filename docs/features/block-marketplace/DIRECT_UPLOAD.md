# Spec: Event-Driven Extension Deploy via `apama-ctrl` (CORS Workaround)

**Status:** Draft — not yet implemented, not yet reviewed. Written to replace an earlier
four-bullet sketch; several sections below are open questions rather than settled decisions
(marked explicitly) and need answers before implementation starts.

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
     |--- POST /event (c8y_FetchExtension, source=?) ------------------->  |
     |                                |--- notify subscribed monitor ----->|
     |                                |                                     |--- GET asset URL (server-side, no CORS)
     |                                |                                     |--- POST /inventory/binaries (zip)
     |<-- inventory notification (extension created/updated) ------------- |
     |--- refresh "Manage extensions" tab                                  |
```

## Event schema (draft — see open questions)

```json
{
  "type": "c8y_FetchExtension",
  "source": { "id": "<TBD — see Q1>" },
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
assumed (Q2) — both explained below.

## Open risks — must be resolved before implementation

- **R1 (was a blocking spike; now a narrower, concrete question): `HttpOutputBlock` itself is
  the wrong tool, but the underlying transport isn't the blocker.**
  [`HttpOutputBlock.mon`](https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/blob/master/blocks/HttpOutputBlock.mon)'s
  response handling (`$timerTriggered`) only iterates
  `response.payload.data.getKeys()`/`getEntry()` — i.e. it treats the response body as a flat
  JSON object and exposes it as block output properties (`$OUTPUT_TYPE_responseBody :=
  "pulse"`). There is no code path there that captures or forwards a raw binary body. **But**
  per Apama's own docs for the underlying
  [HTTP Client Transport Connectivity Plug-in](https://cumulocity.com/apama/docs/10.15/standard-connectivity-plugins/the-http-client-transport-connectivity-plug-in/)
  (the same `com.softwareag.connectivity.httpclient` API `HttpOutputBlock` is built on): *"A
  response contains a binary payload which is the body of the response and further metadata
  fields describing the response"* — the binary body is the default; `HttpOutputBlock`'s
  JSON-object treatment of it is that block's own added codec/parsing step, not a transport
  limitation. So the fetch side is not blocked; `HttpOutputBlock` specifically is just built for
  JSON REST bodies and shouldn't be reused as-is — **a new block, built directly on
  `HttpTransport`/`Request`/`Response` without a JSON-decoding step, is needed for the fetch.**
  For the upload side, `com.apama.cumulocity` has no dedicated "Binary" event type, but
  [`GenericRequest`](https://documentation.softwareag.com/apama/v10-11/apama10-11/ApamaDoc/com/apama/cumulocity/GenericRequest.html)
  explicitly supports a payload dictionary where "each entry ... should have a string key and
  either a string or a binary value," with `metadata.contentType` set to `multipart/form-data`
  for exactly this shape — a real match for `POST /inventory/binaries`'s multipart semantics,
  and it rides the Cumulocity connectivity plugin's already-authenticated tenant session (no
  separate credential handling needed for this leg, unlike R1's original framing assumed).
  **What's left as an actual, narrow spike**: confirm whether `Response.payload`'s binary value
  can be assigned directly into `GenericRequest.payload`'s dictionary slot, or needs a codec hop
  (e.g. the
  [Base64 codec plug-in](https://documentation.softwareag.com/apama/v10-11/apama10-11/apama-webhelp/apama-webhelp/co-ConApaAppToExtCom_base64_codec.html))
  in between — a connectivity-chain type-compatibility question, not an open-ended "can this be
  done at all."
- **R2: EPL/monitor memory model for bulk binary payloads is still unproven.** Analytics
  Builder blocks and EPL monitors are built around small, frequent event-driven messages.
  Buffering an entire zip (some community extensions bundle dozens of blocks — see the 58KB
  `contrib-blocks-1.0.1.zip` example in `CONCEPT.md`) inside an EPL event/block's memory needs a
  sanity check against Apama's actual limits and recommended practices, not an assumption that
  it'll just work. R1's resolution doesn't remove this risk — it just clarifies that the data
  path exists.
- **R3: no owner named for the inventory upload step (now narrowed by R1).** `GenericRequest`
  is the concrete candidate — see R1. What's still open is who builds and owns the new block
  wrapping it (new to `analytics-builder-blocks-contrib`, or does it belong somewhere else),
  and how its multipart body is assembled (the managed-object JSON part —
  `pas_extension`/`build_information`, mirroring `InventoryBinaryService.create()`'s existing
  browser-side shape — plus the binary zip part). `InventoryBinaryService.create()`'s multipart
  semantics (`analytics.service.ts` /
  `extension-inventory.service.ts` today) would need an EPL-side equivalent — does one exist?

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

- **Q1 — event `source`.** Cumulocity events require a `source` managedObject id. Which
  device/agent/service is this posted against? Analytics Builder models are typically scoped
  to specific device/asset criteria — does a model bound to "any device" or a dedicated
  system/service managedObject fit here, or does this need its own convention?
- **Q2 — auth header delivery.** See "Credential handling" above; resolve before writing the
  event schema for real.
- **Q3 — update vs. create semantics.** `ExtensionAddComponent.onFile()` today checks for an
  existing extension by name and prompts for update confirmation
  (`showUpdateConfirmation()`/`ConfirmationModalComponent`) before overwriting. Does the
  monitor-side flow replicate that check, silently overwrite, or silently create a duplicate?
  This needs a decision, not a default.
- **Q4 — error surfacing.** GitHub's unauthenticated rate limit (60/hour, already documented in
  `CONCEPT.md`), a 404 asset, a monitor-side timeout, or an oversized zip all need a defined
  failure path back to the user. Today's browser flow surfaces `GitHubReleaseError.userMessage`
  directly in the UI (`release-deploy-wizard.component.ts`); what's the equivalent here, given
  the actual failure happens inside `apama-ctrl`, not in the browser?
- **Q5 — request correlation.** Two concurrent deploys (two users, or one user in two tabs)
  each fire a `c8y_FetchExtension` event; both eventually surface as "an extension changed" via
  the Inventory Notification API. Without a `requestId` (or equivalent) round-tripped through
  the event → monitor → resulting managed object, `analytics-ui` cannot tell which notification
  corresponds to *its own* request — added to the draft schema above, needs a concrete
  propagation mechanism (e.g. stashed as a fragment on the created `Binary` managedObject).
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
