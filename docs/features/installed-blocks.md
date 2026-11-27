# Installed blocks

The **Installed blocks** tab lists every block the Streaming Analytics engine has loaded, whatever extension it came from. It answers "what can I use in Analytics Builder right now?" and "which extension does this block belong to?". It reads the engine, not the inventory, so it shows what is really loaded.

See [extensions-management.md](extensions-management.md) for the extensions themselves, [block-library.md](block-library.md) for blocks that can be added, and [extension-naming-versioning.md](extension-naming-versioning.md) for how a block is assigned to an extension.

---

## Requirements

**What it is for.** Showing the blocks that are active in the engine, with the information needed to find one and to tell built-in blocks from custom ones.

- **The tab is the third of three.** The order is Extensions, Block library, Installed blocks.
- **The grid shows one row per loaded block** with these columns, in this order: Name, Category, Description, Extension Name, Custom Block. The grid is titled "Blocks in the engine".
- **Category is always filled.** The category the block declares is shown. A block that declares none gets one derived from its name and description, and falls back to Utility. The seven categories are Input, Output, Logic, Calculation, Aggregate, Flow manipulation and Utility.
- **Custom Block says whether the block is not part of the product.** Built-in blocks (those of Analytics Builder, the core analytics kit and the Cumulocity analytics kit) are not custom. Every other block is.
- **Extension Name is the installed extension that provides the block**, without a version (`Abs`, not `Abs-1.0.1`). It matches the name on the Extensions tab.
- **A block appears once.** An extension that the engine lists in more than one form is read once.
- **Unusable entries are skipped, not fatal.** A block without id or name is left out. One unreadable extension does not hide the blocks of the others.
- **The list reflects the last restart.** A block of a just-added extension appears after the engine has restarted, and a deleted extension's blocks disappear after the restart. The tab reloads itself when a restart completes.
- **Opening the tab and pressing Refresh always read the engine anew**, not a remembered answer.
- **While loading**, a message says that the metadata is being loaded and may take a while. With no blocks, an empty state says "No blocks loaded." and to wait for Streaming Analytics to load blocks.
- **A temporary failure during a restart shows no error.** A genuine failure shows "Could not load deployed blocks. Please refresh." and the grid is empty.
- **The grid is read-only.** There are no row actions. Add, update, delete and rebuild happen on the Extensions tab.
- **Not a goal:** the tab does not mark blocks of a not-loaded extension, and it does not show safe mode. In safe mode it shows what the engine still reports (see [extensions-management.md](extensions-management.md)).

---

## Implementation

### Parts

| Part | Where |
|---|---|
| `BlockGridComponent` | [block-grid.component.ts](../../analytics-ui/src/block/block-grid.component.ts), [.html](../../analytics-ui/src/block/block-grid.component.html) |
| Deployed block loading, categories | `getDeployedBlocks`, `loadDeployedBlocks`, `addBlockMetadata`, `determineBlockCategory` in [extension-enrichment.service.ts](../../analytics-ui/src/shared/extension-enrichment.service.ts) |
| Custom flag | `isCustomCepBlock` in [utils.ts](../../analytics-ui/src/shared/utils.ts) |
| Cell renderers | `LabelRendererComponent` (category label), `BooleanRendererComponent` (custom) in [shared/component](../../analytics-ui/src/shared/component) |
| Route | `ROUTES.installedBlocks`, label `PAGE_LABELS.installedBlocks`, tab priority 920 |

### Data

`BlockGridComponent.loadBlocks()` calls `clearAllCaches()` and then `AnalyticsService.getDeployedBlocks()`. The caches are cleared on every load, so the grid never shows a memoized list. The method uses `markForCheck` because the shell may run without zone.js. The data grid's `refresh` emitter and the Refresh button both call `loadBlocks()`.

`loadDeployedBlocks()`:

1. Read `block-metadata.json` from the correlator (`CEP_PATH_METADATA_EN`). No entries gives an empty list.
2. Collapse the entries with `removeFileExtension`, because the list can hold both `<name>.json` and `<name>.zip` for one extension. Without this a block would appear twice.
3. For each name, `getDeployedExtensionDetails(name)` (memoized per name, shared with the Extensions tab, so no second HTTP fetch). It resolves a versioned registration to the stored name and returns `name` as the extension name.
4. Map each block of `analytics[]` through `addBlockMetadata(block, ext.name)`.

`addBlockMetadata` trims `id` and `name`, skips the block with a warning when either is missing (an empty id would crash `isCustomCepBlock`), and sets `custom`, `extension` and `category`. Fields `repositoryName` and `repositoryId` stay unset: deployed blocks have no originating repository.

### Category

The engine's own `category` wins. Otherwise `determineBlockCategory` splits name and description into whole words (camelCase is split, plural `s` is tolerated) and checks keyword lists in a fixed order. The first match wins and Utility is the default:

| Order | Category | Example keywords |
|---|---|---|
| 1 | Input | input, trigger, measurement, event |
| 2 | Output | output, send, http, email, alarm |
| 3 | Aggregate | sum, count, average, aggregate, statistics |
| 4 | Calculation | math, calculation, operation, multiply, limit |
| 5 | Logic | if, compare, filter, logic, condition |
| 6 | Flow manipulation | delay, rate, throttle, flow, state |
| 7 | Utility | random, generator, constant, noise |

Whole-word matching is deliberate: a substring test would classify "Notification" as Logic because of "if", and "Prevent" as Input because of "event". The order means a block called "Alarm Input" is an Input.

### Custom flag

`isCustomCepBlock` is true unless the block id starts with `apama.analyticsbuilder.blocks`, `apama.analyticskit.blocks.core` or `apama.analyticskit.blocks.cumulocity`. The flag is a property of the id, not of where the block was installed from.

### Failure handling

- An extension whose details cannot be read counts as failed. The list is returned without its blocks and is **not** memoized, so the next call retries. The failed details are evicted from their own memo too.
- A failed list load throws a `CepError`. During a restart (`isExpectedTransientError`) no toast is shown, since the restart toast already explains it. `loadBlocks()` rethrows after resetting `loading`, so the grid shows the empty state.
- The same deployed block list feeds the Block library (installed markers, see [block-library.md](block-library.md)) and the repository service's installed checks.

### Tests

[block-grid.component.spec.ts](../../analytics-ui/src/block/block-grid.component.spec.ts) (title, loading, fresh caches, refresh, column order) and [extension-enrichment.service.spec.ts](../../analytics-ui/src/shared/extension-enrichment.service.spec.ts) (collapsing, skipped blocks, categories, partial results).

### Limitations and open questions

- The grid uses the platform default page size. The tab sets no page size of its own.
- The tab loads the first time without waiting for the engine to be up. While the engine is down it ends as an empty grid, not as the "engine unavailable" state of the Extensions tab. `ngOnInit` also awaits the first load before it subscribes to `refresh`, so a failed first load leaves the data grid's own refresh unwired (the Refresh button still works).
- Only the Name column is explicitly visible. The other columns rely on the data grid's defaults.
- **OPEN QUESTION:** Should the tab show the engine state (down, restarting, safe mode) like the Extensions tab, instead of an empty grid?
- **OPEN QUESTION:** Should the Custom Block flag mean "not from the product" by id prefix, as now, or "installed through this solution"? Blocks from other sources of extensions on the tenant are treated the same today.
