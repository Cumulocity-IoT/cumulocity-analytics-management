# analytics-service API

[openapi.yaml](openapi.yaml) documents the HTTP API exposed by `analytics-service`
(`analytics-service/app.py`), deployed under the Cumulocity microservice path
`service/analytics-ext-service`.

View it with any OpenAPI viewer (e.g. [Swagger Editor](https://editor.swagger.io),
or the OpenAPI extension in your IDE).

See [repository-layouts.md](repository-layouts.md) for the two GitHub repository
layouts the `/extension/*` endpoints build from.

## Consumers in analytics-ui

`analytics-ui` never calls these endpoints with hardcoded strings — path segments are
constants in [`analytics.model.ts`](../../analytics-ui/src/shared/analytics.model.ts):

| Constant | Value | Used by |
|---|---|---|
| `BACKEND_PATH_BASE` | `service/analytics-ext-service` | prefix for every call below |
| `CEP_ENDPOINT` | `cep` | [`cep-status.service.ts`](../../analytics-ui/src/shared/cep-status.service.ts) → `GET /cep/id`, `GET /cep/status` |
| `REPOSITORY_CONFIGURATION_ENDPOINT` | `repository/configuration` | [`repository-config.service.ts`](../../analytics-ui/src/shared/repository-config.service.ts) → `GET`/`POST /repository/configuration` |
| `REPOSITORY_CONTENT_LIST_ENDPOINT` | `repository/contentList` | [`repository-backend.service.ts`](../../analytics-ui/src/shared/repository-backend.service.ts) → `GET /repository/contentList` |
| `REPOSITORY_CONTENT_ENDPOINT` | `repository/content` | [`repository-backend.service.ts`](../../analytics-ui/src/shared/repository-backend.service.ts) → `GET /repository/content` |
| `EXTENSION_ENDPOINT` | `extension` | [`repository-backend.service.ts`](../../analytics-ui/src/shared/repository-backend.service.ts) → `POST /extension/{repository\|list\|yaml}` |

[`analytics.service.ts`](../../analytics-ui/src/shared/analytics.service.ts) is the
facade the rest of the UI depends on; it delegates to `CepStatusService`,
`CepRestartService`, `ExtensionInventoryService` and `ExtensionEnrichmentService`
rather than calling `analytics-service` directly.

## CEP / Apama endpoints consumed

These are **not** part of `analytics-service`'s own API (not in [openapi.yaml](openapi.yaml)) —
they are calls this project makes *against* the CEP/Apama microservice and its
correlator, from both `analytics-ui` (browser) and `analytics-service` (server-side,
via the tenant's Cumulocity session). Listed here specifically so they can be agreed
with the CEP/Apama RnD team, since a change to any of these paths or response shapes
on their side breaks this integration.

| Method & Path | Caller | Purpose |
|---|---|---|
| `GET /service/cep/diagnostics/apamaCtrlStatus` | `analytics-service` (`c8y_agent.py:161`, `:185`, `PATHS["CEP_DIAGNOSTICS"]`) — backs `GET /cep/id` and `GET /cep/status` on the API above | Engine status (`status`, `is_safe_mode`, `microservice_application_id`, `microservice_name`, version) and, from the same payload, the app id/name used to look up the CEP managed object in inventory |
| `GET /service/cep/diagnostics/apamaCtrlStatus` | `analytics-ui` directly ([`cep-status.service.ts:97`](../../analytics-ui/src/shared/cep-status.service.ts#L97), `CEP_PATH_STATUS`) | Same status payload, used as a fallback when the `analytics-service` microservice is not subscribed/running for the tenant |
| `PUT /service/cep/restart` | `analytics-service` (`c8y_agent.py:152`, `PATHS["CEP_RESTART"]`), triggered when an extension upload request has `deploy: true` | Restart the CEP engine so newly uploaded extensions load; fire-and-forget, failure is logged but non-fatal server-side |
| `PUT /service/cep/restart` | `analytics-ui` directly ([`cep-status.service.ts:104`](../../analytics-ui/src/shared/cep-status.service.ts#L104)), triggered by the user's explicit "Restart" action in the UI | Same restart command, called directly by the browser rather than through `analytics-service` |
| `GET /service/cep/diagnostics/extensionNames` | `analytics-ui` directly ([`extension-enrichment.service.ts:131`](../../analytics-ui/src/shared/extension-enrichment.service.ts#L131), `CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES`) | Names of extensions currently loaded in the correlator, used to mark inventory extensions as deployed |
| `GET /service/cep/apamacorrelator/en/block-metadata.json` | `analytics-ui` directly ([`extension-enrichment.service.ts:167`](../../analytics-ui/src/shared/extension-enrichment.service.ts#L167), `CEP_PATH_METADATA_EN`) | List of deployed extension metadata files (`metadatas: string[]`), cross-referenced against inventory to compute "loaded" status |
| `GET /service/cep/apamacorrelator/en/{extensionName}.json` | `analytics-ui` directly ([`extension-enrichment.service.ts:146`](../../analytics-ui/src/shared/extension-enrichment.service.ts#L146), `CEP_PATH_EN`) | Per-extension detail (`analytics: CepBlock[]`, `version`) — the deployed block list and count shown for each extension |

All of these are direct calls to the CEP/Apama microservice's own REST surface
(`service/cep/...`), proxied by the Cumulocity platform — not application code owned
by this repository. `analytics-service` also independently calls
`GET /service/cep/diagnostics/apamaCtrlStatus` and `PUT /service/cep/restart`
server-side, so both the backend and the browser end up calling the same two CEP
endpoints for different reasons (see table above).

Also out of scope of [openapi.yaml](openapi.yaml), but unrelated to CEP:

- `GET/POST /tenant/options/...` ([`repository-config.service.ts`](../../analytics-ui/src/shared/repository-config.service.ts)) and
  inventory/binary CRUD ([`extension-inventory.service.ts`](../../analytics-ui/src/shared/extension-inventory.service.ts)) —
  Cumulocity core platform APIs.

## Keeping this in sync

`analytics-service/app.py`'s route docstrings are the source of truth; update
[openapi.yaml](openapi.yaml) when a route, request body, or response shape changes there.
