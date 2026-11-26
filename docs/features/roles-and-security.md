# Roles and security

Who may do what in Analytics Management, and how the service protects tokens and inputs. The microservice defines three application roles that it checks on every request. The UI does not use them: it relies on the platform roles of the logged-in user, which leaves a gap that is described below.

See also: [repository-configuration.md](repository-configuration.md), [release-deployment.md](release-deployment.md), [extension-upload.md](extension-upload.md), [engine-status-and-restart.md](engine-status-and-restart.md), [backend-and-browser-mode.md](backend-and-browser-mode.md). The rollout steps of the October 2026 hardening are in [../MIGRATION-SECURITY-2026-10.md](../MIGRATION-SECURITY-2026-10.md).

---

## Requirements

**What it is for.** Letting many people look, fewer upload, and few change repositories, delete extensions or restart the engine, and keeping GitHub tokens from leaking.

### Roles of the service

| Role | Allows |
|---|---|
| `ROLE_ANALYTICS_MANAGEMENT_READ` | Read the engine status, list repositories, browse repository content, build an extension as a download |
| `ROLE_ANALYTICS_MANAGEMENT_CREATE` | Everything in Read, plus build with upload, plus deploy a release asset |
| `ROLE_ANALYTICS_MANAGEMENT_ADMIN` | Everything in Create, plus change repositories, delete extensions, rebuild or replace an extension, restart the engine through the service |

- **A higher role includes the lower ones.** One role per person is enough. The service applies this rule. The platform does not.
- **No role, no access.** A user with none of the roles is refused on every endpoint except the health check.
- **Missing login gives 401, missing role gives 403** with the message `Missing required role <role>`. Both are decided before the request body is read or anything is changed.
- **Some requests need more than the endpoint's base role.** The same build endpoints need Read for a download, Create for `upload`, and Admin for `rebuild` or `deploy`. The release endpoint needs Create, and Admin when it replaces or restarts.
- **A route without a declared role is refused**, so a new endpoint cannot ship open by accident.

### What each endpoint needs

| Endpoint | Role |
|---|---|
| `GET /health` | none |
| `GET /cep/id`, `GET /cep/status` | Read |
| `GET /repository/configuration`, `GET /repository/contentList`, `GET /repository/content` | Read |
| `POST /extension/repository`, `/extension/list`, `/extension/yaml` | Read; Create with `upload`; Admin with `rebuild` or `deploy` |
| `POST /extension/release` | Create; Admin with `replace` or `deploy` |
| `POST /repository/configuration` | Admin |
| `DELETE /extension`, `DELETE /extension/{id}` | Admin |

### What the UI does with permissions

- **The Extensions entry is shown only with two platform roles.** The user needs `ROLE_CEP_MANAGEMENT_READ` and `ROLE_CEP_MANAGEMENT_ADMIN`. Without both the navigation entry is absent.
- **The UI does not read or mirror the three service roles.** It does not hide or disable buttons by role. A user without the needed service role sees the action and gets the service's refusal.
- **The UI changes repositories and uploads or deletes extensions with the user's platform rights**, not through the service. Anyone with `ROLE_OPTION_MANAGEMENT_ADMIN` or `ROLE_INVENTORY_ADMIN` can therefore do these in the UI whatever service role they hold. This is a known gap. The service roles protect the service's API and the actions that go through it.
- **Failures of the platform show as permission messages**, for example "Failed to load repositories. Please check your permissions."

### Tokens

- **A GitHub token is never shown again once saved.** The repository list and forms show a placeholder where a token exists, and saving the placeholder keeps the stored token.
- **The service never returns a stored token.** Repository responses carry the placeholder.
- **A token is only sent to GitHub, and only for its own repository.** A request that points a stored token at another repository or host is refused, and the token is not sent.
- **Changing the URL of a repository clears its token** unless a new token is entered in the same save.
- **A repository without a token uses the global token.**
- **Tokens are not written into extensions.** The information stored with an extension holds the repository id, name and URL, never a token.
- **Tokens are not logged.**
- **Known limit.** Tokens stay in tenant options, readable by users with option read access, and the browser reads them for its own GitHub calls. See the migration guide.

### Input rules

- **Repository ids** are 1 to 64 letters, digits, hyphens or underscores.
- **Extension names** from builds are letters, digits, hyphens and underscores. Release asset names must be a `.zip` file name of letters, digits, `.`, `_`, `+`, `-`, starting with a letter or digit.
- **Extension ids** in a delete request are digits only.
- **GitHub URLs** must be https on GitHub hosts. Owner, repository and branch use letters, digits, `.`, `_`, `-`. No path segment may be `.` or `..`, also percent-encoded.
- **Invalid input is a 400**, before any side effect.

### Container

- **The service does not run as root.** It runs as the user `apama` from a pinned base image and a pinned SDK commit.
- **It is multi-tenant.** The manifest sets tenant isolation to multi tenant, with 0.25 CPU and 512 MB.

### Non-goals

- **No per-repository permissions.** Roles apply to the whole application.
- **No role checks in the UI.**
- **No hidden storage for tokens.**

---

## Implementation

### Roles in the service

All in [app.py](../../analytics-service/src/app.py), section Authorization.

- **Declaration.** `@requires_role(ROLE_X)` stores the minimum role on the view, `@public` marks the health check. The manifest declares the three roles in [cumulocity.json](../../analytics-service/cumulocity.json) under `roles`.
- **Hierarchy.** `_SATISFIED_BY` maps each role to the set of roles that satisfy it: Read by all three, Create by Create and Admin, Admin by Admin only.
- **Check.** A `before_request` hook (`_authorize_request`) runs for every route. It skips unknown URLs (404) and public routes, denies a route without a declared role with 403 `Access denied`, then reads the caller's roles and compares.
- **Caller roles.** `C8YAgent.get_caller_roles` calls `/user/currentUser` with the caller's own headers and cookies and takes `effectiveRoles`. Because the platform authenticates that call, request headers cannot forge roles. Rejected credentials (401 or 403 from the platform) become 401. Other failures become 503.
- **Service user.** All other platform work (`_execute`) runs as the microservice's service user. The manifest `requiredRoles` give it option, inventory, application and CEP rights, so a caller needs none of these. `_execute` does not look at the caller, which is why the hook is the only guard.
- **Body-dependent checks.** `_build_role_error(upload, deploy, rebuild)` returns a 403 response for Create (upload) or Admin (rebuild, deploy). `_require_role` is the same check for single routes. The release route calls `_build_role_error(True, deploy, replace)`. These checks run before the first side effect, and their truthiness is the same as how the routes read the flags, including string values (`parse_boolean`). The tests assert that a string `"false"` still counts, as the route treats it that way.
- **Tests.** [test_authorization.py](../../analytics-service/tests/test_authorization.py) fails if a route has no role, if declared roles differ from its table, or if a role does not allow exactly itself and the ones above it.

### Token handling

[c8y_agent.py](../../analytics-service/src/c8y_agent.py) stores one tenant option per repository in category `analytics-management.repository`, key is the repository id, value is JSON `{name, url, accessToken?}`. The global token is in `analytics-management.settings`, key `globalAccessToken`.

| Rule | Where |
|---|---|
| Responses carry `_DUMMY_ACCESS_CODE_` instead of a token | `_parse_repository_value(replace_access_token=True)` |
| Saving the placeholder or omitting the field keeps the stored token | `_save_repository` |
| URL change without a new token clears the token | `_save_repository` |
| Stored token falls back to the global token | `load_repository(replace_access_token=False)` |
| Header `X-Repository-Access-Token` lets a draft repository be tested without saving; the header is not in URLs or access logs | `_get_repository_headers` |
| A stored token is only used if the URL is inside the repository | `_url_error_for_repository`, owner and repository compared in lower case |
| Hosts allowed: `github.com`, `api.github.com`, `raw.githubusercontent.com`, https only | `_is_github_url` |
| Build information holds id, name and url only | `_build_and_process_extension` and the release route |

The log writes that a PAT is used, never its value. The UI keeps the same placeholder logic in [repository-config.service.ts](../../analytics-ui/src/shared/repository-config.service.ts).

### Validation helpers

In [solution_utils.py](../../analytics-service/src/solution_utils.py): `is_valid_identifier`, `is_valid_numeric_id`, `has_unsafe_path_segment` (also decodes percent-encoding and rejects `/ \ ? #` inside a segment), and `_validate_repo_parts` for owner, repository and branch. [app.py](../../analytics-service/src/app.py) adds `_validate_extension_name` for build names and `_sanitize_monitors`, which keeps known string fields only, truncates them, and caps the list at 500 entries, because the list is stored on a managed object that every inventory reader can see.

**Query injection.** Extension names go into inventory queries (`name eq '<name>' and has(pas_extension)`). `find_extension_ids`, `count_extensions` and `delete_extension` reject names containing `'` or `\`, so `DELETE /extension?name=` with such a name ends in a 400. Names from builds and releases are already stricter. The repository id used as a tenant option key and the CEP query values are not user-chosen.

### Container

[Dockerfile](../../analytics-service/Dockerfile) pins the base image by digest and the SDK by commit, installs the runtime requirements only (test packages are in `requirements-dev.txt`), and ends with `USER apama`. Because the platform expects port 80, `setcap cap_net_bind_service=+ep` is applied to the Python interpreter. If the pod forbids privilege escalation or drops that capability, the service fails at start with a permission error on port 80.

### What the UI checks

[analytics-navigation.factory.ts](../../analytics-ui/src/shared/analytics-navigation.factory.ts) shows the Extensions node only when `Permissions.hasRole` is true for both `ROLE_CEP_MANAGEMENT_READ` and `ROLE_CEP_MANAGEMENT_ADMIN`. The Community blocks release node is kept in code but not returned.

### Limitations

- Size and count limits for builds and yaml sections are not set. Only release assets are capped (100 MiB).
- Error messages from the service can contain internal details.
- The UI writes repository options and uploads binaries directly, so the service roles do not cover them.

**Decided: documented as is.** The UI checks no service roles. The service enforces them and answers 403.

**Decided: documented as is.** The UI keeps its direct writes. Only the service endpoints enforce the service roles.

**OPEN QUESTION:** Is the Read role meant to be required for using the plugin in browser mode, or are the platform roles the only requirement there?
