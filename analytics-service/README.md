# analytics-ext-service

A Flask microservice that builds Analytics Builder extensions from GitHub repositories and deploys them to the Streaming Analytics engine of a Cumulocity tenant. The [web plugin](../README.md) calls it when it is deployed. It is optional: without it, the plugin works in browser-only mode and cannot build from directories or `extensions.yaml` files.

For installation, the plugin, and the full user guide, see the [root README](../README.md). For the endpoints, see [API.md](API.md). For the design, see [docs/BACKEND-GUIDE.md](../docs/BACKEND-GUIDE.md) and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## What it does

- Stores GitHub repository settings and access tokens as Cumulocity tenant options.
- Reads repository content from the GitHub API.
- Builds an extension zip with the Analytics Builder SDK (`analytics_builder build extension`).
- Uploads the zip to the tenant inventory, deletes extensions, and restarts the Streaming Analytics engine on request.
- Checks the roles of every caller. See the three `ROLE_ANALYTICS_MANAGEMENT_*` roles in [cumulocity.json](cumulocity.json) and [API.md](API.md).

## Files

| File | Purpose |
|------|---------|
| `app.py` | Routes and role checks |
| `c8y_agent.py` | Calls to the Cumulocity platform |
| `solution_utils.py` | Validation and GitHub URL helpers |
| `logging_config.py` | Logging setup (`LOG_LEVEL`, `LOG_FORMAT`, `ENV`, `LOG_FILE`) |
| `health_check.py` | Unused helper. `app.py` does not import it, and it needs `psutil`, which is not in `requirements.txt`. |
| `cumulocity.json` | Microservice manifest (`{VERSION}` is a template) |
| `Dockerfile` | Image based on the Apama builder image, pinned by digest. It runs as the unprivileged `apama` user and starts `gunicorn` on port 80. |
| `build.sh` | Builds the uploadable zip |
| `tests/` | `pytest` tests |

## Run the tests

```
pip install -r requirements-dev.txt
python -m pytest
```

## Build and deploy

Run the build from this directory. It needs Docker with `buildx` and `zip`.

```
./build.sh <version>                 # creates dist/analytics-ext-service.zip
./build.sh --push <version>          # builds, then uploads with the active c8y session
./build.sh --help                    # all arguments
```

With `--push`, the script creates the microservice if it does not exist and uploads a new version otherwise. It needs the `c8y` command of [go-c8y-cli](https://goc8ycli.netlify.app) and a session set with `set-session`.

## Run locally

Use the dev container in [.devcontainer](.devcontainer). It fetches the bootstrap credentials of the microservice with `get_service_creds.py` from an `.env-admin` file. See [.env.example](.env.example) and the section "Local debugging with VS Code / Dev Container" in the [root README](../README.md#backend-microservice).

## Health check

`GET /health` needs no authentication and returns `{"status": "UP"}`.
