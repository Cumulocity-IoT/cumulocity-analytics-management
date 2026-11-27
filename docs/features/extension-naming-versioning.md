# Extension naming and versioning

An extension has a **name** and, optionally, a **version**. The name identifies the extension on the tenant. The version is information about the package and is stored in the extension's build information. Because the version is not part of the name, installing a newer version replaces the installed one instead of installing next to it.

The rule is implemented twice, in the browser and in the backend service, and both must agree. See [extension-upload.md](extension-upload.md), [release-deployment.md](release-deployment.md) and [extensions-management.md](extensions-management.md).

---

## Requirements

**What it is for.** Keeping exactly one installed extension per name, so that upgrading is a replacement, and so that the Extensions tab, the Installed blocks tab and the engine always talk about the same extension.

- **The version is never part of the name.** `Abs-1.0.1.zip` is the extension `Abs` with the version `1.0.1`. `Foo_v2.3.zip` is `Foo`, version `2.3`. `HttpOutputBlock.zip` has no version and keeps its whole name.
- **A trailing number is a version only when it looks like one.** Recognized: digits with dots, with an optional pre-release (`-rc.1`, `-rc-1`) and build part (`+build.2`), preceded by `-` or `_` and an optional `v`. A name such as `contrib-blocks-1.0.1` splits at the last version, and `contrib-blocks` stays intact.
- **A newer version replaces the older one.** Uploading `Abs-1.0.1.zip` when `Abs` is installed asks to update `Abs`. The same holds for a release deployment.
- **The version is visible.** It appears under Build information on the details page, and the release wizard tells what it replaces ("The installed extension "Abs" (version 1.0.0) will be replaced.").
- **Extensions built from a repository carry no version.** Their name is what the user typed. Only uploaded files and release assets take a version from their file name.
- **Loaded status does not depend on how the engine names the extension.** The engine may register the blocks of `Abs` under `Abs-1.0.1`. The extension is still shown as loaded, with its blocks, and its details page shows them.
- **Block assignment follows the same name.** An installed block belongs to the extension `Abs`, never to `Abs-1.0.1`.
- **The package may rename the extension.** The name is corrected from the package metadata when the file name does not match it. See [extension-upload.md](extension-upload.md).
- **Replacement is by name, with a warning for older versions.** Uploading a package whose version is older than or equal to the installed one asks for confirmation first (`compareVersions`). A missing version on either side gives no warning. The user can always continue, so an older version can still replace a newer one. A card update whose package resolves to another name asks as well.

---

## Implementation

### The split

`splitExtensionVersion(baseName)` in [utils.ts](../../analytics-ui/src/shared/util/utils.ts) and `split_extension_version(base_name)` in [app.py](../../analytics-service/src/app.py) use the same regular expression:

```
^(.+?)[-_]v?(\d+(?:\.\d+)*(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$
```

The name part is lazy, so it ends at the first separator from which the rest is a version. No match returns the whole input as name and no version. Both take the name without `.zip`. Test cases live in [utils.spec.ts](../../analytics-ui/src/shared/util/utils.spec.ts), [extension-add.component.spec.ts](../../analytics-ui/src/shared/wizard/extension-add.component.spec.ts) and `test_the_version_is_metadata_not_part_of_the_name` in [test_app.py](../../analytics-service/tests/test_app.py).

Two companion helpers matter:

- `removeZipSuffix()` removes only a trailing `.zip`.
- `removeFileExtension()` removes `.zip`, or else the last extension, and so cuts `Abs-1.0.1` to `Abs-1.0`. It is used for engine file names (`<name>.json`), never for extension names that may carry a version.

### Where the version is stored

`build_information.version` on the extension's managed object (`ExtensionBuildInformation.version` in [analytics.model.ts](../../analytics-ui/src/shared/model/analytics.model.ts)).

| Path | Who splits | Stored |
|---|---|---|
| Upload in the browser | `ExtensionAddComponent.onFile()` after name resolution | `build_information` of type `external` with `version` when present |
| Release deployment with backend | `POST /extension/release`, from `asset_name` | `build_information` of type `release` with `version` (null when absent), `release` (tag) and `asset` |
| Release in the wizard (no backend) | The wizard shows the split name, then the upload step splits again from the downloaded file | as upload |
| Repository, list, YAML build | none | no version |

### Replacement by name

- **Browser:** `findExistingExtension()` lists the inventory and matches `name` for equality; `ExtensionInventoryService.uploadExtension(..., 'update')` uploads the new binary, then deletes the old one by id.
- **Backend:** `agent.count_extensions(name)` returns 409 when the name exists and `replace` is false. With `replace`, the ids found before the upload are remembered (`find_extension_ids`) and only those are deleted afterwards (`delete_extension(only_ids=...)`), so a concurrent new extension of the same name is not removed. A failed delete is returned as a `warning` in the 201 body. `replace` and `deploy` require the admin role, see [roles-and-security.md](roles-and-security.md).

### Loaded detection with versioned engine names

The engine's `block-metadata.json` lists `Abs-1.0.1`, while the inventory has `Abs`. In [extension-enrichment.service.ts](../../analytics-ui/src/shared/extension/extension-enrichment.service.ts):

- `resolveMetadataName(name, metadata)` returns `name` when the engine lists it exactly. Otherwise it returns the one registered entry whose version-less name equals `name`. When zero or several entries match, it returns null (not deployed). A name shared by several versions is therefore never guessed.
- `addDeploymentStatus` uses it for `loaded` and for the block count, and `getDeployedExtensionDetails` fetches `<resolved>.json` and forces `name` back to the stored name. So the deployed block list reports `extension: "Abs"`.
- An inventory name that still ends in `.zip` is cleaned with `removeZipSuffix`, not `removeFileExtension`: an extension named `Abs-1.0.1` must not lose its `.1`.

### Traps

- Splitting happens on the file name, so a name with a digit tail, such as `Block-2`, becomes `Block` with version `2`.
- An extension with a legacy name that includes a version (stored before this rule) is a different extension from the version-less one. It is still found by the exact name and by the fallback, but an upload of the same package installs a second extension and the engine then holds two registrations.
- The engine's zip diagnostics are keyed `<name>.zip`; only the stored name is looked up there.

### Limitations and open questions

- **OPEN QUESTION:** Should extensions built from a repository record a version (for example the release tag or a commit)? Today they show no version.
- **OPEN QUESTION:** What does the engine's diagnostics `extensionNames` list for a zip extension that is versioned (`Abs-1.0.1.zip` or `Abs.zip`)? The code only looks up `<name>.zip`, so a "Code Extension" registered under a versioned name would show as Not loaded unless it is also in the block metadata.
