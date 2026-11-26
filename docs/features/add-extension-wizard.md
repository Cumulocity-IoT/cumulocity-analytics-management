# Add extension wizard

One guided path for adding an extension to the tenant: deploy a release from GitHub, build a new extension from one repository, or upload a zip file. It opens in a bottom drawer from the Extensions and Block library tabs, and it is the only way to add an extension in the UI.

Related pages: [block-library.md](block-library.md), [release-deployment.md](release-deployment.md), [extension-upload.md](extension-upload.md), [repository-layouts-and-builder.md](repository-layouts-and-builder.md), [extension-naming-versioning.md](extension-naming-versioning.md), [engine-status-and-restart.md](engine-status-and-restart.md), [backend-and-browser-mode.md](backend-and-browser-mode.md).

---

## Requirements

**Three sources, one entry point.** The first step asks what the user wants to do: deploy a release, build a new extension, or upload a file. A caller that already knows the path can skip this step.

**The steps depend on the source and on the backend service.**

| Source | Backend service available | Steps |
|---|---|---|
| Deploy a release | yes | Source, Repository, Release and asset, Review, Result |
| Deploy a release | no | Source, Repository, Release and asset, Download, Upload |
| Build a new extension | yes or no | Source, Repository, Content, Name, Review, Result |
| Upload a file | yes or no | Source, Upload |

- **An extension is built from exactly one repository.** Items of two repositories are never mixed.
- **Rules are visible before the click.** Every row of the Content step that cannot be chosen is disabled and shows the reason next to it. A row is not selectable when:
  - it is already installed,
  - it is a file that is not a monitor file (`.mon`),
  - it is a directory or an `extensions.yaml` section and the backend service is not deployed,
  - it is an `extensions.yaml` section and individual files are chosen (or the other way round),
  - it defines the same block as a row that is already chosen (the engine refuses an extension that defines a block twice).
- **Next is blocked, with a stated reason.** The Next button is disabled until the step is complete and a hint says why: no repository, no asset, file not downloaded, nothing selected, two chosen rows define the same block, or an empty name.
- **The name is suggested.** After the Content step the name field is prefilled with the name of the first chosen item (without `.mon`). The user can change it. The field shows the resulting file name (`<name>.zip`).
- **Review before anything happens.** The Review step shows the repository and either the release, asset, extension name and version (release) or the extension file name and the chosen items (build). A release that replaces an installed extension says so, including the installed version. The step also lists what happens next.
- **The result is explicit.** Creating shows a progress state, then success or failure. Failures show an alert with the reason; nothing is retried automatically.
- **The restart is optional and offered the same way after every path.** After a successful build, release deployment or upload, the drawer offers **Restart now** and **Done**. No path restarts the engine on its own, so running models are not interrupted unless the user chooses it. After the user starts the restart, the drawer shows its progress and a failure.
- **Selected blocks skip the first steps.** When the user has ticked rows in the Block library, the wizard starts as a build from that repository with those rows chosen. If every ticked row could be chosen, it starts at the Name step. Otherwise it starts at the Content step so that the user sees which rows were left out and why.
- **The caller learns whether something was added.** When the drawer closes, the Extensions and Block library tabs reload their lists only if an extension was added.
- **A release repository without releases offers a way out.** The wizard says the repository has no releases, marks it in the repository list, and offers to choose another repository or to build from the same repository.

**Non-goals.**

- The wizard does not build from a whole repository path. That endpoint exists in the backend but the wizard does not use it.
- The wizard never restarts the engine as part of an add.
- The wizard does not replace an existing extension of the same name for the build path (see Limitations). Release deployment does, by asking first on the review step.

---

## Implementation

### Parts

| Part | Role |
|---|---|
| [extension-wizard.service.ts](../../analytics-ui/src/repository/wizard/extension-wizard.service.ts) | `ExtensionWizardService.open()` opens the component in a `BottomDrawerService` drawer (`closeOnNavigation: true`). The argument is a plain source (`'release' \| 'build' \| 'upload'`) or an object with `source`, `repositoryId` and `selectedIds`. It returns an observable that emits once on close with `ref.instance.added`. |
| [extension-wizard.component.ts](../../analytics-ui/src/repository/wizard/extension-wizard.component.ts) | The wizard. All state is signals: `source`, `stepIndex`, `repositories`, `repositoryId`, `backendAvailable`, `items`, `selectedIds`, `name`, `releases`, `releaseId`, `assetId`, `result`, `restartState`. |
| [extension-wizard.logic.ts](../../analytics-ui/src/repository/wizard/extension-wizard.logic.ts) | Pure functions with the content rules (`evaluateContent`, `findSelectionConflicts`, `toBuildInput`). Unit tested in `extension-wizard.logic.spec.ts`. |
| [extension-add.component.ts](../../analytics-ui/src/shared/wizard/extension-add.component.ts) | The embedded uploader used by the Upload step. |

### Step lists

`steps(source, backendAvailable)` returns the list of step ids; `step` is `steps()[stepIndex]`. `backendAvailable` comes from `AnalyticsService.isBackendServiceAvailable()`, which is read in `ngOnInit` (a failure counts as not available). The list is recomputed when it changes, so a late answer can change the Release path from the download variant to the review variant. The stepper in the header is drawn from the same list. Moving on is done by `next()`, which also triggers the work of the step it enters:

| Transition | Work |
|---|---|
| Repository to Content | `loadItems()` through `RepositoryService.getRepositoryItemsAnalyzedFor(repositoryId)` |
| Repository to Release | `loadReleases()`: parse owner and repo from the URL, read the real token, list releases through `GitHubReleaseService`. The newest release is preselected; a single `.zip` asset is preselected too. |
| Content to Name | `suggestName()` |
| Anything to Review (release) | `loadInstalledExtension()` finds an installed extension with the asset's base name, for the replace note |
| Review to Result | `create()` |

Changing the source or the repository calls `resetSelections()`, which clears items, selection, name, releases and the download flag. A release path can switch to a build with `buildFromRepository()`.

### Content rules

`evaluateContent(items, selectedIds, backendAvailable)` returns a `ContentState` per row (`disabled`, `reason`, `conflictsWith`). The first matching rule wins:

1. Already installed.
2. Section: needs the backend; cannot be combined with individual files.
3. Directory: needs the backend. The browser build skips directories, so their content would be lost.
4. File that is neither `.mon` nor `extensions.yaml`: not a monitor file.
5. Individual item while a section is chosen: cannot be combined with sections.
6. Block clash: the item's `blockIds` (or `sectionFiles` for a section) overlap with those of a chosen item. Directories have no `blockIds`, so they are never checked for clashes.

Chosen rows are always enabled, so the user can untick them. `toggleAll()` ticks one row at a time and re-evaluates after each tick, so the second of two clashing rows is left out. `findSelectionConflicts()` is a second line of defense: if two chosen rows still define the same block, Next stays disabled with "Untick the items that define the same block". The reason strings are static `gettext` keys and `reason()` fills `{{blockName}}` through `MessageService.format`.

### Starting from selected blocks

`ngOnInit` calls `startFromSelection(repositoryId, ids)` when both `initialRepositoryId` and a non-empty `initialSelectedIds` are set. It sets the source to build, loads repositories and the backend flag in parallel, jumps to the Content step, loads the items and then adds each wanted id one by one through `evaluateContent`, so a row that is installed or conflicts is dropped. When all wanted ids survive, the name is suggested and the step index moves to Name. Row ids are `<repositoryId>::<url>` for files and directories, and a random short id for sections (see [repository-layouts-and-builder.md](repository-layouts-and-builder.md)). Because section ids are random and regenerated on every load, a selection survives only while the same listing is in memory.

### Create

`create()` branches on the source:

- **Release**: `RepositoryService.deployReleaseAsset(repository, asset, tag, deploy = false, replace = !!installedExtension)`. See [release-deployment.md](release-deployment.md). A returned `warning` is shown as a warning alert.
- **Build with sections**: `createExtensionFromYaml(name, yamlItem, sections, repository, upload = true, deploy = false)`.
- **Build with files or directories**: `createExtensionFromList(name, monitors, repository, upload = true, deploy = false)`.

`ExtensionBuilderService` then decides between backend and browser build (see [repository-layouts-and-builder.md](repository-layouts-and-builder.md)). Success means an HTTP status below 400, then a success alert and `result = 'done'`. Errors are logged and the result becomes `failed`; the services already showed an alert.

### Upload and restart

The Upload step embeds `ExtensionAddComponent` with `mode = 'add'` and a handler that calls `AnalyticsService.uploadExtension`. On Chromium browsers a "Select the downloaded file" button opens a file dialog in the Downloads folder (`pickZipFromDownloads`); other browsers keep the drop box. In the no-backend release path the Download step starts the browser download (one user gesture starts one download) and offers "I already have the file" to skip it.

`completed` is true for a finished build or release (`result` done) or a finished upload. Then the footer shows **Done** and **Restart now**. `restartNow()` calls `AnalyticsService.restartCepEngine()` and tracks `restartState` (`idle`, `running`, `done`, `failed`). `finish(added)` sets `added` and closes the drawer.

### Limitations

- **Build name is not validated in the wizard** beyond "not empty". The backend accepts only letters, digits, hyphens and underscores and answers 400 otherwise. The browser build has no such check.
- **Sections are named after the section.** When the selection contains `extensions.yaml` sections, the step list drops Name (`hasSections`), the Review step shows "Each section becomes its own extension, named after the section." and omits the `<name>.zip` row. The wizard passes the first section name as the (ignored) `extension_name`.
- **A partial section build is shown as partial.** `POST /extension/yaml` answers 207 with `uploaded_extensions` and `failed_sections`. `parseSectionOutcome` reads them into `sectionOutcome`, `result` becomes `partial`, and the Result step lists created sections and failed sections (name plus error). A 207 with nothing created is `failed`. `completed` is true for `partial`, so the restart is offered.
- **A build with an existing extension name adds a second extension.** The wizard passes `rebuild = false`, and neither the backend nor the browser path checks for an existing name on the build path.
- The Content step is the only place that uses the backend flag for rules; the flag is read once when the drawer opens.
