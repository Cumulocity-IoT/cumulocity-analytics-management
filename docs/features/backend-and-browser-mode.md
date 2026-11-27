# Backend and browser mode

The plugin works with or without its companion microservice (`analytics-ext-service`, built from the `analytics-service` folder). With the microservice deployed and responding, repository and build work runs on the server. Without it, the plugin falls back to the browser, which can do less. Which mode applies is decided automatically, and one warning button shows when the service is missing.

See also: [repository-configuration.md](repository-configuration.md), [add-extension-wizard.md](add-extension-wizard.md), [release-deployment.md](release-deployment.md), [engine-status-and-restart.md](engine-status-and-restart.md), [roles-and-security.md](roles-and-security.md).

---

## Requirements

**What it is for.** Letting the plugin be installed on its own (as a UI package) and still be useful, while giving full function when the microservice is subscribed.

### Choosing the mode

- **The mode is automatic.** No setting selects it. The backend is used whenever it is deployed and responding.
- **"Deployed" means subscribed and answering.** A microservice that is subscribed to the tenant but has no running instance counts as not deployed.
- **The answer is remembered for the session.** If the service is deployed or removed while the page is open, the user can re-check without reloading.
- **A short network failure does not lock the session into browser mode.** The next call tries again.
- **Every part of the plugin follows the same answer.** Repository listing, content reading, repository tests, builds, and release deployment never decide separately.

### What works in each mode

| Capability | Backend mode | Browser mode |
|---|---|---|
| Manage repositories and the global token | Yes | Yes, same storage |
| Browse repository content | Server reads GitHub | Browser reads GitHub directly |
| Test a repository | Yes | Yes |
| Read the engine status | Through the service | Directly from the engine diagnostics |
| Upload a zip | Yes | Yes |
| Build an extension from ticked files | Yes | Yes, zipped in the browser |
| Build from an `extensions.yaml` section or a whole folder | Yes | No: shown as "Needs the backend service" |
| Deploy a release asset | Server downloads it | Download and upload by hand |
| Rebuild an installed extension | Yes | The button is disabled |

- **Browser mode builds are limited to individual files.** Choosing sections or folders is disabled in the wizard. If such a request still reaches the builder, the user gets a message that the backend is required.
- **Browser mode is slower and rate-limited.** GitHub allows 60 unauthenticated requests per hour per IP, 5000 with a token. Messages name this limit.
- **Everything shown is the same in both modes** where the table says "Yes". The user is not told which mode served a request.

### The warning button

- **"Backend service not deployed" appears on the Block library tab** only while the service is not deployed. It has a warning icon.
- **Clicking it checks again.** The button is disabled during the check. It disappears when the service now responds, and the mode switches without a reload.
- **The Extensions page may also show a warning toast** that the supporting microservice is not deployed and some features may be unavailable. See [engine-status-and-restart.md](engine-status-and-restart.md).

### Security-relevant differences

- **Repository settings and tokens are tenant options in both modes.** The browser reads and writes them with the logged-in user's rights. See [roles-and-security.md](roles-and-security.md).
- **In browser mode, tokens are read by the browser** and sent to GitHub from there.

### Non-goals

- **No choice of mode by the user.**
- **No hybrid inside one request.** A request either goes through the service or does not.

---

## Implementation

### Deciding

| Piece | Does |
|---|---|
| [repository-mode.service.ts](../../analytics-ui/src/shared/repository/repository-mode.service.ts) | `isBackendMode()`. Delegates to the analytics service. The repository config, GitHub content, backend, items and builder services call it and branch. None of them probes. |
| [cep-status.service.ts](../../analytics-ui/src/shared/cep/cep-status.service.ts) | `isBackendServiceAvailable()` returns `isBackendServiceDeployed()`. Caches the probe as a promise. `recheckBackendServiceDeployed()` drops the cache and the status caches. |
| [analytics.service.ts](../../analytics-ui/src/shared/analytics/analytics.service.ts) | Facade for the two methods above |

**The probe** (`checkBackendServiceAvailable`):

1. `ApplicationService.isAvailable('analytics-ext-service')`. A false answer ends the check. This only says the application is subscribed and visible.
2. `GET service/analytics-ext-service/cep/status`. Any HTTP status other than 404 counts as deployed. A 404 is the platform's "microservice instance not found" routing error, so it counts as not deployed.
3. A thrown network error returns false for this call but is not cached.

Caching: a resolved true or false is kept for the session. Only a thrown error removes the cache entry. `clearCache()` deliberately leaves the availability alone.

Consumers of the decision:

| Where | Effect |
|---|---|
| [repository.service.ts](../../analytics-ui/src/shared/repository/repository.service.ts), [repository-items.service.ts](../../analytics-ui/src/shared/repository/repository-items.service.ts) | Test repository, list content and read file content go to [repository-backend.service.ts](../../analytics-ui/src/shared/repository/repository-backend.service.ts) or [github-content.service.ts](../../analytics-ui/src/shared/repository/github-content.service.ts) |
| [extension-builder.service.ts](../../analytics-ui/src/shared/extension/extension-builder.service.ts) | List builds go to the service or to `createExtensionFromListDirect`. Sections and path builds answer 501 in the browser. |
| [extension-wizard.logic.ts](../../analytics-ui/src/repository/wizard/extension-wizard.logic.ts) | Disables section and folder rows with "Needs the backend service" |
| [extension-wizard.component.ts](../../analytics-ui/src/repository/wizard/extension-wizard.component.ts) | Chooses the release step list |
| [extension-grid.component.ts](../../analytics-ui/src/manage/extension-grid.component.ts) via `backendResolver` | Passes the flag to extension cards, which disable "Rebuild" without it |
| [repository-block-grid.component.ts](../../analytics-ui/src/repository/list/repository-block-grid.component.ts) | Shows the warning button, runs the re-check |

### Browser mode in detail

- **Content.** The Contents API is called from the page with the resolved token. File bodies are fetched from `raw.githubusercontent.com` without custom headers, because any non-safelisted header forces a preflight request that the static CDN does not answer.
- **Build.** `createExtensionFromListDirect` fetches each selected file, zips it under `files/` with the SDK exclude list, adds generated metadata files, and uploads through the normal upload path. The stored build information has `build_type: "external"` and only `.mon` files as monitors. Such an extension cannot be rebuilt, because rebuild is only enabled for the repository, list and yaml build types.
- **Releases.** Listing releases is CORS-open. Downloading asset bytes is not, so the wizard starts a plain browser navigation instead. See [release-deployment.md](release-deployment.md).
- **Tenant options.** [repository-config.service.ts](../../analytics-ui/src/shared/repository/repository-config.service.ts) lists `GET tenant/options/analytics-management.repository` (the category-scoped call, because the general listing ignores a category filter and would return every option of the tenant), and saves one option per repository. The global token is stored in `analytics-management.settings`, key `globalAccessToken`. Saving needs `ROLE_OPTION_MANAGEMENT_ADMIN`. This path is used in both modes, so the service's own repository endpoints are not used by the UI for configuration.
- **Token placeholder.** Loaded repositories carry `_DUMMY_ACCESS_CODE_` instead of the token. The real token is read separately when a GitHub call needs it. A saved placeholder keeps the stored token.

### Traps

- **Any non-404 counts as deployed.** A service that answers 401 or 403 (the caller has no analytics role) or 5xx is treated as available, and later calls fail with those errors. The probe is also a role-checked call.
- **An unreachable engine does not look like a missing backend.** The service answers 503 with a JSON error body, not 404, when the engine is unreachable or answers a gateway error, so a probe made during a restart still counts the backend as deployed. See [engine-status-and-restart.md](engine-status-and-restart.md).
- **The "Backend service not deployed" button uses the deployed check, while other code uses the available check.** They are currently the same method, kept separate so they can diverge.
- **The Extensions grid reads the flag once** from a route resolver. A re-check on the Block library tab does not update the cards of an Extensions page that is already open.
- **The `release` tab and the mockup page do not depend on the mode.**

### Limitations

**Decided: documented as is.** A 401 or 403 from the probe counts as "backend available", because the service is deployed. Missing permissions are a separate matter, see [roles-and-security.md](roles-and-security.md).

**OPEN QUESTION:** Should the stored `build_type` of a browser-mode build (`external`) be added to the documented build types and be rebuildable?
