# Repository layouts and extension builder

Two layouts of GitHub repositories are supported as the source of an extension: a repository where each top-level `.mon` file or directory is an extension (or part of one), and a repository that describes its extensions in an `extensions.yaml` file. This page explains how the layouts are detected, how the extension zip is produced in the browser and in the backend, and what ends up inside it.

Related pages: [add-extension-wizard.md](add-extension-wizard.md), [block-library.md](block-library.md), [backend-and-browser-mode.md](backend-and-browser-mode.md), [repository-configuration.md](repository-configuration.md), [extension-naming-versioning.md](extension-naming-versioning.md). The API-level description is [../api/repository-layouts.md](../api/repository-layouts.md); the in-app help text must stay in line with it.

---

## Requirements

**Layout 1: directory is extension.**

- Only the top-level items of the configured repository path are inspected. Nothing is searched recursively.
- A `.mon` file is a single-file candidate. A directory is a candidate that packages everything under it, including subdirectories such as `venv`. Hidden directories (names starting with a dot) are not offered.
- The user sees one row per file and per directory, by name (for example "Difference", "Offset", "Python"), and can choose several. All chosen rows are built together into one extension. When two rows contain a file of the same path, the later row wins.

**Layout 2: `extensions.yaml`.**

- The file is looked for among the same top-level items; one in a subdirectory is not found. File name matching ignores case.
- If it exists, the layout is layout 2 and only its sections are shown, by name. The files inside a section are not shown. A section's files are not limited to `.mon` (for example `plugin.yaml`, `.py` files, `venv/`).
- Without the file, the repository falls back to layout 1.
- Sections cannot be mixed with individual files in one build.
- Each chosen section becomes its own extension, named after the section.

**What each layout needs.**

| | Without the backend service | With the backend service |
|---|---|---|
| Layout 1, `.mon` files | Built in the browser | Built by the service |
| Layout 1, directories | Not available | Built by the service |
| Layout 2, sections | Not available | Built by the service |

The wizard disables the rows that are not available and says why.

**The extension is a valid Apama extension zip.** Whichever way it is built, the content sits under a top-level `files/` folder, because the engine only loads files from there. A flat zip is skipped silently by the engine.

**Blocks register under their names.** The zip contains the metadata events that tell the engine each block's name, description, category, inputs, outputs and parameters. Without them the extension would be present but its blocks would not appear.

**Build files are left out.** Logs, IDE files and build artifacts are not packaged (see the list below).

**A build never exposes the token.** The build information stored on the extension (repository id, name and URL, the monitors or sections used, the build type) never contains an access token.

**Failures are reported with a reason.** An unreachable file, an invalid name, a timeout or a failed build ends with an error message and no extension is created. A partial result is possible for sections.

**Non-goals.** The browser build does not run the Apama block SDK; its metadata is derived from the `.mon` doc comments on a best-effort basis. Building a whole repository path is possible through the API only.

---

## Implementation

### Detecting the layout

[repository-items.service.ts](../../analytics-ui/src/shared/repository-items.service.ts) does it in two steps, after the content list of the repository path was fetched:

- `filterRepositoryItems` and `analyzeRepositoryItems` check whether a non-directory item named `extensions.yaml` exists. If so, only that item is kept and expanded into one row per section; otherwise the `.mon` files and the non-hidden directories are kept.
- `getSectionsFromExtensionYAML` reads the file, `parseYamlSections` parses it with `js-yaml`. It accepts a section as a plain list or as a mapping with a `files` list. A parse error shows "Failed to parse extensions.yaml. Invalid format." A read error results in no sections.
- Each section row copies the descriptor item and adds `isYamlSection`, `extensionsYamlItem` (the descriptor), `sectionFiles` (its `.mon` files) and `installed`. Section rows get random short ids; file and directory rows get `<repositoryId>::<url>`.
- `blockIds` come from reading each `.mon` file (`extractBlockFqns`). A section's block identity is its `sectionFiles`, used for the clash rule in the wizard.

`toBuildInput` ([extension-wizard.logic.ts](../../analytics-ui/src/repository/wizard/extension-wizard.logic.ts)) turns the chosen rows into either `{ sections, monitors: [descriptorItem] }` or `{ monitors: [...items] }`.

### Choosing the builder

[extension-builder.service.ts](../../analytics-ui/src/shared/extension-builder.service.ts) is the single entry point. It asks `RepositoryModeService.isBackendMode()`, which is `AnalyticsService.isBackendServiceAvailable()` (deployed and answering a liveness probe, cached per session).

| Method | Backend mode | Browser mode |
|---|---|---|
| `createExtensionFromList` | `POST /extension/list` | JSZip build in the browser |
| `createExtensionFromYaml` | `POST /extension/yaml` | Refused: alert and status 501 |
| `createExtensionFromRepository` | `POST /extension/repository` | Refused: alert and status 501 |

The wizard only uses the first two, and always with `upload = true`, `deploy = false`, `rebuild = false`.

### Browser build

`createExtensionFromListDirect` builds the zip with JSZip, uploads it with `AnalyticsService.uploadExtension(file, managedObject, 'add')` and returns a response-like `{ status: 200 }` or `{ status: 500 }` so callers need not branch on the mode. It never throws; on failure it shows an alert.

1. Every chosen item that is not a directory is read from GitHub (raw content, with the resolved token) and put at `files/<file name>`. Directories are skipped, which is why the wizard disables them without the backend.
2. Excluded: file names ending in `.log`, `.classpath`, `.dependencies`, `.project`, `.deploy`, `.launch`, `.out`, `.o`, and anything under `.git/` or `.github/`. This follows the documented exclude list of the block SDK.
3. For each `.mon` file, `parseApamaBlockMetadata` ([apama-block-metadata.ts](../../analytics-ui/src/shared/apama-block-metadata.ts)) reads the `package` line and the doc comments and annotations (`@$blockCategory`, `@$inputName`, `@param $input_<id>`, and so on) and produces one metadata entry per block. A block without a doc comment still gets a minimal entry (name = block name, category Utilities, empty description). A file without a package uses the bare name as the block id.
4. Duplicate block ids across files are reduced to one (the engine rejects a duplicate id).
5. If any block was found, two files are added: `files/events/<name>_metadata.evt` (a `BlockMetadata` event with all blocks) and `files/events/<name>_messages.evt` (the `BlockMessages` localization strings).
6. The managed object gets `pas_extension` and `name` set to the extension name and a minimal `build_information` with `build_type: 'external'`, the monitors and an empty file list.

Tags other than the ones needed to show a block correctly (for example `@$derivedName`, `@$titleIsDerived`, `@$isPreviewBlock`) are not parsed.

### Backend build

All three endpoints need the READ role to build. Uploading needs the create role, deploying (restart) and replacing need more (see [roles-and-security.md](roles-and-security.md)). Common rules in [app.py](../../analytics-service/src/app.py):

- The request must be a JSON object. The repository is given by id only; the service loads its configuration, with the stored token, from the tenant option. A missing repository gives 404.
- The extension name must match `^[a-zA-Z0-9_-]+$`.
- Every URL in the request must be an https GitHub URL inside the configured repository (same owner and repo) and without relative path segments. This stops a request from sending the stored token to another host or repository.
- Files are downloaded into a temporary directory; paths are checked so they cannot leave it.
- The zip is built by the Apama block SDK command `analytics_builder build extension --input <dir> --output <name>.zip`, with a timeout (`BUILD_TIMEOUT_SECONDS`, default 600). The SDK creates the `files/` layout, the metadata events and applies the exclude list, so the service does not duplicate them.
- With `upload = false` the zip is returned as a download. With `upload = true` it is stored as an extension binary whose managed object carries `pas_extension`, `name` and `build_information`, and the response is 201 with `{ id, message }`.
- With `rebuild = true` the existing extension of that name must exist (404 otherwise). It is deleted only after the new one was uploaded, never before, and a failed delete yields a warning in the response, not an error. The wizard does not use rebuild.
- With `deploy = true` the engine is restarted after the upload. The wizard does not use this either; the restart is offered afterward.

**`POST /extension/list`.** Body: `extension_name`, `monitors` (at least one, each with `url`, `name`, `type` of `file` or `dir`), `repository.id`, and the flags. A `file` is downloaded through the Contents API. A `dir` is downloaded recursively with a single Git Trees request (`git/trees/<branch>?recursive=1`) and the files are fetched from `raw.githubusercontent.com`, which avoids one API call per folder and saves the core API rate limit. If GitHub truncated the tree, a warning is logged and files may be missing. All items go into the same build directory; on a name clash the later item overwrites the earlier one. The monitors stored in the build information are reduced to known fields (`id`, `name`, `file`, `type`, `url`, `repositoryId`, `repositoryName`, plus `blockIds`), at most 500.

**`POST /extension/yaml`.** Body: `yaml.url`, `sections` (a list; empty means every section), `repository.id`, and the flags. The service fetches and parses `extensions.yaml` and, for every selected section that exists in the file:

1. validates the section name as an extension name (an invalid name is a failed section),
2. requires the section to be a mapping with a `files` list of relative paths (no leading slash), otherwise it is a failed section,
3. skips a section with an empty list,
4. downloads each listed file from `<repository url>/<path>` (a `venv/` entry is a directory),
5. builds and uploads one extension named after the section, with `build_type: 'yaml'` and the section name, files and the descriptor reference in its build information.

The engine restart (`deploy`) runs once after the loop, and only if at least one section succeeded. The response is 201 when every section was uploaded, 207 with `uploaded_extensions` and `failed_sections` when some failed, and 400 when all failed. Without `upload` the first successful section's zip is returned.

**`POST /extension/repository`.** Builds the whole configured repository path as one extension. It exists in the API and in `ExtensionBuilderService`, but no screen uses it.

### Traps

- **Plain-list sections.** The UI and the backend both accept a section given as a plain list of files or as a mapping with a `files` key.
- **Section names are extension names.** A section name with a dot or a space is a failed section.
- **Browser and backend differ for directories and metadata.** The browser path cannot package directories, and its metadata is derived by this app's parser. The backend uses the SDK. The same `.mon` files can therefore yield slightly different metadata depending on the mode.
- **The descriptor is excluded from the "installed" check.** `extensions.yaml` itself is never a row and never marked installed; only its sections are.
- **`monitors[0]` carries the descriptor for a section build.** The yaml request reuses the first monitor slot to pass the descriptor item.

### Limitations

- Section detection is only at the top level of the configured path.

**OPEN QUESTION:** The exclude list and metadata generation of the backend are those of the Apama block SDK, which is not part of this repository. Is the browser exclude list (and its documented source) meant to track the SDK, and who keeps it in sync?
