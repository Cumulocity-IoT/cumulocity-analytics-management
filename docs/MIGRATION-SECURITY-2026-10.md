# Migration guide: security hardening of analytics-service (October 2026)

This guide describes what changed in the `analytics-service` microservice after the security review of 2026-10-29, and what you must do when you deploy the new version.

The changes are in three commits on the branch `feature/c8y-iot-build-pipeline`:

| Commit | Change |
|--------|--------|
| `8678f15` | Authorization, token handling, URL and ID validation |
| `28aedef` | Unprivileged container, pinned build inputs |
| `17e4336` and `a608732` | A change to token storage and its revert. The net effect is none. |

## Summary

| Area | Before | After | Action required |
|------|--------|-------|-----------------|
| Authorization | Every authenticated user of a tenant acted with the privileges of the microservice's service user | Every call runs with the roles of the calling user | Check that your users have the roles in [Required roles](#required-roles) |
| Extension build information | The GitHub personal access token (PAT) was stored in the `build_information` of each uploaded extension | Only `id`, `name`, and `url` of the repository are stored | Rotate tokens and clean up existing extensions |
| GitHub URLs | Paths with `..` segments were accepted, and a stored token could be sent to another repository | Such URLs return `400`, and a stored token is only sent to URLs inside its own repository | Check your repository IDs and branch names |
| IDs | Repository IDs and extension IDs were not validated | Strict formats, see [Behavior changes for API clients](#behavior-changes-for-api-clients) | Check existing repository IDs |
| Container | Ran as root, unpinned base image and SDK | Runs as the user `apama`, pinned base image and SDK commit | Test the image on your platform before release |
| Dependencies | Unpinned, test packages in the runtime image | Runtime versions pinned, test packages in `requirements-dev.txt` | None for operators |

## Before you deploy

### 1. Check user roles

The service used to call Cumulocity with its own service user, so a user without any inventory, option, or CEP roles could still delete extensions, restart CEP, or overwrite the repository configuration. The platform now checks the roles of the user who sends the request.

The service user roles in `cumulocity.json` are unchanged. They show which permissions the operations need. Confirm the exact role for each operation on a test tenant.

| Operation | Endpoints | Roles the caller needs |
|-----------|-----------|------------------------|
| Read CEP status | `GET /cep/id`, `GET /cep/status` | `ROLE_CEP_MANAGEMENT_READ` or `ROLE_CEP_MANAGEMENT_ADMIN`, and `ROLE_INVENTORY_READ` |
| Read repositories | `GET /repository/configuration`, `/repository/contentList`, `/repository/content` | `ROLE_OPTION_MANAGEMENT_READ` |
| Change repositories | `POST /repository/configuration` | `ROLE_OPTION_MANAGEMENT_ADMIN` |
| Build and download | `POST /extension/repository`, `/extension/list`, `/extension/yaml` with `upload=false` | `ROLE_OPTION_MANAGEMENT_READ` |
| Build and upload | the same endpoints with `upload=true` | `ROLE_INVENTORY_CREATE` |
| Rebuild or delete | `rebuild=true`, `DELETE /extension`, `DELETE /extension/{id}` | `ROLE_INVENTORY_ADMIN` |
| Deploy | `deploy=true` | `ROLE_CEP_MANAGEMENT_ADMIN` |

A caller without the matching role now receives an error from the platform instead of a successful response. Assign the roles to the user groups that manage extensions before the upgrade.

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

- `C8YAgent._execute` calls `get_user_instance`. Do not switch back to `get_tenant_instance` for request handling, because it authenticates as the service user.
- Validation helpers are in `solution_utils.py` (`is_valid_identifier`, `is_valid_numeric_id`, `has_unsafe_path_segment`). Use them for any new value that ends up in a URL, a tenant option key, or an inventory query.
- Install the test dependencies with `pip install -r requirements-dev.txt` in `analytics-service`. The CI workflows do this already. Run `pytest` to execute the 218 tests.
- To update the base image, pull `public.ecr.aws/apama/apama-builder:latest`, test it, and replace the digest in the `FROM` line. To update the SDK, change the `SDK_COMMIT` build argument in the `Dockerfile`.

## Verify after deployment

1. Open the Manage repositories dialog as a user with option management admin, and save a repository. The save succeeds.
2. Repeat the save as a user without option roles. The platform rejects it.
3. Build and upload an extension, then read `build_information.repository` of the new extension. It contains `id`, `name`, and `url`, and no `accessToken`.
4. Call `GET /repository/contentList` with a `repository_id` and a URL from a different repository. The response is `400`.
5. Confirm in the pod that the process runs as UID 1724: `kubectl exec <pod> -- id`.
