# Requirements: Block Ecosystem Without a Backend Microservice

## Background

`analytics-service` is a Flask microservice that lets users browse GitHub repositories of Apama Analytics Builder blocks, build them into an extension using the block builder SDK (https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk), and upload/deploy the result to a Cumulocity tenant. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for how it fits into the wider `cumulocity-analytics-management` solution.

Today it does four things server-side:

1. Stores GitHub repository configuration (URL, name, enabled) and access token (PAT) as masked Cumulocity tenant options.
2. Proxies GitHub Content API calls (list/read files) using the stored PAT.
3. Downloads the selected `.mon` file(s)/directory/YAML-selected files and runs the Apama CLI (`analytics_builder build extension`) to package them into a `.zip`.
4. Uploads the `.zip` as a Cumulocity `Binary` extension, deletes extensions, and relays `apama-ctrl` CEP status/restart calls.

A feasibility analysis (see [CONCEPT.md](CONCEPT.md)) confirmed the packaging step is a filtered zip, not a compilation — `analytics_builder build extension` requires no more than what a browser-side zip library can reproduce, and GitHub's Content/raw APIs are CORS-enabled for direct browser access. **This document defines the requirements for a version of the block marketplace feature that runs without `analytics-service`.**

Requiring `analytics-service` for this flow today is heavy and awkward: it's a separate microservice a customer must subscribe to, deploy, and keep running, holding its own service-user identity and PAT storage, just to browse a repo and zip up a handful of `.mon` files. That deployment/operational burden is itself a barrier to adoption of community blocks — the new browser-based solution's purpose is to remove it, so that browsing, building, and uploading community blocks works out of the box in `analytics-ui` for any tenant, with no extra microservice to subscribe to or operate first.

## Goal

Let a user browse a configured GitHub block repository and build/upload an Apama extension entirely from the `analytics-ui` Angular app running in the browser, with no dedicated backend microservice required for that flow.

In addition, many block repositories (e.g. `Cumulocity-IoT/analytics-builder-blocks-contrib`, see https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/tag/1.0.1) already publish pre-built extension `.zip`s as GitHub Release assets — one per block, plus grouped per-category zips. For these, no client-side build step is needed at all: the user should be able to pick a repository, pick one of its releases, pick one or more asset zips from that release, and upload them directly as Cumulocity extensions.

## Implementation Status (as of 2026-07-15)

A first implementation now exists in `analytics-ui` and changes the framing from "replace the backend" to **dual-mode**: a new `RepositoryModeService` decides, per session, whether `analytics-service` is actually reachable (not just subscribed — see NFR5) and every other repository-related service dispatches to either a backend call or a direct browser/GitHub call accordingly. `analytics-service` itself is unchanged; it keeps working exactly as before for tenants that still deploy it, and is no longer a hard requirement for tenants that don't.

| Area | Status |
|---|---|
| FR1–FR3 (repository config, test connection) | ✅ Done — Tenant Options directly (browser mode) / backend proxy (backend mode) |
| FR4–FR5 (browse/list a repository directly, read a file's content) | ✅ Done for direct GitHub Content API calls |
| FR6 (Git Trees API single-call subtree download) | ❌ Not implemented — listing still walks one directory level at a time, same as `analytics-service` does today; only relevant once directory/whole-repo builds are implemented client-side (see FR7 status) |
| FR7–FR8 (client-side zip build, exclude-list, structural parity) | ⚠️ Partial — implemented only for a **list of already-selected flat files** (the common case: one `.mon` file per block); building from a selected **directory** or a **whole repository path** still requires the backend. Structural parity with the CLI's zip (FR8) hasn't been formally verified byte-for-byte, only that `apama-ctrl` accepts the result. |
| FR9 (rebuild / multi-section YAML builds) | ❌ Not implemented client-side — `extensions.yaml` section builds still require the backend; browser mode surfaces a clear "not supported yet, select individual files or deploy the backend" message instead of failing silently |
| FR10 (upload/delete/CEP status via `@c8y/client`) | ✅ Done — unchanged from the original plan |
| FR11, FR13–FR14 (PAT support, degrade gracefully) | ✅ Done |
| FR12 (PAT storage location) | ⚠️ **Changed from the original plan** — see the note under FR12 below |
| FR15–FR19 (Deploy from GitHub Release) | ✅ Done, including the native-download mitigation for FR18 (see NFR4) |

## Functional Requirements

### Repository configuration
- FR1: A user can add, edit, enable/disable, and remove a GitHub repository entry (name, web URL, optional PAT) from the UI.
- FR2: Repository entries (name, URL, enabled flag) are stored as Cumulocity tenant options, as they are today, so configuration survives across browser sessions/devices.
- FR3: A user can "test" a repository's connection (and PAT, if supplied) before saving, getting a clear success/failure result.

### Browsing and selecting blocks
- FR4: A user can browse a repository's directory tree and select one `.mon` file, one directory, or an `extensions.yaml`-style multi-section descriptor, matching today's `/extension/repository`, `/extension/list`, and `/extension/yaml` capabilities.
- FR5: Listing a directory and reading a file's content must work directly against GitHub's API from the browser (no server proxy).
- FR6: Downloading an entire directory/repository subtree must use a single GitHub Git Trees API request (`git/trees/{branch}?recursive=1`) rather than one request per subdirectory, to conserve GitHub's rate limit.

### Building the extension
- FR7: Building an extension (zip creation, applying the SDK's documented file-exclusion list: `.log`, `.classpath`, `.dependencies`, `.project`, `.deploy`, `.launch`, `.out`, `.o`, and `.git`/`.github` folders) must happen client-side, with no dependency on the Apama CLI or a server process.
- FR8: The resulting zip must be structurally equivalent to one produced by `analytics_builder build extension`, such that `apama-ctrl` accepts and parses it identically (block metadata continues to be extracted by `apama-ctrl` from the `.mon` file annotations at deploy time, as it is today).
- FR9: Rebuild (delete-then-build) and multi-section YAML builds must remain supported.

### Upload and lifecycle
- FR10: Uploading the built zip as a Cumulocity `Binary` extension (with `pas_extension` and `build_information` fragments), deleting extension(s) by id or name, and restarting/checking CEP status must all be callable directly from the browser using the logged-in user's own Cumulocity session (`@c8y/client`), with no separate microservice service-user identity involved.

### GitHub authentication
- FR11: A user can supply a GitHub PAT to raise the request rate limit (60/hr unauthenticated → 5000/hr) or to access a private repository.
- FR12 *(implemented differently than originally planned — see below)*: The PAT is stored as part of the repository's Cumulocity tenant option (same category/shape `analytics-service` already used), **masked on read** behind a `_DUMMY_ACCESS_CODE_` placeholder in the UI exactly like the backend did, with the real value resolved on demand only for the direct GitHub call that needs it. This was chosen over the originally-planned `localStorage`-only approach so that (a) a repository configured on one device/browser keeps working from any other, (b) entries created by `analytics-service` and by the browser stay interoperable (literally the same tenant option), and (c) the token round-trips through Cumulocity's own Tenant Options API rather than a hidden server — this is not the "no server ever sees the PAT" purity of the original FR12, but it does mean **no new backend component** is involved (NFR1 still holds) and the security perimeter is no worse than what `analytics-service` already had (masked on read, never re-displayed). Saving still requires `ROLE_OPTION_MANAGEMENT_ADMIN`/`ROLE_TENANT_MANAGEMENT_ADMIN`.
- FR13: The UI must clearly communicate that the PAT is masked on read and should be scoped to read-only access on the target repository.
- FR14: Repositories without a configured PAT must still work (unauthenticated GitHub requests), subject to the lower rate limit; the UI should surface a clear, actionable error when that limit is hit (matching the rate-limit/SSO error handling `analytics-service` already provides today).

### Deploying pre-built extensions from GitHub Releases
- FR15: A user can select a configured repository, then browse and pick from the list of its GitHub Releases (e.g. `1.0.1`, `1.0.0`, `0.0.2`, ...), showing at minimum the tag/name and asset count, most-recent first.
- FR16: For the selected release, a user can browse the list of `.zip` assets attached to it (e.g. one per block such as `Abs-1.0.1.zip`, plus grouped category zips such as `contrib-blocks-1.0.1.zip`) and select one or more to deploy.
- FR17: A selected release asset is uploaded as a Cumulocity extension `Binary` as-is (no re-zipping, no client-side build step) — it is treated as already conforming to the SDK's extension zip format.
- FR18: Because the actual asset bytes cannot be fetched by browser JS across origins (see NFR4), the UI must drive a normal browser-native download of the chosen asset(s) (e.g. an anchor with `download`, or `window.open`) and then let the user hand the downloaded file(s) to the extension upload step through the same drop-area/file-picker already used for manual `.zip` uploads today, rather than requiring the user to separately locate the file outside the app.
- FR19: Listing releases and their assets (metadata only — tag, name, asset names/sizes/URLs) must work directly against GitHub's Releases API from the browser (no server proxy), the same way repository browsing does today.

## Non-Functional Requirements

- NFR1: No new backend component may be introduced to satisfy FR1–FR19; where a capability requires more than what the browser can safely do (see PAT custody, release asset CORS), it must be called out explicitly as an accepted trade-off rather than solved with a hidden server. **As implemented**: `analytics-service` is not replaced but made optional — a `RepositoryModeService` picks backend vs. browser per session (see NFR5); no *new* backend component exists either way.
- NFR2: GitHub API usage should minimize request count (Git Trees API, no per-file directory recursion) to reduce the chance of hitting rate limits during a build. **Not yet implemented** — see FR6 in the Implementation Status table; current listing still walks one directory level at a time.
- NFR3: The feature must degrade gracefully and with clear error messages when GitHub rate limits, SSO-restricted tokens, or network failures are encountered — parity with today's `_github_error_response` handling.
- NFR4: Release *asset bytes* cannot be retrieved via `fetch()`/XHR from the browser: `api.github.com`'s release/asset JSON responses send `Access-Control-Allow-Origin: *`, but the actual binary is served via a 302 redirect to `release-assets.githubusercontent.com`, which sends no CORS header at all — the browser blocks the cross-origin response body. This is a hard platform constraint, not an implementation gap; FR18's browser-native-download workaround (or, later, a minimal download-proxy if a fully hands-free flow becomes a requirement) is the accepted mitigation. See CONCEPT.md for the verification and the trade-off discussion. **Confirmed in practice**: attempting to auto-open the file picker immediately after triggering the download (even synchronously, in the same click handler) does not work either — triggering the download consumes the click's browser "user activation" token, and opening a file picker needs its own, so the two cannot be chained in one gesture. FR18's one-manual-click design is the actual floor, not just the conservative choice.
- NFR5: Detecting whether `analytics-service` is actually usable must be a real liveness check, not just a subscription check. `AnalyticsService.isBackendServiceAvailable()` (`applicationService.isAvailable()`) only reports whether the microservice is *subscribed* to the tenant, which can be true while the microservice isn't actually running — every real request then fails with Cumulocity's own routing 404 ("Microservice ... not found"). `RepositoryModeService` treats the subscription check as a fast first filter, then confirms with an actual probe request before committing to backend mode.

## Explicitly Out of Scope

- Centrally managed, team-shared GitHub tokens (would require a secrets-holding backend — deferred; see CONCEPT.md's "hybrid" option if this becomes a hard requirement later).
- Any change to how `apama-ctrl` parses/loads an extension once uploaded.
- Migrating existing repository configurations or extensions already built via `analytics-service` (this is a new build path, not a data migration; moot in practice since browser mode reads/writes the same tenant option shape backend mode always used).
- A fully automated (no manual re-select step) release-asset download-and-upload flow — blocked by the CORS constraint in NFR4 unless a proxy is introduced, which is out of scope for the zero-backend goal.
- Client-side building from a selected **directory** (multi-file blocks, e.g. the one Python-based block in `analytics-builder-blocks-contrib`), from an **`extensions.yaml` manifest**, or from a **whole repository path** — all three still require `analytics-service`; only the "list of already-selected flat files" build path has a browser-mode implementation so far.

## Open Decisions

- Whether `analytics-service` is retired entirely once this ships, or kept available as an opt-in deployment for customers who need centrally-managed tokens — moot for now given the dual-mode design: it stays useful indefinitely for directory/yaml/whole-repo builds until those get a browser-mode implementation too.
- Whether the current grouping/layout should be kept for the new browser-only approach, or whether the repository/marketplace piece should be split out of "Analytics extensions" and given its own entry under "Ecosystem" in the left navigation. Today, "Manage extensions", "Blocks installed", "Repositories", and "Monitoring" are four tabs inside a single "Analytics extensions" nav item; "Repositories" is really a block marketplace/browser rather than extension lifecycle management, so it may deserve to be surfaced as its own top-level "Ecosystem" nav entry (e.g. "Block marketplace") instead of a tab buried under "Analytics extensions".
- Whether directory-based and `extensions.yaml`-based builds are worth implementing client-side at all, given the reference repo's actual layout (51 of 52 real blocks are flat single files; only one block is multi-file; no `extensions.yaml` manifest exists in the repo at all — see CONCEPT.md's "Repository layout: actual vs. assumed"). If usage stays dominated by flat files, the Git Trees API optimization (FR6/NFR2) may not be worth building either.
- Whether repository config should distinguish "browse source tree" repos (today's mode) from "browse releases" repos, or whether a single repository entry should expose both modes side by side once configured.

  ![Analytics extensions - Manage](./Analytics%20extensions%20-%20Manage.png)

  ![Analytics extensions - Repositories](./Analytics%20extensions%20-%20Repositories.png)
