# Extensions management

The **Extensions** tab lists the extensions installed on the tenant and shows, for each one, whether the Streaming Analytics engine has loaded it. From a card the user opens the details page, rebuilds, downloads, updates or deletes the extension, or starts the [add extension wizard](add-extension-wizard.md).

An extension is a zip file stored in the Cumulocity inventory. It becomes active only after the engine restarts. See also [extension-upload.md](extension-upload.md), [extension-naming-versioning.md](extension-naming-versioning.md), [installed-blocks.md](installed-blocks.md) and [engine-status-and-restart.md](engine-status-and-restart.md).

---

## Requirements

**What it is for.** Giving the tenant one place to see every installed extension, its state in the engine, and the actions that change it.

- **The tab is the first of three.** The order is Extensions, Block library, Installed blocks. The page title, tab and breadcrumb use the same name.
- **Every installed extension appears once**, as a card, whatever way it was installed (upload, build from a repository, release deployment). The list is not limited to a page size.
- **A card shows**: the extension name, a Loaded or Not loaded label, the build type (or "Unknown" without build information), the block count for a loaded extension, and the date of the last update. An extension that carries code instead of blocks shows "Code Extension" instead of a count.
- **Loaded means the engine reports the extension.** A freshly added or updated extension shows Not loaded until the engine has restarted. The page offers "Restart to deploy extension" for that.
- **Loaded is recognized for versioned and unversioned engine names alike.** An extension stored as `Abs` is shown as loaded when the engine registered it as `Abs-1.0.1`. See [extension-naming-versioning.md](extension-naming-versioning.md).
- **While the engine is down or restarting, no extension list is shown**, only a message that the engine is unavailable and a loading indicator. The list never flashes an empty state while it is still being fetched.
- **An empty tenant shows an empty state** with an "Add extension" button.
- **In safe mode nothing is loaded.** A warning banner explains this, every card shows Not loaded with zero blocks, and the extension changed last (if within 24 hours) is marked as the suspected cause with a Delete shortcut.
- **Card actions**: Details, Rebuild, Download, Delete, Update.
  - **Details** is available only for an extension that has build information.
  - **Rebuild** is available only for extensions built from a repository, a list or a YAML section, and only when the backend service is available. It asks for confirmation, then rebuilds from the stored build information and replaces the installed extension.
  - **Download** saves the stored zip as `<name>.zip`.
  - **Delete** asks for confirmation, naming the extension. Nothing is deleted when the user declines.
  - **Update** opens the upload dialog for replacing the extension. See [extension-upload.md](extension-upload.md).
- **Details page** shows three sections: Blocks (id, category, description), Files (every file of the package, without the internal `files/` prefix, each once) and Build information (build type, version, repository name and link). Without build information it says so. A package that defines no blocks, or is not loaded, shows an explanatory empty state in the Blocks section.
- **A change shows up without a manual refresh.** After add, update, delete or rebuild, and after an engine restart completes, the list reloads. A Refresh button reloads on demand and bypasses cached data.
- **A temporary load failure stays quiet.** Right after a restart the engine can answer with 502 for a few seconds. The page retries and shows no error. Only a genuine failure shows a warning.
- **Update from a card can ask before it uploads.** If the chosen package resolves to another extension, or to a version that is older than or equal to the installed one, the user is asked to confirm. It never blocks. See [extension-upload.md](extension-upload.md).
- **Not a goal:** deleting or updating does not restart the engine. The user decides when to restart.

---

## Implementation

### Components and routes

| Part | Where | Role |
|---|---|---|
| `ExtensionGridComponent` | [extension-grid.component.ts](../../analytics-ui/src/manage/extension-grid.component.ts) | The page: engine status, safe mode, load and retry, action bar (Add extension, Restart, Refresh) |
| `ExtensionCardComponent` | [extension-card.component.ts](../../analytics-ui/src/manage/extension-card.component.ts) | One card and its actions: details, rebuild, download, delete, update |
| `ExtensionDetailsComponent` | [extension-details.component.ts](../../analytics-ui/src/manage/extension-details.component.ts) | Split view with the sections `blocks`, `files`, `build` |
| Resolvers | [resolvers.ts](../../analytics-ui/src/manage/resolvers.ts) | `backendResolver` (is the backend usable), `extensionResolver` (engine's view of one extension) |
| Routes and labels | [analytics.constants.ts](../../analytics-ui/src/shared/analytics.constants.ts), [analytics-tab.factory.ts](../../analytics-ui/src/shared/analytics-tab.factory.ts) | `ROUTES.manage`, `PAGE_LABELS`, tab priorities 960 / 940 / 920 |

The grid is the route `manage`, the details page is `manage/details/:name`. The card navigates with the extension in the router state, and the details page falls back to the browser history state when the state is gone (reload of the page).

### Loading the list

`getEnrichedExtensions()` in [extension-enrichment.service.ts](../../analytics-ui/src/shared/extension-enrichment.service.ts) combines three sources in parallel:

1. the inventory list (`pas_extension` fragment, pages of 100, until a short page), from [extension-inventory.service.ts](../../analytics-ui/src/shared/extension-inventory.service.ts);
2. the engine's `block-metadata.json` (the registered extensions);
3. the engine's diagnostics `extensionNames` (zip extensions with their contents).

Each inventory entry gets `loaded`, `blocksCount` and `extensionType` added. The result is memoized and cleared by `clearAllCaches()`, by upload and delete in `AnalyticsService`, and by the Refresh button.

An extension counts as loaded when its name (or its name plus a version) is in the metadata, or when the diagnostics list has `<name>.zip`. A diagnostics match sets `extensionType: 'zip'`, which the card shows as "Code Extension" instead of a block count. The block count comes from the engine's per-extension JSON.

### Stream in the grid

`extensions$` is `combineLatest([reload$, cepStatus$, isSafeMode$])`. Only status `up` triggers a load. Any other status yields `null` (unknown), which is deliberately different from an empty array: `null` shows the loading state, `[]` shows the empty state. `loadExtensions$` emits `null` first, retries transient errors up to 6 times with a 1.5 s step (capped at 6 s) and returns `[]` after a genuine failure, with a warning toast.

The reload trigger merges the Refresh button and `getCacheReloadRequests$()`. The latter fires when a restart completes (`restarting$` goes from true to false in `AnalyticsService`).

### Safe mode

The engine still lists extensions deployed before the loop in safe mode, so enrichment would report them as loaded. `markAsNotLoaded()` overrides `loaded: false` and `blocksCount: 0` for all. The suspect is the extension with the newest `lastUpdated` (fallback `creationTime`), and only if that is younger than 24 hours. Safe mode lasts until the next restart, so without this age limit the next-newest extension would be blamed after the culprit is deleted. The safe mode flag comes from the operation object, with the engine status endpoint as the reliable fallback.

### Actions

- **Delete** calls `AnalyticsService.deleteExtension(extension, true)`, which deletes the binary by inventory id and clears the caches. The grid reloads through `extensionChanged`.
- **Update** opens the wizard `uploadAnalyticsExtension` in `update` mode with `WizardModalService`. See [extension-upload.md](extension-upload.md).
- **Rebuild** switches on `build_information.build_type`: `repository`, `list` and `yaml` call the matching `RepositoryService.createExtensionFromRepository / FromList / FromYaml` with upload, deploy and rebuild set. A `yaml` rebuild rebuilds only `section_name` (all sections when it is missing). A 404 or "no existing extension" answer is reported as "extension was not found, create it again". Rebuild needs repository id in the build information, otherwise it warns and stops. A `release` or `external` extension cannot be rebuilt, so the menu item is disabled for them.
- **Download** uses `InventoryBinaryService.download` and `file-saver`. The file is named after the extension name, so a downloaded version shows no version in its file name.

### Details page

`extensionResolver` calls `getDeployedExtensionDetails(name)`: it fetches `<correlator>/en/<metadataName>.json` and forces `name` back to the stored name. `metadataName` is the exact name or the single versioned registration (see [extension-naming-versioning.md](extension-naming-versioning.md)). A failure returns `null`, so the page still opens with the inventory data. The Files list is the union of `monitors[].file` and `files[].file` from the build information, plus the engine's `contents` for that extension when it is loaded, with the `files/` prefix stripped so paths from both sources deduplicate. The Build information section lists Build Type, Version (when present), Repository Name and Repository Url (opens in a new window with `noopener`).

### Tests

[extension-grid.component.spec.ts](../../analytics-ui/src/manage/extension-grid.component.spec.ts), [extension-card.component.spec.ts](../../analytics-ui/src/manage/extension-card.component.spec.ts), [extension-details.component.spec.ts](../../analytics-ui/src/manage/extension-details.component.spec.ts), [extension-enrichment.service.spec.ts](../../analytics-ui/src/shared/extension-enrichment.service.spec.ts).

### Limitations and open questions

- The details route parameter is the extension name. Two extensions with the same name cannot be told apart (the inventory can hold duplicates if one was created outside the UI).
- Rebuild needs the backend service (the build runs there). A `release` or `external` build is never rebuildable from the card.
- The Details menu item is disabled without build information, but the details page also works without it for the Blocks section. This is the current code, not a rule.
- **OPEN QUESTION:** Should the Details action stay unavailable for an extension without build information (for example one created by an older version), although its blocks and files could still be shown?
- **OPEN QUESTION:** Should a card for a `release` build offer "Update from release" (rebuild equivalent), or is Update with a manual file the intended path?
