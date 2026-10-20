# Analytics Service Backend Development Guide

> Last aligned with the code: 2026-10-14. Items marked **Planned** are *not* implemented (see [Planned work](#planned-work)).

## Overview

`analytics-service` is a Python/Flask microservice (context path `analytics-ext-service`) that
builds Apama Analytics Builder extensions from GitHub sources and uploads them to Cumulocity.
It also manages the GitHub repository configuration (stored as tenant options) and exposes the
status of the Streaming Analytics (CEP/Apama) engine.

Endpoint details live in the route docstrings in `app.py` and in [API.md](../analytics-service/API.md).

---

## Project structure

```
analytics-service/
├── app.py               # Flask app: all routes + build/download helpers
├── c8y_agent.py         # Cumulocity access (pyc8y): extensions, tenant options, CEP
├── solution_utils.py    # GitHub URL helpers, handle_errors decorator, small utils
├── logging_config.py    # Logging setup (text or JSON)
├── health_check.py      # NOT used: not imported by app.py, not copied into the image
├── cumulocity.json      # Microservice manifest (roles, resources, contextPath)
├── Dockerfile           # Apama builder base image + SDK clone + gunicorn
├── build.sh             # Renders manifest/Dockerfile into build/ and zips to dist/
├── local_deploy.sh      # Local deployment helper
├── requirements.txt     # Unpinned dependencies (runtime + test)
├── pytest.ini
└── tests/               # conftest.py, test_app.py, test_c8y_agent.py, test_solution_utils.py
```

### Technology stack

- Python 3.11+ (developed on 3.12), Flask, gunicorn (2 workers x 4 threads, 120 s timeout)
- `pyc8y` 4.1.0 (asyncio-only; `C8YAgent._execute` runs one event loop per request)
- `requests`, `pyyaml`, `python-dotenv`
- Base image `public.ecr.aws/apama/apama-builder` with the Analytics Builder block SDK cloned to
  `/apama_work/apama-analytics-builder-block-sdk` (the build step shells out to `analytics_builder`)
- Tests: pytest, pytest-cov, pytest-mock, pytest-asyncio

`pydantic` and `psutil` are listed in `requirements.txt` but are not used by the service code
(`psutil` only by the unused `health_check.py`).

---

## Architecture

```
Flask routes (app.py)
   │  validate input, translate errors to HTTP
   ├── GitHub (requests): content API, git trees API, raw.githubusercontent.com
   ├── Apama SDK (subprocess): `analytics_builder build extension`
   └── C8YAgent (c8y_agent.py) ── pyc8y ──> Cumulocity (inventory/binaries, tenant options, CEP endpoints)
```

- **Authentication/tenant:** the service is multi-tenant. Every request is forwarded with the
  caller's headers/cookies; `MultiTenantCumulocityApp.get_tenant_instance` resolves the tenant
  session. A failure raises `C8YAgentError("Failed to authenticate with Cumulocity")`.
- **Repositories:** stored as tenant options in category `analytics-management.repository`,
  one option per repository id, JSON value `{name, url, enabled, accessToken?}`.
  Tokens are masked as `_DUMMY_ACCESS_CODE_` in API responses; sending the sentinel (or omitting
  the field) keeps the stored token, sending `""` clears it, changing the URL without a new token
  clears it.
- **Extensions:** uploaded as Cumulocity binaries with fragments `pas_extension` (the name) and
  `build_information` (how it was built). Deleting uses the binaries API.
- **Build pipeline** (`_build_and_process_extension`): download sources into a temp dir ->
  build zip with the SDK -> either return the zip (`upload=false`) or upload (`upload=true`),
  optionally restart CEP (`deploy=true`).

### Security properties worth preserving

- `_safe_join` rejects path traversal for every file written from remote content.
- `/repository/content` only fetches `https` URLs on `github.com`, `api.github.com` and
  `raw.githubusercontent.com`, so the stored/supplied PAT is never sent elsewhere.
- PATs can be supplied per request via the `X-Repository-Access-Token` header (used by
  "Test connection") to keep them out of URLs and access logs.
- Extension names are validated (`^[a-zA-Z0-9_-]+$`); delete-by-name rejects `'` and `\`
  because the name is interpolated into an inventory query.

---

## API overview

Base URL: `https://{tenant}.cumulocity.com/service/analytics-ext-service/` (locally `http://localhost:80/` via `python app.py`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness: always `{"status": "UP"}` (200), no auth, no dependency checks |
| GET | `/cep/id` | Managed object id of the CEP microservice (404 if unknown) |
| GET | `/cep/status` | Raw CEP diagnostics status (404 if unavailable) |
| GET | `/repository/configuration` | List repositories (tokens masked) |
| POST | `/repository/configuration` | Replace the repository list (missing ids are deleted); body must be an array of objects with `id`, `name`, `url` |
| GET | `/repository/contentList?url=&repository_id=` | GitHub directory listing for a web URL |
| GET | `/repository/content?url=&repository_id=[&extract_fqn_cep_block=true&cep_block_name=]` | File content or the fully qualified block name |
| POST | `/extension/repository` | Build from a whole repository path |
| POST | `/extension/list` | Build from one or more files or directories (`monitors`) |
| POST | `/extension/yaml` | Build one extension per section of a YAML spec |
| DELETE | `/extension/{id}` | Delete by managed object id |
| DELETE | `/extension?name=` | Delete all extensions with that name |

The three build endpoints share `extension_name`, `repository.id`, `upload`, `deploy`, `rebuild`.
`rebuild=true` deletes the existing extension(s) **before** building and returns 404 if none exist.

### Responses and errors

There is **no common response envelope**. Success bodies are endpoint specific
(e.g. `{"id": "...", "message": "Extension uploaded"}`, a zip, a JSON array, plain text).
Errors are always `{"error": "<message>"}` produced by `create_error_response`.

| Status | Used for |
|--------|----------|
| 200 | Success / zip download |
| 201 | Extension(s) uploaded |
| 207 | `/extension/yaml`: some sections uploaded, some failed (`failed_sections` lists them) |
| 400 | Invalid body/parameters, GitHub URL, download failure, all YAML sections failed, `ValueError` |
| 401/403/404/429 | Passed through from GitHub (rate limit and SSO get explicit messages) or 404 for unknown repository/extension |
| 500 | Build failure, upload failure, unexpected errors |

`handle_errors` wraps each route: `HTTPError` -> its status, `ValueError` -> 400, anything else -> 500.
Known quirks: delete-by-id maps every `C8YAgentError` (including auth) to 404; delete-by-name maps it to 500.

There is no rate limiting in the service (Cumulocity's gateway applies platform limits).

---

## Logging

**Location:** `logging_config.py` (`setup_logging()` at import time).

| Variable | Default | Effect |
|----------|---------|--------|
| `LOG_LEVEL` | `INFO` | Level for root logger and handlers |
| `LOG_FORMAT` | unset | `json` -> JSON on the console |
| `ENV` | `development` | `production` -> JSON on console **and** a rotating file handler |
| `LOG_FILE` | `/tmp/analytics-service.log` | File path (production only); 10 MB x 5 backups |

If the file handler cannot be opened the service falls back to console-only logging.
JSON records contain `timestamp, level, logger, message, function, line` (+ `exception`).

Not implemented: request ids/correlation, access logs with duration/user, automatic redaction.
`app.py` logs only token *presence*, never the value; keep it that way.

---

## Configuration and deployment

The service reads credentials from the Cumulocity microservice environment (bootstrap user,
handled by `pyc8y`'s `MultiTenantCumulocityApp`); `.env` is loaded via `python-dotenv` for local runs.
`GITHUB_TOKEN`, `FLASK_ENV`, `PORT` and `WORKERS` are **not** read. The GitHub token is a
per-repository (or global, UI-managed) setting.

Required microservice roles (`cumulocity.json`): option management read/admin, inventory read/create/admin,
application management read, CEP management admin.

```bash
# build the microservice zip (version, optional arch/image name)
cd analytics-service && ./build.sh 1.0.0   # -> dist/analytics-ext-service.zip, upload in Administration > Ecosystem

# run locally (needs Cumulocity env/.env; the Apama SDK path is only present in the Docker image)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

CI (`.github/workflows/build-release.yml`) builds the UI and the microservice on `v*` tags;
`check-push.yml` (every push and pull request) runs the spell check, the UI checks and the service tests
(`python -m pytest --cov=.` on Python 3.12). The release workflow does not depend on them.

---

## Testing

```bash
cd analytics-service
.venv/bin/python -m pytest                 # all tests
.venv/bin/python -m pytest --cov=. --cov-report=term
.venv/bin/python -m pytest tests/test_app.py -k yaml
```

| File | Covers |
|------|--------|
| `tests/test_solution_utils.py` | URL conversion, parsing helpers, `handle_errors` |
| `tests/test_app.py` | every endpoint, GitHub error mapping, download helpers, path traversal, build pipeline (SDK and GitHub stubbed) |
| `tests/test_c8y_agent.py` | repository token semantics, delete/upload/CEP, auth failure (fake async tenant) |

Conventions: Cumulocity is replaced via the `agent_mock` fixture (routes) or `run_agent_work`
(agent); GitHub via `monkeypatch` on `app.requests.get`; the SDK build via `_build_extension`.
No test needs network access or credentials. Coverage is about 91% (`health_check.py` is unused and uncovered).

---

## Planned work

None of the following exists today. Track decisions in [ARCHITECTURE.md](./ARCHITECTURE.md).

1. **Request validation with Pydantic** (ADR-004) - replace the hand-written checks in the routes.
2. **Rich `/health`** (ADR-005) - wire up `health_check.py` (and copy it in the Dockerfile) or delete it.
   Keep external calls out of any liveness probe.
3. **Pinned dependencies** and separate runtime/dev requirement files.
4. **Safer rebuild** - delete the old extension only after a successful build.
5. **Request correlation ids and log redaction.**
