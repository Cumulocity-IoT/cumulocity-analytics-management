# Migration guide: security hardening of analytics-service (October 2026)

This guide describes what changed in the `analytics-service` microservice after the security review of 2026-10-29, and what you must do when you deploy the new version.

The changes are in these commits on the branch `feature/c8y-iot-build-pipeline`:

| Commit | Change |
|--------|--------|
| `8678f15` | Authorization, token handling, URL and ID validation |
| `28aedef` | Unprivileged container, pinned build inputs |
| `17e4336` and `a608732` | A change to token storage and its revert. The net effect is none. |
| `e34dde5` | Three application roles replace the platform roles as the access check |

## Summary

| Area | Before | After | Action required |
|------|--------|-------|-----------------|
| Authorization | Every authenticated user of a tenant acted with the privileges of the microservice's service user | The service checks one of three new application roles on every route | Assign the new roles, see [Assign the new roles](#1-assign-the-new-roles) |
| Extension build information | The GitHub personal access token (PAT) was stored in the `build_information` of each uploaded extension | Only `id`, `name`, and `url` of the repository are stored | Rotate tokens and clean up existing extensions |
| GitHub URLs | Paths with `..` segments were accepted, and a stored token could be sent to another repository | Such URLs return `400`, and a stored token is only sent to URLs inside its own repository | Check your repository IDs and branch names |
| IDs | Repository IDs and extension IDs were not validated | Strict formats, see [Behavior changes for API clients](#behavior-changes-for-api-clients) | Check existing repository IDs |
| Container | Ran as root, unpinned base image and SDK | Runs as the user `apama`, pinned base image and SDK commit | Test the image on your platform before release |
| Dependencies | Unpinned, test packages in the runtime image | Runtime versions pinned, test packages in `requirements-dev.txt` | None for operators |

## Before you deploy

### 1. Assign the new roles

The service used to call Cumulocity with its own service user and never checked who the caller was. A user without any roles could delete extensions, restart CEP, or overwrite the repository configuration. The service now checks one of three application roles on every route, which the microservice manifest declares:

| Role | Allows |
|------|--------|
| `ROLE_ANALYTICS_MANAGEMENT_READ` | Read CEP status, list repositories, browse repository content, and build an extension as a download |
| `ROLE_ANALYTICS_MANAGEMENT_CREATE` | Everything in READ, and build with `upload=true` |
| `ROLE_ANALYTICS_MANAGEMENT_ADMIN` | Everything in CREATE, and change repositories, delete extensions, rebuild (`rebuild=true`), and restart CEP (`deploy=true`) |

A higher role includes the lower ones, so assign one role per person. The service enforces this rule. Cumulocity does not.

| Endpoint | Role |
|----------|------|
| `GET /cep/id`, `GET /cep/status` | READ |
| `GET /repository/configuration`, `/repository/contentList`, `/repository/content` | READ |
| `POST /extension/repository`, `/extension/list`, `/extension/yaml` | READ, or CREATE with `upload=true`, or ADMIN with `rebuild=true` or `deploy=true` |
| `POST /repository/configuration` | ADMIN |
| `DELETE /extension`, `DELETE /extension/{id}` | ADMIN |
| `GET /health` | None |

The platform calls run as the microservice's service user. Callers no longer need the platform roles `ROLE_OPTION_MANAGEMENT_ADMIN`, `ROLE_INVENTORY_ADMIN`, or `ROLE_CEP_MANAGEMENT_ADMIN` to use the service. The service user keeps the `requiredRoles` from `cumulocity.json`.

Steps:

1. Deploy the new version. The platform creates the three roles when the microservice is subscribed. If you update an existing subscription, check in **Administration > Roles** that they exist.
2. Create or reuse user groups, and assign the roles. For example, give viewers READ, release engineers CREATE, and application owners ADMIN.
3. Test with one user per role before you remove old assignments.

A caller without a valid login receives `401`. A caller without the required role receives `403` with the message `Missing required role <role>`. Both checks run before the service reads the request body, loads a repository, or changes anything.

#### The UI still bypasses these roles

The UI saves repository options and uploads extension binaries directly to Cumulocity with the platform roles of the logged-in user, not through this service. Anyone with `ROLE_OPTION_MANAGEMENT_ADMIN` or `ROLE_INVENTORY_ADMIN` can therefore still change repositories and upload or delete extensions in the UI, whatever application role they hold. The new roles protect the microservice API and the actions that use it, such as building from a repository, browsing repository content, and reading CEP status. Closing the bypass requires routing the UI's writes through the service, which is not part of this change.

### 2. Rotate the GitHub tokens

Every extension that was uploaded with `upload=true` before this change contains the token of its repository in the managed object fragment `build_information.repository.accessToken`. The token can be a repository token or the global token if the repository had none of its own. Anyone with inventory read access can see it. The fix applies to new uploads only. Existing extensions keep their copy.

1. Rotate every token that was used for uploads, including the global token. This step is mandatory, because the old tokens must be treated as exposed.
2. Remove the old value from existing extensions. The following command uses go-c8y-cli. It was not tested against a tenant, so try it on one extension first.

   ```sh
   c8y inventory list --query "has(pas_extension)" --includeAll --select id,name
   c8y inventory update --id <extension id> --data "build_information.repository.accessToken=null"
   ```

3. Confirm that the fragment no longer contains `accessToken`:

   ```sh
   c8y inventory get --id <extension id> --select build_information.repository
   ```

The rebuild button in the UI only reads `build_information.repository.id` and `.name`, so removing the token does not affect it.

### 3. Check repository IDs and URLs

The service now rejects values that do not match these rules. The UI generates IDs of six letters and digits, so UI-created repositories are not affected. Check repositories that you created through the API or by editing tenant options.

- A repository ID must match `^[A-Za-z0-9_-]{1,64}$`.
- The owner, repository, and branch of a GitHub URL may contain only letters, digits, `.`, `_`, and `-`.
- No path segment of a GitHub URL may be `.` or `..`, also in percent-encoded form.

Repositories whose ID does not match cannot be used for builds or content requests. Create them again with a valid ID.

### 4. Test the container image

The image now drops root and runs as the user `apama` (UID 1724) that the base image provides. The platform expects the service on port 80, which an unprivileged user cannot bind under the default Kubernetes setting. The Dockerfile therefore gives the Python interpreter only the capability `cap_net_bind_service`.

| Check | Result |
|-------|--------|
| Service starts as `apama` and answers `GET /health` on port 80 with `net.ipv4.ip_unprivileged_port_start=1024` | Tested with Docker on `linux/amd64` |
| The SDK builds an extension as `apama` | Tested with a sample monitor |
| Deployment on your Cumulocity platform | **Not tested** |

The capability does not take effect if the pod runs with `allowPrivilegeEscalation: false` or drops `NET_BIND_SERVICE`. In that case the service fails at startup with `Permission denied` on port 80. Deploy to a test tenant first. If startup fails, redeploy the previous image.

## Behavior changes for API clients

These requests now return an error. Before, most of them were accepted.

| Request | Response |
|---------|----------|
| Any route except `GET /health` without a valid login | `401` |
| Any route without the required role, see [Assign the new roles](#1-assign-the-new-roles) | `403` |
| `POST /repository/configuration` with an `id` that does not match the ID rule | `400` |
| `POST /extension/*` with a `repository.id` that is missing, not a string, or does not match the ID rule | `400` |
| `DELETE /extension/{id}` where `id` is not numeric | `400` |
| `GET /repository/contentList` or `/repository/content` with a `repository_id` that does not match the ID rule | `400` |
| The same endpoints with a `repository_id` and a URL outside the configured repository | `400`, and the stored token is not sent |
| Any GitHub URL, monitor URL, or yaml URL containing `..`, or with an invalid owner, repository, or branch | `400` |
| `POST /extension/yaml` where `sections` is not an array | `400` |
| A yaml section whose `files` entry is not a list of relative paths | The section is listed in `failed_sections` |

The GitHub host checks are also stricter. A URL such as `https://github.com.example.com/o/r` was accepted before and is rejected now.

Calls that send the token in the `X-Repository-Access-Token` header without a `repository_id` behave as before.

## Build information format

The `build_information` fragment of a new extension contains this repository object:

```json
{
  "build_type": "repository",
  "repository": {
    "id": "a1b2c3",
    "name": "My repository",
    "url": "https://github.com/owner/repo/tree/main/blocks"
  }
}
```

The fields `monitors`, `yaml`, `sections`, `section_name`, and `files` are unchanged.

## What did not change

- **Token storage.** Tokens remain in the repository tenant option (category `analytics-management.repository`), and the global token remains in the settings category. Any user with option read access can read them. This is a known limit of the current design. The UI saves repository options itself and reads tokens in the browser for its direct GitHub requests, so a hidden option type such as `credentials.*` would break those features. Closing this gap requires routing all GitHub access through the backend.
- **API shape and tenant options format.** No data migration is needed.
- **Open review items.** The following findings from the review are not yet fixed:
  - Size and count limits for downloads and sections
  - Generic error messages instead of internal details
  - Type checks for some request fields
  - Build-before-delete order for `rebuild=true`

## Roll back

Redeploy the previous microservice image. Nothing is stored in a new format, so you do not need to undo any data change. Extensions uploaded with the new version contain no token in their build information, and the old version handles that without error.

## Notes for developers

- `C8YAgent._execute` runs as the service user, so it does not check the caller. A `before_request` hook in `app.py` does that: it reads the caller's roles with their own credentials (`C8YAgent.get_caller_roles`) and compares them with the role the route declares through `@requires_role`. The hook denies a route that declares no role. Use `@public` only for routes that must work without a login.
- Checks that depend on the request body, such as `upload`, `rebuild`, and `deploy`, use `_build_role_error`. Call it before the first side effect, and keep its truthiness identical to how the route acts on the flags.
- `tests/test_authorization.py` fails if a route declares no role, if the declared roles differ from its table, or if a role does not allow exactly itself and the roles above it. Update the table when you add a route.
- Validation helpers are in `solution_utils.py` (`is_valid_identifier`, `is_valid_numeric_id`, `has_unsafe_path_segment`). Use them for any new value that ends up in a URL, a tenant option key, or an inventory query.
- Install the test dependencies with `pip install -r requirements-dev.txt` in `analytics-service`. The CI workflows do this already. Run `pytest` to execute the 316 tests (94% line coverage on 2026-10-29).
- To update the base image, pull `public.ecr.aws/apama/apama-builder:latest`, test it, and replace the digest in the `FROM` line. To update the SDK, change the `SDK_COMMIT` build argument in the `Dockerfile`.

## Verify after deployment

1. As a user with only `ROLE_ANALYTICS_MANAGEMENT_READ`, call `GET /cep/status` and build an extension as a download. Both succeed. Call `POST /extension/repository` with `"upload": true`. The response is `403`.
2. As a user with `ROLE_ANALYTICS_MANAGEMENT_CREATE`, upload an extension. It succeeds. Repeat with `"deploy": true`. The response is `403`.
3. As a user with `ROLE_ANALYTICS_MANAGEMENT_ADMIN`, save a repository, rebuild an extension, and delete it. All succeed.
4. As a user without any of the three roles, call `GET /cep/status`. The response is `403`.
5. Build and upload an extension, then read `build_information.repository` of the new extension. It contains `id`, `name`, and `url`, and no `accessToken`.
6. Call `GET /repository/contentList` with a `repository_id` and a URL from a different repository. The response is `400`.
7. Confirm in the pod that the process runs as UID 1724: `kubectl exec <pod> -- id`.
