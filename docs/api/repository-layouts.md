# Supported GitHub repository layouts

Two layouts of GitHub repositories are supported for building an Apama extension via
the [`/extension/*`](openapi.yaml) endpoints. This is the source-of-truth version of
the in-app help text shown by `extension-layout-help-modal.component.html`
(analytics-ui). Keep the two in sync.

## 1. Directory is Extension

**Mechanism**

- The extension builder inspects the top-level items in the configured repository
  path (`GET /repository/contentList`, non-recursive).
- If an item is a `.mon` file (for example `Difference.mon`), a single-file extension is
  created from just that file (`POST /extension/list` with `monitors[0].type: "file"`).
- If an item is a directory (for example `Python`), an extension is created by packaging
  all content within that directory, recursively, including subdirectories such as
  `venv` (`POST /extension/list` with `monitors[0].type: "dir"`).

**User UI**

- The user sees a list of names for each top-level `.mon` file and top-level
  directory (for example "Difference", "Offset", "Python"). The selection grid allows
  toggling several of these at once, and all selected files and directories are
  submitted together and built into a single extension (`monitors` array, see
  `/extension/list` in [openapi.yaml](openapi.yaml)). Their contents are merged
  into one build directory; on a name clash the later item wins.

## 2. Configuration file `extensions.yaml`

This layout uses a dedicated configuration file to define the extension's contents
explicitly.

**Mechanism**

- The builder looks for a file literally named `extensions.yaml` among the same
  top-level items used by layout 1. Detection is **not** recursive: a file placed
  in a subdirectory is not found.
- If present, it is read for the extension's metadata: a set of named top-level
  sections, each listing the files to include under that section's `files` key.
  Multiple sections can be selected and built together in one
  `POST /extension/yaml` request (`sections: [...]`), and a section's files are not
  limited to `.mon` (for example `plugin.yaml`, `.py`, `venv/` entries).
- If no `extensions.yaml` is present, the layout falls back to layout 1
  (`.mon` files / directories).

**User UI**

- If `extensions.yaml` is present, the UI only shows the top-level section names
  defined in the file, not the files or directories embedded within a section.
