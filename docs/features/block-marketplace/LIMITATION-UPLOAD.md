# Limitation: deploying a GitHub Release asset still needs a manual "select the file" step

## The problem

"Deploy from GitHub Release" (`analytics-ui/src/repository/release-deploy/`) lets a user
pick a repository → release → pre-built extension `.zip` asset, then click **Deploy**. Today
that takes three interactions instead of one:

1. Pick repository / release / asset, click **Deploy**.
2. Browser downloads the zip to disk (native download, triggered by the click).
3. User manually drags the just-downloaded file onto the upload drop-area, or clicks it to
   browse and select it — before the extension actually gets uploaded to Cumulocity.

The ask: collapse this to a single click, in pure browser mode, with no backend/microservice
component.

## Root cause: GitHub's release-asset CDN sends no CORS header

Verified live against `Cumulocity-IoT/analytics-builder-blocks-contrib`:

- Listing releases/assets (`api.github.com/repos/.../releases`) *is* CORS-open
  (`Access-Control-Allow-Origin: *`) — this is why repository/release/asset browsing already
  works via a plain `fetch()`, no proxy needed.
- The asset **bytes** are a different story. Both the public `browser_download_url` and the
  authenticated `.../releases/assets/{id}` endpoint (`Accept: application/octet-stream`) return
  a `302` redirect to a signed URL on `release-assets.githubusercontent.com` (Azure Blob
  Storage). That final response carries **no `Access-Control-Allow-Origin` header at all**:

  ```
  GET https://api.github.com/repos/.../releases/assets/354844623   (Accept: application/octet-stream)
    → 302 location: https://release-assets.githubusercontent.com/...&sig=...
  GET https://release-assets.githubusercontent.com/...              (redirect target)
    → 200, no access-control-allow-origin header
  ```

- Per the Fetch spec, a cross-origin redirect chain must pass the CORS check on *every* hop.
  `api.github.com`'s own redirect is CORS-open, but the CDN that actually serves the bytes is
  not — so `fetch()`/`XHR` in `cors` mode cannot read the response body, for public or
  PAT-authenticated requests alike. This is a platform behavior of GitHub's release CDN, not
  something a request header or token scope can work around.
- This is *not* the same as the source-tree case: `raw.githubusercontent.com` (git blob
  content, used by the "browse a repo's `.mon` files" flow) **does** send
  `Access-Control-Allow-Origin: *` end to end. Only the compiled *release-asset* CDN lacks it.

The reason today's flow uses a plain `<a href="..." download>` click instead of `fetch()`: a
top-level browser navigation/download is not a CORS-governed request at all, so it succeeds
where `fetch()` would fail. The trade-off is that a native download hands the bytes straight to
disk — the page's JS never sees them, so a second, separate user action is required to hand the
file back to the upload code (drag-drop or a file-picker `<input type=file>`).

Browsers also refuse to let a single click drive both of these actions: triggering the native
download consumes that click's user-activation token (a security mechanism — one
activation-gated action per gesture), so immediately opening a file picker in the same handler
is silently blocked, confirmed by testing. Hence: two separate real clicks, minimum, without a
proxy.

## Options considered

| Option | What it buys | Cost |
|---|---|---|
| **A. UX-only polish, keep 2 clicks** | Still two clicks, but the second one is friction-free: the file picker opens directly in the Downloads folder (via the File System Access API's `showOpenFilePicker({ startIn: 'downloads' })`) instead of the OS's last-used directory, so the user just clicks the file instead of navigating to find it. Falls back to the existing drag-and-drop/browse `c8y-drop-area` on non-Chromium browsers (Firefox/Safari don't support this API). | None — no new dependency, no data leaves the browser/GitHub/Cumulocity. |
| **B. Third-party public CORS proxy** | Routes the asset download through a public CORS-relay (e.g. `corsproxy.io`) so `fetch()` can read the bytes directly, genuinely reaching one click. | The extension zip's bytes transit an external, unaffiliated third-party service before reaching Cumulocity. For proprietary/private block zips this is a real trust and privacy trade-off, and public CORS proxies are not something to depend on for reliability (rate limits, uptime, could disappear). Not implemented. |
| **C. Small backend proxy/microservice** | Would make it fully one-click and trustworthy (fetch-and-relay server-side). | Reintroduces exactly the kind of backend component this feature is trying to remove — explicitly out of scope per `REQUIREMENTS.md`'s "Explicitly Out of Scope" and NFR4. Not implemented. |
| **D. Leave as-is** | Zero code change. | Keeps the "drag it from your downloads tray" friction. |

**Chosen: Option A**, refined once further: `showOpenFilePicker` can only *open a file list*
in Downloads, not pre-select the specific file in it — `suggestedName` exists only on the
*save* picker, not the *open* one. So the button initially just saved one "navigate to
Downloads" step, still leaving a manual click on the file itself every time.

Went one step further using `showDirectoryPicker` instead: once the user grants access to the
Downloads *directory* (a single native "Allow access to this folder?" prompt, not a file
browser), the code holds a `FileSystemDirectoryHandle` and can call
`getFileHandle(exactAssetName)` to grab the just-downloaded file **by name**, no list, no click
on a file at all. The handle is persisted in IndexedDB (`FileSystemDirectoryHandle` is
structured-cloneable) so only the *first* deploy per browser profile needs the prompt; later
deploys just re-check `queryPermission()` (no UI, no user gesture spent) and go straight to the
file — genuinely one click end-to-end after the first grant.

Two things this has to handle that a plain "open the file the user clicks" flow doesn't:

- **The download may still be in flight** when the button is clicked (these zips are tiny, but
  it's not guaranteed) — `waitForDownloadedFile()` polls `getFileHandle()` for up to 8s before
  giving up.
- **Chrome auto-renames on collision** (`Foo-1.0.1.zip` → `Foo-1.0.1 (1).zip`) if a file of
  that name already exists in Downloads from a previous deploy of the same asset. The poll also
  checks for `"<base> (<n>)<ext>"` siblings and picks the highest `<n>` (the newest one) if the
  exact name isn't there.
- **Never chains two File System Access dialogs in one click.** Calling `showDirectoryPicker`
  and then, on failure, falling back to `showOpenFilePicker` within the *same* click handler
  would hit the identical activation-consumption wall documented above for
  download-then-file-picker — the second picker call would be silently refused. So the strategy
  is chosen up front per browser support (`showDirectoryPicker` if available, else
  `showOpenFilePicker`), never both in one invocation. If the directory route can't find the
  file (still downloading, or genuinely missing), the user gets a warning and the drop-area
  underneath is still there as the manual fallback — no second automatic attempt.

Implemented in:

- `analytics-ui/src/shared/utils.ts` — `supportsDownloadsFilePicker()` (feature-detects either
  API), `pickFileFromDownloads()` (the plain-picker fallback), and the new
  `pickOrFindDownloadedFile(fileName, accept, description)`, which picks exactly one strategy
  (directory-handle lookup vs. plain picker) and never chains them. The directory-handle
  machinery (`getDownloadsDirectoryHandle()`, `waitForDownloadedFile()`, and a tiny IndexedDB
  wrapper to persist the handle) lives alongside it.
- `analytics-ui/src/shared/wizard/extension-add.component.ts` / `.html` — new optional
  `extraPickLabel` / `extraPickHandler` inputs; when set, a button rendered above the drop-area
  invokes the handler and, if it resolves a file, feeds it straight into the existing
  `onFile()` upload pipeline (zip analysis → extension create/update → `uploadExtension`); if it
  resolves `null`, shows a warning pointing at the drop-area instead of failing silently.
- `analytics-ui/src/repository/release-deploy/release-deploy-wizard.component.ts` / `.html` —
  after triggering the native download, passes `pickDownloadedFileHandler` (wrapping
  `pickOrFindDownloadedFile(selectedAsset.name, '.zip', 'Extension zip')`) into
  `<a17t-extension-add>` when either File System Access API is available; the alert text adapts
  to mention the button vs. the drag-and-drop fallback.

## Still open

- Confirm the `release-assets.githubusercontent.com` CORS gap holds for **private** repos and
  PAT-authenticated requests too, not just the public case tested here (see `CONCEPT.md`
  line 232) — if GitHub ever changes this, options B/C become moot and a direct `fetch()` could
  replace the whole download+pick flow.
- `showOpenFilePicker` is Chromium-only (no Firefox/Safari support as of this writing); those
  browsers keep the original drag-and-drop/browse flow with no regression, just no Downloads
  shortcut.
