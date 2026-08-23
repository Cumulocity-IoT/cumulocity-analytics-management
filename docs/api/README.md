# analytics-service API

[openapi.yaml](openapi.yaml) documents the HTTP API exposed by `analytics-service`
(`analytics-service/app.py`), deployed under the Cumulocity microservice path
`service/analytics-ext-service`.

View it with any OpenAPI viewer (e.g. [Swagger Editor](https://editor.swagger.io),
or the OpenAPI extension in your IDE).

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

Not covered by this spec, because they don't go through `analytics-service`:

- `PUT /service/cep/restart` ([`cep-status.service.ts:104`](../../analytics-ui/src/shared/cep-status.service.ts#L104)) —
  the Cumulocity platform's own CEP/Apama microservice control endpoint.
- `GET service/cep/apamacorrelator/...` (diagnostics, block metadata, extension
  names — used by `cep-status.service.ts` and `extension-enrichment.service.ts`) —
  the CEP correlator's own REST surface.
- `GET/POST /tenant/options/...` ([`repository-config.service.ts`](../../analytics-ui/src/shared/repository-config.service.ts)) and
  inventory/binary CRUD ([`extension-inventory.service.ts`](../../analytics-ui/src/shared/extension-inventory.service.ts)) —
  Cumulocity core platform APIs.

## Keeping this in sync

`analytics-service/app.py`'s route docstrings are the source of truth; update
[openapi.yaml](openapi.yaml) when a route, request body, or response shape changes there.
