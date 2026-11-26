# Block library

The Block library tab lets a user browse the blocks of one configured GitHub repository, see which of them are already installed, and start the add-extension wizard with the blocks they ticked. It is the second tab, between Extensions and Installed blocks.

Related pages: [add-extension-wizard.md](add-extension-wizard.md), [repository-configuration.md](repository-configuration.md), [repository-layouts-and-builder.md](repository-layouts-and-builder.md), [installed-blocks.md](installed-blocks.md), [backend-and-browser-mode.md](backend-and-browser-mode.md).

---

## Requirements

**One repository at a time.** A repository drop-down in the action bar lists every configured repository. The grid shows the items of the chosen one. The first repository is chosen on first load. If the chosen repository is deleted, the page falls back to the first one that remains. With no repository, the grid shows an empty state with a button that opens the Repositories drawer.

**The grid says where the items come from.** The title reads "Browse blocks from" followed by the repository name as a badge. The Repository Name column is hidden when all items come from one repository.

**What the list shows.** Per layout (see [repository-layouts-and-builder.md](repository-layouts-and-builder.md)):

- Without an `extensions.yaml` file: the top-level `.mon` files and the top-level directories (hidden directories starting with a dot are left out).
- With an `extensions.yaml` file: only its sections, one row each.

Each row has a name, a type, an installed mark and the repository name.

**Installed items are marked.** A file is installed when any block it defines is deployed in the engine, or when a deployed extension contains a file of that name. A section is installed when every `.mon` file it lists is part of a deployed extension. A section without a `.mon` file is never installed. A file that defines no block (for example a shared event definition) is therefore marked through the deployed file names.

**Hide installed.** A switch hides installed rows. It acts on the list that is already loaded and does not call GitHub again.

**Filtering.** Columns can be filtered in the grid (file, type, installed, repository name).

**Tick rows to start a build.** The grid has checkboxes. The **Add extension** button shows how many rows are ticked. With rows ticked, the button opens the wizard as a build from the shown repository with these rows chosen (see [add-extension-wizard.md](add-extension-wizard.md)). Without a selection it opens the wizard at its first step. The selection is forgotten when the user switches repository and after an extension was added.

**Search by name.** A search box in the action bar narrows the rows to the items whose name contains the typed text, ignoring case. Clearing it shows all rows again. The search works on top of the repository choice and the "Hide installed" switch, and the grid title and repository column do not change while the user types.

**View source.** A file row has a "View Source" action that opens the file content in an editor dialog. If the content cannot be loaded, the user gets an alert and an empty editor.

**Help.** A help button opens a dialog that explains the three ways to add an extension, how to start from ticked rows, the optional restart, and the two repository layouts.

**Backend warning.** While the backend service is not deployed, a "Backend service not deployed" button with a warning icon is shown. Selecting it checks again, so a user who just deployed the service does not have to reload the page. The page works without the backend service, with the limits described in [backend-and-browser-mode.md](backend-and-browser-mode.md) (directories and sections cannot be built).

**Reload.** The reload button re-reads the repositories from the tenant options and clears the item caches, so the list and the installed marks are recomputed from GitHub and the engine.

**The installed marks stay current.** After an engine restart completes, the cached items are discarded so that the marks reflect the blocks that are now deployed.

**Non-goals.** The page does not show items of several repositories together. It does not edit repository files. It does not install anything itself; installing is the wizard's job.

---

## Implementation

[repository-block-grid.component.ts](../../analytics-ui/src/repository/list/repository-block-grid.component.ts) (`a17t-repository-block-grid`, route `repository`) is built on the Cumulocity `c8y-data-grid` with `[selectable]="true"`. The action bar items (repository select, hide-installed switch, Repositories, Add extension, Reload, backend warning, help) are `c8y-action-bar-item` entries with priorities that set their order.

### Data flow

```
selectedRepositoryId$  ┐
hideInstalled$         ┴─ combineLatest ─ switchMap ─> RepositoryService.getRepositoryItemsAnalyzedFor(id)
                                                      └─ filter(!installed) when hideInstalled
```

`getRepositoryItemsAnalyzedFor(id)` ([repository.service.ts](../../analytics-ui/src/shared/repository.service.ts)) re-runs on every cache invalidation and combines three inputs: the configured repositories, the deployed blocks (`getDeployedBlocks`, errors become an empty list), and the base names of all files in deployed extensions (`getDeployedFileNames`, from the engine's extension metadata). [repository-items.service.ts](../../analytics-ui/src/shared/repository-items.service.ts) then does the work:

1. Fetch the top-level content list of the repository, from the backend (`/repository/contentList`) or directly from the GitHub Contents API, depending on the mode. Entries with a `.json` extension are ignored.
2. For each `.mon` file, fetch the raw content and extract all block names it defines (`extractBlockFqns`). The result is cached per repository and URL. A file that cannot be read falls back to its file name, so one flaky file does not break the list.
3. Mark installed: `blockIds` against the deployed block ids, or the file name against the deployed file names.
4. Keep only what the layout shows (`.mon` files and non-hidden directories, or the `extensions.yaml` descriptor), then expand the descriptor into section rows (`analyzeRepositoryItems`).

Row ids are `<repositoryId>::<url>`. They are specific to the repository and file, so the same block in two repositories stays two rows. Section ids are random short ids.

`RepositoryService.updateHideInstalledFilter` also stores the switch in the shared state, which feeds the older all-repositories list. The grid itself filters in the component, so toggling does not reload.

### Page state worth knowing

- The title badge is drawn with a CSS custom property on the grid wrapper, because the grid title is plain text. The name is escaped (backslashes, quotes, line breaks) before it goes into the CSS string.
- `selectedItemIds` is set by the grid's `itemsSelect` event. `addExtension()` passes `{ repositoryId, selectedIds }` only when something is ticked and a repository is chosen.
- The backend status comes from `AnalyticsService.isBackendServiceDeployed()`, cached per session. `recheckBackend()` calls `recheckBackendServiceDeployed()`, which drops the cache and the mode-dependent caches and probes again.
- The page runs without zone.js in some shells, so it calls `markForCheck` after async updates.

### Help dialog

[extension-layout-help-modal.component.html](../../analytics-ui/src/repository/list/extension-layout-help-modal.component.html) holds the text. It must be kept in line with [../api/repository-layouts.md](../api/repository-layouts.md).

### Limitations

- The "installed" mark depends on loaded blocks. If the engine is down or the extension metadata cannot be read, rows may show as not installed.
- Every `.mon` file of the repository is fetched once to find its block names. Large repositories cost one request per file, and GitHub rate limits apply (60 per hour without a token, see [repository-configuration.md](repository-configuration.md)).
- The grid uses the platform default page size. The tab sets no page size of its own.
- The search box only matches item names. Other columns are still narrowed with the column filters.
