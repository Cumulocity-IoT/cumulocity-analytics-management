# Release deployment

Deploying an extension that was already built and published as a GitHub release asset. The user picks a repository, a release and a zip asset in the add extension wizard, and the extension lands in the tenant under a version-free name. With the backend service the whole transfer runs server-side. Without it the user moves the file by hand.

See also: [add-extension-wizard.md](add-extension-wizard.md), [extension-naming-versioning.md](extension-naming-versioning.md), [extension-upload.md](extension-upload.md), [backend-and-browser-mode.md](backend-and-browser-mode.md), [roles-and-security.md](roles-and-security.md), [engine-status-and-restart.md](engine-status-and-restart.md).

---

## Requirements

**What it is for.** Installing an extension that someone else already built, without building it again.

### Listing releases

- **Releases come from the repository's GitHub URL.** The wizard lists the releases of the owner and repository behind the selected repository, newest first as GitHub returns them. The newest release is preselected.
- **Only zip assets are offered.** Other assets of a release are not shown. If the selected release has exactly one zip asset, it is preselected.
- **A repository without releases says so.** The repository step marks it and the release step shows "This repository has no releases". The user can switch to building from the same repository instead.
- **Listing failures are explained.** An invalid or expired token, an exhausted rate limit, a missing repository, and a connection failure each give their own message.
- **A repository URL that is not a GitHub owner/repo URL cannot list releases.**

### Deploying with the backend service

- **The service downloads the asset and uploads it as an extension.** The browser never handles the file.
- **The extension is named after the asset without `.zip` and without its version.** `Abs-1.0.1.zip` becomes the extension `Abs`, version `1.0.1`. The version is kept as metadata. See [extension-naming-versioning.md](extension-naming-versioning.md).
- **An extension with that name already exists: the review step says it will be replaced.** The note names the installed version when it is known.
- **An older or equal version needs confirmation.** If the asset version is older than or equal to the installed one, the review step shows a warning and a "Replace anyway" checkbox. Create stays disabled until it is ticked. If either version is unknown, there is no warning. Nothing is blocked outright.
- **Replace means upload first, then delete the old one.** The old extension is only removed after the new one is stored. Only the extensions that existed before the upload are removed, so an extension that someone else uploaded under the same name in the meantime survives.
- **A failed removal of the old extension is a warning, not a failure.** The new extension is in place, and the user is told the previous one could not be deleted.
- **Without replace, an existing name is refused** with a conflict message.
- **The file must be a zip and at most 100 MB.** Anything else is refused with a message, and nothing is uploaded.
- **The stored build information never contains the access token.** It records the repository (id, name, URL), the release tag, the asset name and the version.
- **The restart is optional.** After a successful deployment the wizard offers "Restart now" or restarting later. Deploying does not restart the engine by itself. See [engine-status-and-restart.md](engine-status-and-restart.md).
- **Permissions.** Deploying needs the Create role. Replacing an extension, or asking the service to restart the engine, needs the Admin role. See [roles-and-security.md](roles-and-security.md).

### Deploying without the backend service

- **The wizard hands the file over instead.** The steps are Source, Repository, Release and asset, Download, Upload.
- **Download starts a normal browser download in a new tab.** It does not read the file in the page. Private repositories may answer with an error page there, because the browser is not signed in to GitHub.
- **The user can skip the download** when they already have the file.
- **Upload is the regular zip upload.** In Chromium browsers a dialog that opens in the Downloads folder can pick the file. Other browsers use the drop box.
- **Naming and replace rules are those of the upload.** The wizard does not apply the release naming here. See [extension-upload.md](extension-upload.md).

### Non-goals

- **No deployment from a release of a repository that is not on GitHub.**
- **No asset larger than 100 MB.**
- **No release deployment in the browser alone.** GitHub does not let the page read release assets, so the manual path is the fallback.
- **The "Community blocks release" page is a mockup.** It shows a fixed list, fetches nothing, and has no navigation entry.

---

## Implementation

### Flow with the backend

| Step | Who | What |
|---|---|---|
| 1 | Wizard | Reads the real token of the repository from the tenant option (the repository list only holds the masked placeholder) and calls the GitHub REST API from the browser: `GET /repos/{owner}/{repo}/releases`. |
| 2 | Wizard | Filters the assets of the chosen release to names ending in `.zip`. Splits the asset name with the shared version splitter, and looks the name up in the installed extensions to decide `replace` and the review note. |
| 3 | Wizard | `POST /extension/release` with `repository.id`, `asset_id`, `asset_name`, `release_tag`, `deploy` (always `false` from the wizard) and `replace` (true when an extension of that name is installed). |
| 4 | Service | Validates the body, loads the repository, builds the GitHub asset URL itself, streams the download, checks the zip, uploads, optionally deletes the previous extensions, optionally restarts. |
| 5 | Wizard | Shows the warning if any, a success toast, then the restart panel. |

Listing releases is CORS-open on GitHub, so the browser can do it. Downloading asset bytes is not, because the asset CDN sends no `Access-Control-Allow-Origin` header. That single fact decides the two paths.

### Endpoint: `POST /extension/release`

Defined in [app.py](../../analytics-service/src/app.py) as `deploy_extension_from_release`.

| Field | Rule |
|---|---|
| `repository.id` | Required, must match the repository id rule |
| `asset_id` | Required, an integer or a string of digits (booleans rejected) |
| `asset_name` | Required, must match `^[A-Za-z0-9][A-Za-z0-9_.+-]*\.zip$` (case-insensitive) |
| `release_tag` | Optional string, at most 200 characters |
| `deploy` | Optional, restart the engine after the upload (Admin) |
| `replace` | Optional, replace an extension of the same name (Admin) |

| Status | Meaning |
|---|---|
| 201 | Uploaded. Body `{"id", "message"}`, plus `"warning"` if the old extension could not be deleted |
| 400 | Bad body or parameter, repository is not a GitHub repository, or the asset is not a zip |
| 403 | Missing role (Create always, Admin for `replace` or `deploy`) |
| 404 | Unknown repository, or GitHub reports the asset missing |
| 409 | An extension with that name exists and `replace` is false |
| 413 | The asset exceeds the limit |
| other | GitHub's status is passed through with a translated message (rate limit, SSO, auth) |

Order of work inside the route:

1. Parse the flags, then check roles with `_build_role_error(True, deploy, replace)` before anything else happens. The Admin check therefore runs before the repository is even loaded.
2. Validate parameters. Split the asset name into extension name and version.
3. Load the repository with its token (falling back to the global token). Require an https GitHub URL.
4. If not replacing, count extensions of that name and answer 409 when there is one.
5. Build `https://api.github.com/repos/{owner}/{repo}/releases/assets/{asset_id}` from the stored repository. The caller never supplies a URL, so the token cannot be sent elsewhere. Request with `Accept: application/octet-stream` and the bearer token, streamed, timeouts 10 s connect and 120 s read.
6. Read the body with a cap. A declared `Content-Length` above the limit is refused up front, otherwise the stream is cut off when it passes the limit. The limit is `RELEASE_ASSET_MAX_BYTES` (100 MiB), held in memory.
7. `zipfile.is_zipfile` on the buffer. The content is not inspected further.
8. Upload with `build_information` `{build_type: "release", repository: {id, name, url}, release, asset, version}`.
9. When replacing, delete with `only_ids` set to the snapshot taken just before the upload (`find_extension_ids`). A failure is logged and returned as `warning`.
10. When `deploy` is set, call `restart_cep`, which is best effort (see [engine-status-and-restart.md](engine-status-and-restart.md)).

### UI pieces

| Piece | Role |
|---|---|
| [github-release.service.ts](../../analytics-ui/src/shared/github-release.service.ts) | `parseOwnerRepo` (accepts `api.github.com/repos/...` and `github.com/...` URLs), `listReleases`, status to message mapping (401, 403 and 429, 404, other). Returns metadata only. |
| [extension-wizard.component.ts](../../analytics-ui/src/repository/wizard/extension-wizard.component.ts) | Step lists per source and backend availability, release and asset selection, review note, `deployRelease`, the restart panel. |
| [repository-backend.service.ts](../../analytics-ui/src/shared/repository-backend.service.ts) | `deployReleaseAsset` posts to the service. On failure it shows the service's `error` text if present and throws, so the wizard only marks the result failed. |
| [utils.ts](../../analytics-ui/src/shared/utils.ts) | `triggerBrowserDownload`: an anchor click in a new tab with `rel=noopener`. |
| [release-list](../../analytics-ui/src/repository/release-list/release-list.component.ts) | Static mockup, kept out of the navigation. |

The wizard picks the step list when the source is chosen and the backend probe has finished. The probe result is cached, see [backend-and-browser-mode.md](backend-and-browser-mode.md).

### Traps

- **The version check is a UI guard.** `versionWarning` compares the asset version with the installed `build_information.version` using `compareVersions` (`undefined` means no warning). `replaceAnyway` gates `canContinue` on the review step and is reset when the review step loads or the selection changes. The service does not compare versions.
- **Replace is decided in the UI from the installed list and enforced in the service.** The wizard sets `replace` whenever an extension of that name is installed. A user with only the Create role therefore gets a 403 on exactly that path, because the wizard does not check roles.
- **`deploy` is never sent by the wizard.** The restart goes through the UI's own restart call with the user's platform rights. The service's `deploy` flag exists for API callers.
- **The version splitter exists twice.** The service (`split_extension_version`) and the UI (`splitExtensionVersion`) each implement it. They must agree, or the review note and the stored name diverge. See [extension-naming-versioning.md](extension-naming-versioning.md).
- **Listing releases uses the same token order as the service**: the repository token, then the global token, then none.
- **No size check in the UI.** The user learns about the limit from the 413 message.

### Limitations

- The download is held completely in memory, up to 100 MiB, per request.
- The service does not verify the content of the zip. The engine decides at the next restart whether the extension loads, and may enter safe mode, see [engine-status-and-restart.md](engine-status-and-restart.md).
- Only the first page of releases that GitHub returns is read (no paging).



**Decided: documented as is.** A user who only holds the Create role gets a 403 at the end of a replace. The UI does not check service roles, see [roles-and-security.md](roles-and-security.md).
