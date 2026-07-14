# Requirements: Block Ecosystem Without a Backend Microservice

## Background

`analytics-service` is a Flask microservice that lets users browse GitHub repositories of Apama Analytics Builder blocks, build them into an extension using the block builder SDK (https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk), and upload/deploy the result to a Cumulocity tenant. See [ARCHITECTURE.md](../../ARCHITECTURE.md) for how it fits into the wider `cumulocity-analytics-management` solution.

Today it does four things server-side:

1. Stores GitHub repository configuration (URL, name, enabled) and access token (PAT) as masked Cumulocity tenant options.
2. Proxies GitHub Content API calls (list/read files) using the stored PAT.
3. Downloads the selected `.mon` file(s)/directory/YAML-selected files and runs the Apama CLI (`analytics_builder build extension`) to package them into a `.zip`.
4. Uploads the `.zip` as a Cumulocity `Binary` extension, deletes extensions, and relays `apama-ctrl` CEP status/restart calls.

A feasibility analysis (see [CONCEPT.md](CONCEPT.md)) confirmed the packaging step is a filtered zip, not a compilation — `analytics_builder build extension` requires no more than what a browser-side zip library can reproduce, and GitHub's Content/raw APIs are CORS-enabled for direct browser access. **This document defines the requirements for a version of the block marketplace feature that runs without `analytics-service`.**

## Goal

Let a user browse a configured GitHub block repository and build/upload an Apama extension entirely from the `analytics-ui` Angular app running in the browser, with no dedicated backend microservice required for that flow.

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
- FR12: The PAT must never be persisted to a Cumulocity tenant option or any server-side store; it stays local to the browser (e.g. scoped per Cumulocity user/tenant in browser storage) and must be re-entered if the user switches browser/device.
- FR13: The UI must clearly communicate that the PAT is stored locally only, is not shared across users, and should be scoped to read-only access on the target repository.
- FR14: Repositories without a configured PAT must still work (unauthenticated GitHub requests), subject to the lower rate limit; the UI should surface a clear, actionable error when that limit is hit (matching the rate-limit/SSO error handling `analytics-service` already provides today).

## Non-Functional Requirements

- NFR1: No new backend component may be introduced to satisfy FR1–FR14; where a capability requires more than what the browser can safely do (see PAT custody), it must be called out explicitly as an accepted trade-off rather than solved with a hidden server.
- NFR2: GitHub API usage should minimize request count (Git Trees API, no per-file directory recursion) to reduce the chance of hitting rate limits during a build.
- NFR3: The feature must degrade gracefully and with clear error messages when GitHub rate limits, SSO-restricted tokens, or network failures are encountered — parity with today's `_github_error_response` handling.

## Explicitly Out of Scope

- Centrally managed, team-shared GitHub tokens (would require a secrets-holding backend — deferred; see CONCEPT.md's "hybrid" option if this becomes a hard requirement later).
- Any change to how `apama-ctrl` parses/loads an extension once uploaded.
- Migrating existing repository configurations or extensions already built via `analytics-service` (this is a new build path, not a data migration).

## Open Decisions

- Where exactly the PAT lives in the browser (e.g. `localStorage` vs. `sessionStorage`) and whether it should be scoped per Cumulocity user or per browser profile.
- Whether `analytics-service` is retired entirely once this ships, or kept available as an opt-in deployment for customers who need centrally-managed tokens.
