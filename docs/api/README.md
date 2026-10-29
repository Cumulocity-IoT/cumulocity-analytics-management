# analytics-service API

[openapi.yaml](openapi.yaml) documents the HTTP API exposed by `analytics-service`
(`analytics-service/app.py`), deployed under the Cumulocity microservice path
`service/analytics-ext-service`.

View it with any OpenAPI viewer, such as [Swagger Editor](https://editor.swagger.io)
or the OpenAPI extension in your IDE.

Every route except `GET /health` requires one of the application roles `ROLE_ANALYTICS_MANAGEMENT_READ`,
`ROLE_ANALYTICS_MANAGEMENT_CREATE`, or `ROLE_ANALYTICS_MANAGEMENT_ADMIN`. See
[analytics-service/API.md](../../analytics-service/API.md#authentication) and
[MIGRATION-SECURITY-2026-10.md](../MIGRATION-SECURITY-2026-10.md).

See [repository-layouts.md](repository-layouts.md) for the two GitHub repository
layouts the `/extension/*` endpoints build from.

## Consumers in analytics-ui

`analytics-ui` never calls these endpoints with hardcoded strings. Path segments are
constants in [`analytics.model.ts`](../../analytics-ui/src/shared/analytics.model.ts):

| Constant | Value | Used by |
|---|---|---|
| `BACKEND_PATH_BASE` | `service/analytics-ext-service` | prefix for every call below |
| `CEP_ENDPOINT` | `cep` | [`cep-status.service.ts`](../../analytics-ui/src/shared/cep-status.service.ts) → `GET /cep/id`, `GET /cep/status` (the backend variant of the status call; the direct one is in the CEP table below) |
| `REPOSITORY_CONTENT_LIST_ENDPOINT` | `repository/contentList` | [`repository-backend.service.ts`](../../analytics-ui/src/shared/repository-backend.service.ts) → `GET /repository/contentList` |
| `REPOSITORY_CONTENT_ENDPOINT` | `repository/content` | [`repository-backend.service.ts`](../../analytics-ui/src/shared/repository-backend.service.ts) → `GET /repository/content` |
| `EXTENSION_ENDPOINT` | `extension` | [`repository-backend.service.ts`](../../analytics-ui/src/shared/repository-backend.service.ts) → `POST /extension/{repository\|list\|yaml}` |

The UI does not call `GET`/`POST /repository/configuration`. [`repository-config.service.ts`](../../analytics-ui/src/shared/repository-config.service.ts)
reads and writes the repository tenant options directly through the Cumulocity platform API, in the same format that
`c8y_agent.py` uses. Whether the UI uses the endpoints above or works in browser-only mode depends on the
**Use backend service** switch on the **Repositories** tab (`RepositoryModeService.isBackendMode()`).

[`analytics.service.ts`](../../analytics-ui/src/shared/analytics.service.ts) is the
facade the rest of the UI depends on; it delegates to `CepStatusService`,
`CepRestartService`, `ExtensionInventoryService` and `ExtensionEnrichmentService`
rather than calling `analytics-service` directly.

## CEP / Apama endpoints consumed

These are **not** part of `analytics-service`'s own API (not in [openapi.yaml](openapi.yaml)).
They are calls this project makes *against* the CEP/Apama microservice and its
correlator, from both `analytics-ui` (browser) and `analytics-service` (server-side,
via the tenant's Cumulocity session). Listed here specifically so they can be agreed
with the CEP/Apama RnD team, since a change to any of these paths or response shapes
on their side breaks this integration.

| Method & Path | Caller | Purpose |
|---|---|---|
| `GET /service/cep/diagnostics/apamaCtrlStatus` | `analytics-service` (`C8YAgent.get_cep_operationobject_id`, `get_cep_ctrl_status`, `PATHS["CEP_DIAGNOSTICS"]`); backs `GET /cep/id` and `GET /cep/status` on the API above | Engine status (`status`, `is_safe_mode`, `microservice_application_id`, `microservice_name`, version) and, from the same payload, the app id/name used to look up the CEP managed object in inventory |
| `GET /service/cep/diagnostics/apamaCtrlStatus` | `analytics-ui` directly ([`cep-status.service.ts`](../../analytics-ui/src/shared/cep-status.service.ts), `CEP_PATH_STATUS`) | Same status payload, used as a fallback when the `analytics-service` microservice is not subscribed/running for the tenant |
| `PUT /service/cep/restart` | `analytics-service` (`C8YAgent.restart_cep`, `PATHS["CEP_RESTART"]`), triggered when an extension build request has `deploy: true` | Restart the CEP engine so newly uploaded extensions load; fire-and-forget, failure is logged but non-fatal server-side |
| `PUT /service/cep/restart` | `analytics-ui` directly ([`cep-status.service.ts`](../../analytics-ui/src/shared/cep-status.service.ts) (`restartCepEngine`)), triggered by the user's explicit "Restart" action in the UI | Same restart command, called directly by the browser rather than through `analytics-service` |
| `GET /service/cep/diagnostics/extensionNames` | `analytics-ui` directly ([`extension-enrichment.service.ts`](../../analytics-ui/src/shared/extension-enrichment.service.ts), `CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES`) | Names and file contents of extensions currently loaded in the correlator. Used to mark inventory extensions as deployed, and by `RepositoryService` to mark repository files as installed when a deployed extension contains them (including files that define no block) |
| `GET /service/cep/apamacorrelator/en/block-metadata.json` | `analytics-ui` directly ([`extension-enrichment.service.ts`](../../analytics-ui/src/shared/extension-enrichment.service.ts), `CEP_PATH_METADATA_EN`) | List of deployed extension metadata files (`metadatas: string[]`), cross-referenced against inventory to compute "loaded" status |
| `GET /service/cep/apamacorrelator/en/{extensionName}.json` | `analytics-ui` directly ([`extension-enrichment.service.ts`](../../analytics-ui/src/shared/extension-enrichment.service.ts), `CEP_PATH_EN`) | Per-extension detail (`analytics: CepBlock[]`, `version`): the deployed block list and count shown for each extension |

All of these are direct calls to the CEP/Apama microservice's own REST surface
(`service/cep/...`), proxied by the Cumulocity platform, not application code owned
by this repository. `analytics-service` also independently calls
`GET /service/cep/diagnostics/apamaCtrlStatus` and `PUT /service/cep/restart`
server-side, so both the backend and the browser end up calling the same two CEP
endpoints for different reasons (see table above).

Also out of scope of [openapi.yaml](openapi.yaml), and unrelated to CEP:

- `GET/POST /tenant/options/...` ([`repository-config.service.ts`](../../analytics-ui/src/shared/repository-config.service.ts)) and
  inventory/binary CRUD ([`extension-inventory.service.ts`](../../analytics-ui/src/shared/extension-inventory.service.ts)):
  Cumulocity core platform APIs, called with the platform roles of the logged-in user.

## Keeping this in sync

`analytics-service/app.py`'s route docstrings are the source of truth; update
[openapi.yaml](openapi.yaml) when a route, request body, or response shape changes there.
