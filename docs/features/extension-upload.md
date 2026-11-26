# Extension upload

The upload component takes one zip file from the user, works out the extension's name and version, reads what the package contains, and stores it as an extension. If an extension of that name is already installed, it is replaced after the user confirms. It is used by the **Update** action on an extension card and by the upload step of the [add extension wizard](add-extension-wizard.md).

See [extension-naming-versioning.md](extension-naming-versioning.md) for the name rules and [extensions-management.md](extensions-management.md) for the page that triggers it.

---

## Requirements

**What it is for.** Installing or replacing an extension from a zip file the user already has, without needing the backend service.

- **One zip file at a time.** The drop area accepts a single `.zip` file (drop or click). A progress bar shows while the file is processed.
- **The name comes from the package, not only from the file name.** See [extension-naming-versioning.md](extension-naming-versioning.md) for the rules. A file the browser renamed to `AlarmBand-1.0.1 (1).zip` still installs as `AlarmBand`.
- **The version never becomes part of the name.** `Abs-1.0.1.zip` installs as `Abs`, version `1.0.1`, shown on the details page.
- **The package is analyzed before upload.** Every `.mon` file becomes a block entry with id, and category, description, inputs, outputs and parameters when the package carries block metadata. Other files are listed as files. Operating system and tooling noise (`__MACOSX`, `.DS_Store`, `.git`, `node_modules`) is left out.
- **A file that is not a readable zip is refused** with an error under the drop area, and nothing is stored.
- **Add never silently overwrites.** If an extension with the same name exists, the user is asked "Extension ... already exists. Do you want to update it?". Declining leaves the installed extension untouched.
- **Update replaces by name.** After a confirmed update the new package is stored and the previous one is removed. If the upload fails, the previous extension stays. If only the removal fails, the user is warned to delete the old one manually.
- **A cancelled, declined or failed update never deletes the installed extension.** A half-created new extension is rolled back when the user cancels or closes the dialog.
- **The result is announced.** A success message says "uploaded" or "updated" with the name. The extension shows Not loaded until the engine restarts (inside the add wizard, a restart panel is offered right after the upload).
- **Update from the card is one step, unless something looks wrong.** The file is processed and stored without a second confirmation, because the user already chose to update. The user is asked first when the package resolves to another extension than the one being updated, or when its version is older than or equal to the installed one.
- **Version and name rules only ask, never block.** When the chosen package resolves to an installed extension whose version is the same or newer, the user sees "Version 2.0.0 of \"Abs\" is installed and newer than version 1.0.0." (or "is already installed" for an equal one) and can still continue. In add mode the warning is part of the "already exists" confirmation. If either version is unknown, no warning is shown. Declining uploads nothing and leaves the installed extension untouched.
- **Not a goal:** the component does not validate that the package compiles or loads in the engine. A broken package is found out at restart (see safe mode in [extensions-management.md](extensions-management.md)).

---

## Implementation

### Where it lives

| Part | Where |
|---|---|
| `ExtensionAddComponent` (drop area, analysis, naming, confirm dialog) | [extension-add.component.ts](../../analytics-ui/src/shared/wizard/extension-add.component.ts), [.html](../../analytics-ui/src/shared/wizard/extension-add.component.html) |
| `ExtensionAddWizardComponent` (modal wrapper registered as wizard `uploadAnalyticsExtension`) | [extension-add-wizard.component.ts](../../analytics-ui/src/shared/wizard/extension-add-wizard.component.ts) |
| `ExtensionInventoryService.uploadExtension` (binary create, replace) | [extension-inventory.service.ts](../../analytics-ui/src/shared/extension-inventory.service.ts) |
| Zip metadata parser | [apama-block-metadata.ts](../../analytics-ui/src/shared/apama-block-metadata.ts), `extractBlockFqns` in [utils.ts](../../analytics-ui/src/shared/utils.ts) |

The component has an `embedded` input. Embedded in the add wizard it shows only the drop area (the wizard owns header and footer) and reports through the outputs `uploaded` and `loadingChange`, so the wizard can block navigation during an upload. Standalone it renders its own wizard header and footer with Cancel and Done.

### Flow in `onFile()`

1. Reset state, set loading, progress 0.
2. `resolveExtensionName(file)`, then `splitExtensionVersion()` gives `name` and `version`.
3. `findExistingExtension(name)` lists the inventory and compares `name` for equality.
4. `analyzeZipContent(file)` builds the `build_information`: `build_type: 'external'`, `monitors[]`, `files[]`, plus `version` when present.
5. The extension object is the existing managed object (so it keeps its id) or a new `{ name, pas_extension, build_information }`. For an existing one, `build_information` is replaced with the analysis of the new file.
6. If it exists and the mode is `add`, `handleUpdateRequired()` closes the wizard and opens the confirmation dialog. Otherwise `performUpload(mode)` runs.
7. The handler (`AnalyticsService.uploadExtension`) stores the file. `finally` sets progress to 100 and ends loading.

### Name resolution

`resolveExtensionName()`:

1. Take the file name without `.zip` (any case), without a trailing bracketed number such as ` (1)` or `(2)`. A name without extension, or one that is only an extension (`.zip`, `.hidden`), stays whole.
2. Open the zip and collect the prefixes of all `<prefix>_metadata.evt` files, at any depth.
3. If the file-derived name is one of the prefixes, keep it. Else, if there is exactly one prefix, use it. Else keep the file-derived name (a bundle with several metadata files).

The reason is that the engine registers blocks under the prefix of the metadata file, and the extension has to carry that name so that [loaded detection](extensions-management.md) and block assignment match. The file name is only a guess. Only after this does `splitExtensionVersion()` cut the version off.

### Analysis of the zip

One extension-wide `<extension>_metadata.evt` file (the SDK writes one for all monitors, and its name need not match a monitor) is parsed with `parseBlockMetadataEvt`. Each `.mon` file is read for its block names with `extractBlockFqns`. The first block name becomes the monitor id, the same id the repository list and the engine use. A file defining more than one block also records `blockIds`. A failure to read one file only logs a warning and keeps the id. The consumed metadata files are not listed again as files. File types are mapped by extension (`config`, `event`, `library`, `script`, and so on).

### Replace

`ExtensionInventoryService.uploadExtension(file, extension, mode)`:

- Mode `add`: `InventoryBinaryService.create(file, extension)`.
- Mode `update`: creates the new binary first from `{ name, pas_extension, build_information }` of the extension (so the new managed object has no old fields), then `removeReplacedExtension()` deletes the old binary by id, never failing the update. Upload first, delete second is deliberate: a failed upload must not cost the user the working extension.
- Afterwards `extensionChanged$` emits, and `AnalyticsService` invalidates the enrichment caches. After a confirmed update from the add flow the component also calls `triggerCacheReload(true)`.

### Cleanup rules

`cleanup()` calls `cancelExtensionCreation()` (deletes the managed object) only when an extension exists, the upload is not complete and `requiresUpdate` is false. When the extension already exists, `state.extension` is the user's installed extension and must never be deleted by cancelling. The confirmation dialog is deliberately not tied to the component lifecycle: the wizard closes itself right before the dialog opens, which destroys the component.

### Errors

Error codes (`ErrorType`) map to friendly texts through `ERROR_MESSAGES`. Other messages are shown as they are. An error without message goes to `AlertService.addServerFailure`. A failure clears the drop area.

### Tests

[extension-add.component.spec.ts](../../analytics-ui/src/shared/wizard/extension-add.component.spec.ts) covers naming (brackets, metadata correction, bundles, versions), analysis, the confirm flow, rollback and errors. [extension-inventory.service.spec.ts](../../analytics-ui/src/shared/extension-inventory.service.spec.ts) covers replace order.

### Limitations and open questions

- The existing-extension lookup compares the stored name for equality. A legacy inventory entry whose name still ends in `.zip` is not found, so an upload next to it creates a second extension. (The extensions list strips `.zip` for display and loaded detection only.)
- The card passes the extension to replace to the wizard, but the upload uses the extension found by the resolved name. If the user confirms a package that resolves to a different name, **Update** installs a new extension and leaves the old one in place. The version check uses `compareVersions` on the version of the package and the `build_information.version` of the installed extension.
