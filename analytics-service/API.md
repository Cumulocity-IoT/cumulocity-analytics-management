# Analytics Service API

Aligned with `app.py` on 2026-10-14. The route docstrings in `app.py` carry the full detail.

## Base URL

```
https://<tenant>.cumulocity.com/service/analytics-ext-service
```

Locally (`python app.py`): `http://localhost:80`.

## Authentication

Every request must carry the caller's Cumulocity credentials (Basic auth, OAuth cookie/token) or it is
rejected by the platform. The service forwards the request headers/cookies to Cumulocity and acts as that
user: Cumulocity checks the credentials, and the service then checks the caller's application role.
`GET /health` needs no authentication. A missing or invalid login returns `401`, a missing role returns
`403` with `{"error": "Missing required role ..."}`.

The service declares three roles. A higher role includes the lower ones, so one assignment per person is
enough.

| Role | Allows |
|------|--------|
| `ROLE_ANALYTICS_MANAGEMENT_READ` | CEP status, list repositories, browse repository content, build an extension as a download |
| `ROLE_ANALYTICS_MANAGEMENT_CREATE` | everything in READ, and build with `upload=true` |
| `ROLE_ANALYTICS_MANAGEMENT_ADMIN` | everything in CREATE, and change repositories, delete extensions, `rebuild=true`, and `deploy=true` (CEP restart) |

The platform calls themselves run as the microservice's service user, so callers need none of the
platform roles such as `ROLE_INVENTORY_ADMIN`.

## Responses and errors

There is no common response envelope; each endpoint returns its own body (JSON, plain text or a zip file).
Errors are always:

```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 200 | OK (also zip download when `upload` is false) |
| 201 | Extension(s) uploaded |
| 207 | `/extension/yaml`: partial success, see `failed_sections` |
| 400 | Invalid body/parameters/URL, download failed, all YAML sections failed |
| 401, 403, 404, 429 | Passed through from GitHub (rate limit and SSO errors have explicit messages), or not found |
| 500 | Build/upload failure or unexpected error |

There is no rate limiting in the service itself.

---

## Health and engine status

### `GET /health`
`200 {"status": "UP"}`. Static liveness, no dependency checks.

### `GET /cep/id`
`200 {"id": "<managed object id>"}` of the CEP microservice; `404` if it cannot be determined.

### `GET /cep/status`
`200` raw diagnostics of the Apama control process (`status`, `is_safe_mode`, `microservice_application_id`, ...); `404` if unavailable.

---

## Repositories

Repositories are stored as tenant options. Access tokens are returned as `_DUMMY_ACCESS_CODE_`.

### `GET /repository/configuration`
`200` array of `{id, name, url, accessToken, enabled}`.

### `POST /repository/configuration`
Body: array of `{id, name, url, accessToken?, enabled?}` (all three of `id`, `name`, `url` required per item).
**Replaces** the stored list: repositories not in the body are deleted.
`accessToken`: omitted or `_DUMMY_ACCESS_CODE_` keeps the stored token, `""` clears it, any other value sets it;
changing `url` without a new token clears the stored token.
`200 {"message": "Repositories updated successfully"}`, `400` for a non-array body or items without `id/name/url`.

### `GET /repository/contentList`
Query: `url` (GitHub web URL, required), `repository_id` (optional, selects the stored PAT).
Header `X-Repository-Access-Token` (optional) overrides the stored PAT, e.g. to test a draft repository.
Returns the GitHub Contents API listing as JSON.

### `GET /repository/content`
Query: `url` (required; **https URL on github.com, api.github.com or raw.githubusercontent.com only**),
`repository_id`, `extract_fqn_cep_block=true` + `cep_block_name` to return the fully qualified block name
(`package` + name) instead of the file content. Same PAT header as above.
Returns `text/plain`.

---

## Building extensions

Common body fields: `extension_name` (`[A-Za-z0-9_-]+`), `repository: {id}`, and the booleans
`upload` (default false), `deploy` (restart CEP after upload), `rebuild` (delete existing extension(s) of that
name first; `404` if none exists).

- `upload=false`: `200` with the extension zip (`application/zip`, attachment `<name>.zip`).
- `upload=true`: `201 {"id": "<binary id>", "message": "Extension uploaded"}`.

`rebuild` deletes the old extension **before** the new one is built.

### `POST /extension/repository`
Builds from the whole repository path configured in `repository.id`.

### `POST /extension/list`
Additionally requires `monitors`: an array with **one or more** `{url, name, type}` where `url` is a GitHub
Contents API URL and `type` is `file` or `dir`. The monitors are stored in the extension's build information.

### `POST /extension/yaml`
Body: `yaml: {url}` (raw URL of the YAML file), optional `sections` (names; empty = all), plus the common fields.
Each section (`<name>: {files: [...]}`) becomes one extension named after the section. Sections without files
are skipped; invalid names are reported as failed.

- Download mode returns the zip of the first processed section.
- Upload mode: `201 {"uploaded_extensions": [{"name", "id"}]}`; `207` with `failed_sections` and `message` if
  some failed; `400` if none succeeded. With `deploy=true` CEP is restarted once, after all sections, if at least one succeeded.

---

## Deleting extensions

### `DELETE /extension/{id}`
Deletes by managed object id (must be an extension). `200 {"message": "Extension deleted successfully"}`;
`404` for any agent error (unknown id, not an extension, auth problem).

### `DELETE /extension?name=<name>`
Deletes every extension with that name. `200 {"message": ..., "deleted_count": n}`, `400` without `name`
(or with `'`/`\` in it), `404` if none found.

---

## Examples

```bash
# build and deploy one extension from a configured repository
curl -u "$TENANT/$USER:$PASS" -H 'Content-Type: application/json' \
  -X POST "$BASE/extension/repository" \
  -d '{"extension_name":"MyBlocks","repository":{"id":"repo-1"},"upload":true,"deploy":true}'

# download the zip instead
curl -u "$TENANT/$USER:$PASS" -H 'Content-Type: application/json' \
  -X POST "$BASE/extension/repository" -o MyBlocks.zip \
  -d '{"extension_name":"MyBlocks","repository":{"id":"repo-1"}}'

# liveness
curl "$BASE/health"
```
