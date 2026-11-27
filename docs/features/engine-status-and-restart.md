# Engine status and restart

How the plugin knows whether the Streaming Analytics engine (the Apama correlator control service) is up, what it shows while the engine is down or in safe mode, and how a restart is triggered and followed. Status and restart matter because new or changed extensions only take effect after a restart.

See also: [extensions-management.md](extensions-management.md), [add-extension-wizard.md](add-extension-wizard.md), [release-deployment.md](release-deployment.md), [backend-and-browser-mode.md](backend-and-browser-mode.md), [roles-and-security.md](roles-and-security.md).

---

## Requirements

**What it is for.** Telling the user whether extensions are loaded, and letting them restart the engine without leaving the page or being alarmed by the errors a restart causes.

### Status

- **The Extensions page follows the engine live.** The status changes on the page without a manual refresh when the engine goes down or comes back.
- **Extensions are only listed while the engine is up.** While it is down, the page shows "Streaming Analytics Engine is unavailable or restarting..." with a loading indicator instead of the list.
- **Safe mode is shown.** When the engine is in safe mode, a banner says that no extensions are loaded, and that the extension added or updated last is the most likely cause. That extension is marked, but only if it changed in the last 24 hours. Every extension is shown as not loaded. Safe mode ends with a restart, after the cause is deleted or fixed.
- **Status works without the backend service.** It is then read from the engine's diagnostics endpoint directly.
- **A missing status counts as down.**

### Restart

- **The user restarts the engine on demand.** The Extensions page has "Restart to deploy extension", and the wizard offers "Restart now" after an extension was added. Nothing restarts the engine automatically after an upload.
- **One toast follows the restart.** "Streaming Analytics is restarting. This may take a moment." stays until the engine reports up again, then turns into "Streaming Analytics restarted." If the request to restart fails, it turns into a failure toast that disappears after a few seconds.
- **Completion means a real down then up.** The stale "up" from before the restart is not taken as completion.
- **If completion is never observed, the restart state ends after 90 seconds** and the "restarting" toast is replaced by a warning: "Could not confirm the restart of the Streaming Analytics engine. Check its status." It disappears after 8 seconds. The message is not shown when the restart completes in time.
- **A finished restart refreshes what the user sees.** Cached block and extension data are dropped and open views reload, so blocks of a new extension appear as installed.
- **Errors caused by the restart stay quiet.** During the restart and for 10 seconds after it, errors that the restart explains (the engine is not reachable, the operation object is missing, the service is briefly unreachable) are logged as warnings, with no error toast.
- **Gateway errors 502, 503 and 504 are treated as temporary** also outside a restart: they are logged quietly and not reported as errors.
- **Outside a restart, an unavailable engine is reported once.** A warning toast says it is temporarily unavailable and disappears after 8 seconds. If the backend service is not deployed, the toast says so instead.

### Permissions

- **Restart needs the platform role for CEP management.** The UI calls the platform's restart endpoint with the logged-in user's own rights. The Extensions entry is only shown to users who hold the platform CEP management read and admin roles.
- **Status through the backend needs the Read role.** See [roles-and-security.md](roles-and-security.md).

### Non-goals

- **No restart progress beyond up and down.**
- **No automatic restart after upload, delete, or replace.**
- **The service's own restart flag is best effort.** A failed restart requested through the API does not fail the upload.

---

## Implementation

### Backend endpoints

Both are in [app.py](../../analytics-service/src/app.py), role Read.

| Endpoint | Does | Response |
|---|---|---|
| `GET /cep/status` | Returns the body of the platform's `/service/cep/diagnostics/apamaCtrlStatus` unchanged (`status`, `is_safe_mode`, `microservice_name`, `microservice_application_id`, `number_extensions` and more) | 200; 503 `{"error": ...}` when the engine is unreachable or answers a gateway error; 404 `CEP control status not found` only if no status is returned otherwise |
| `GET /cep/id` | Reads the same diagnostics, then queries the inventory for the managed object with that `applicationId` and `name`, first hit | 200 `{"id": "..."}`; 503 `{"error": ...}` when the engine is unreachable or answers a gateway error; 404 `CEP operation object not found` when the diagnostics hold no match |

In [c8y_agent.py](../../analytics-service/src/c8y_agent.py) both methods raise `C8YEngineUnavailableError` on a failed lookup (authentication errors pass through), which the routes turn into 503. A missing object is `None`, which becomes 404. A gateway failure (`Status: 502|503|504` in the error text) is logged as one warning, "expected while it restarts", instead of an error with the response body, because the UI polls continuously during a restart.

`restart_cep` sends `PUT /service/cep/restart` with `{}` as the service user and only logs a warning if it fails. It is only called when a build or release request sets `deploy`.

### UI services

| Class | Responsibility |
|---|---|
| [cep-status.service.ts](../../analytics-ui/src/shared/cep-status.service.ts) | Caches the operation object id and the status, owns the realtime subscription, runs the restart, answers whether the backend is available |
| [cep-restart.service.ts](../../analytics-ui/src/shared/cep-restart.service.ts) | The restart lifecycle state, the single toast, the restart window |
| [cep-error.ts](../../analytics-ui/src/shared/cep-error.ts) | `CepError` with the HTTP status, `isTransientGatewayError`, `fetchCepJSON` |
| [analytics.service.ts](../../analytics-ui/src/shared/analytics.service.ts) | Facade. On a restart ending, clears all caches and asks views to reload |
| [extension-grid.component.ts](../../analytics-ui/src/manage/extension-grid.component.ts) | Derives `cepStatus$` and `isSafeMode$`, lists extensions only when the status is `up` |

**Where the data comes from.**

| Need | Backend deployed | Backend not deployed |
|---|---|---|
| Status | `GET service/analytics-ext-service/cep/status` | `GET service/cep/diagnostics/apamaCtrlStatus` |
| Operation object id | `GET .../cep/id`, on failure falls back to the next column | Diagnostics for name and application id, then an inventory query that must return exactly one object |

**Live status.** On start the service gets the operation object id, reads the object once, then subscribes through realtime to `/managedobjects/{id}`. Each update is pushed to a replay stream. The status is `c8y_Status.status` of that object, compared in lower case with `up`. An `up` update also drops the cached status and reloads it. The `is_safe_mode` flag is not always on the object, so the grid asks the status endpoint when the object does not carry it, and only again when the flag or status changes.

**Restart sequence.**

1. `beginRestart()`: restarting flag on, "engine seen down" reset, the info toast shown, a 90 second safety timer started. When the timer fires, the restart state ends and the toast becomes the "Could not confirm the restart" warning.
2. `PUT service/cep/restart` with body `{}` through the platform, as the user.
3. The realtime subscription is set up again, so a changed operation object id is picked up.
4. Realtime updates: a non-up status records that the engine went down. An up status after that calls `restartSucceeded()`, which ends the state, starts the 10 second grace window and replaces the toast.
5. A failed request calls `restartFailed()` and the error is rethrown. The wizard then shows "The engine could not be restarted."

### Transient errors

`isExpectedTransientError` is true inside the restart window, or for a `CepError` with status 502, 503 or 504. It only decides the log level in `handleError`. The user-facing warnings `showCepUnavailableWarning` and `showBackendNotDeployedWarning` are suppressed only inside the restart window. All status toasts share one slot, so a new one replaces the old.

### Traps

- **The backend probe and a down engine.** The UI decides that the backend is deployed by calling `GET .../cep/status` and treating any 404 as "not deployed". When the engine itself is unreachable or answers a gateway error (502, 503, 504), for example during a restart, the service answers 503 with a JSON `{"error": ...}` body, not 404, so the probe still counts the backend as deployed. See [backend-and-browser-mode.md](backend-and-browser-mode.md).
- **A missed down event.** If the engine restarts faster than the realtime update arrives, the "down" is never seen, and the restart ends only through the 90 second timer, with the warning that the restart could not be confirmed.
- **Restart rights differ by path.** The UI restart uses the user's platform rights. A restart requested through `deploy=true` runs as the service user and needs the Admin role of the service.
- **Safe mode is inferred.** After a deletion, the "suspect" is the most recently updated extension, limited to 24 hours (`SUSPECT_MAX_AGE_MS` in the grid component), so an old extension is not blamed.

### Limitations
