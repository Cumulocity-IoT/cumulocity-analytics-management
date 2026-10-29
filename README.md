# Analytics Builder Management

A Cumulocity web plugin, with an optional microservice, that manages Analytics Builder extensions in the Streaming Analytics application. You upload custom block extensions, or build them online from blocks in GitHub repositories.

## Content
- [Documentation](#documentation)
- [Overview](#overview)
- [Manage custom extensions](#manage-custom-extensions)
- [Sample repositories and building custom extensions](#sample-repositories-and-building-custom-extensions)
- [Backend service switch](#backend-service-switch)
- [Access control](#access-control)
- [Installation](#installation)
- [Build the plugin](#build-the-plugin)
- [Backend microservice](#backend-microservice)
- [Analytics Builder block SDK](#analytics-builder-block-sdk)
- [Troubleshooting](#troubleshooting)
- [Repository layout for building extensions](#repository-layout-for-building-extensions)

## Documentation

- [AGENT.md](AGENT.md) - system overview, architecture, how to run
- [CONTRIBUTING.md](CONTRIBUTING.md) - contribution guidelines and development workflow
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - architecture decision records
- [docs/UI-GUIDE.md](docs/UI-GUIDE.md) and [docs/BACKEND-GUIDE.md](docs/BACKEND-GUIDE.md) - frontend and backend guides
- [analytics-service/API.md](analytics-service/API.md) - backend API
- [analytics-service/README.md](analytics-service/README.md) - backend microservice
- [docs/MIGRATION-SECURITY-2026-10.md](docs/MIGRATION-SECURITY-2026-10.md) - migration guide for the October 2026 security hardening

Run the tests with `npm test` in `analytics-ui` (frontend) or `pytest` in `analytics-service` (backend).

## Overview

The standard Streaming Analytics user interface cannot upload custom blocks packaged as **.zip** files. This plugin adds that capability and manages Analytics Builder blocks as extensions.

The plugin covers the lifecycle of an extension:
* List, upload, download, update, and delete Analytics Builder extensions.
* List installed blocks.
* Manage GitHub repositories as the source for building new extensions.
* Build new extensions from selected blocks and deploy them in the Streaming Analytics engine.
* Show a Safe Mode warning when the engine did not load the extensions, and mark the suspected extension.

Analytics Builder blocks are built using the [Analytics Builder Block SDK](https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk). Externally built extensions can be uploaded in the UI.

![Extension installation](resources/images/extension-upload.png)

The plugin adds three tabs: **Extensions**, **Installed blocks**, and **Repositories**. The **Installed blocks** tab lists all installed analytics blocks with their name, category, whether they are custom blocks, and the extension package they belong to.

![Block list](resources/images/block-list.png)

## Manage custom extensions
You can upload custom extensions from your local system, download them, and delete them. An upload, update or deletion only takes effect after you restart the Streaming Analytics engine.

### Upload custom extension

Upload an externally built extension with the button **Add extension**. Drop the **.zip** file into the dialog. The extension is stored in the inventory but not yet deployed. To deploy it, click **Restart to deploy extension** and wait for the notification confirming the engine restart.
If an extension with the same name already exists, the plugin asks you to confirm the replacement. You can also cancel.

![Update extension](resources/images/extension-update-modal.png)

After the restart the blocks are available in the Streaming Analytics application.

### Backend service switch

The action bar of the **Repositories** tab shows whether the backend microservice is deployed. If it is, the **Use backend service** switch controls whether the plugin uses the backend or works in browser-only mode. The tenant option stores the setting, and the default is on. In browser-only mode you cannot build extensions. If you deploy or remove the microservice while the page is open, click **Re-check** to refresh the state. Changing the switch reloads the repository list.

## Access control

### Application roles

The microservice `analytics-ext-service` checks one of three application roles on every request. The microservice manifest declares the roles, and the platform creates them when you subscribe the microservice.

| Role | Allows |
|------|--------|
| `ROLE_ANALYTICS_MANAGEMENT_READ` | Read the engine status, list repositories, browse repository content, and build an extension as a download |
| `ROLE_ANALYTICS_MANAGEMENT_CREATE` | Everything in READ, and build an extension with upload to the inventory |
| `ROLE_ANALYTICS_MANAGEMENT_ADMIN` | Everything in CREATE, and change repositories, delete extensions, rebuild extensions, and restart the engine |

A higher role includes the lower ones, so assign one role to each user. The microservice enforces this rule. Cumulocity does not.

| Endpoint | Required role |
|----------|---------------|
| `GET /cep/id`, `GET /cep/status` | READ |
| `GET /repository/configuration`, `GET /repository/contentList`, `GET /repository/content` | READ |
| `POST /extension/repository`, `POST /extension/list`, `POST /extension/yaml` | READ; CREATE with `upload=true`; ADMIN with `rebuild=true` or `deploy=true` |
| `POST /repository/configuration` | ADMIN |
| `DELETE /extension`, `DELETE /extension/{id}` | ADMIN |
| `GET /health` | None |

A request without a valid login receives `401`. A request without the required role receives `403` with the message `Missing required role <role>`. The microservice checks the role before it reads the request body or changes anything.

### Assign the roles

1. Subscribe the microservice. In **Administration > Roles**, check that the three roles exist.
2. Create or reuse user groups and assign the roles. For example, give viewers READ, release engineers CREATE, and application owners ADMIN.
3. Test with one user per role before you remove old assignments.

### Platform roles the plugin needs

The application roles protect the microservice API only. The plugin also works with the platform roles of the signed-in user:

| Platform role | Used for |
|---------------|----------|
| `ROLE_CEP_MANAGEMENT_READ` and `ROLE_CEP_MANAGEMENT_ADMIN` | Show the **Extensions** menu entry. The plugin hides the entry unless the user has both roles. |
| `ROLE_INVENTORY_ADMIN` | Upload, update, and delete extensions. The plugin writes the extension binaries directly to the inventory. |
| `ROLE_OPTION_MANAGEMENT_ADMIN` | Save repository settings. The plugin writes them directly as tenant options. |

A user with `ROLE_INVENTORY_ADMIN` or `ROLE_OPTION_MANAGEMENT_ADMIN` can therefore change extensions and repositories in the plugin, whatever application role the user holds. The application roles restrict only the actions that use the microservice, such as building from a repository, browsing repository content, and reading the engine status. The migration guide describes this limit: [docs/MIGRATION-SECURITY-2026-10.md](docs/MIGRATION-SECURITY-2026-10.md).

In browser-only mode, which applies when the microservice is not deployed or the **Use backend service** switch is off, only the platform roles apply.

### Roles of the microservice itself

The microservice calls Cumulocity as its own service user. The manifest `analytics-service/cumulocity.json` requests these roles for it: `ROLE_OPTION_MANAGEMENT_READ`, `ROLE_OPTION_MANAGEMENT_ADMIN`, `ROLE_INVENTORY_ADMIN`, `ROLE_APPLICATION_MANAGEMENT_READ`, `ROLE_INVENTORY_READ`, `ROLE_INVENTORY_CREATE`, and `ROLE_CEP_MANAGEMENT_ADMIN`. Callers do not need these roles to use the microservice.

## Installation

The solution consists of two parts:
* **Backend microservice** `analytics-ext-service` (optional, but required to build custom extensions). Download `analytics-ext-service.zip` from the [releases](https://github.com/Cumulocity-IoT/cumulocity-analytics-management/releases) and subscribe it as described in the [Cumulocity documentation](https://cumulocity.com/docs/standard-tenant/ecosystem/#managing-microservices).
* **Web plugin**, available as a community plugin and installed in Administration > Extensions > Analytics Extensions:

![Plugin installation](resources/images/plugin-installation.png)

### Add the plugin to a standard application

1. Download `c8y-pkg-analytics-extension-<version>.zip` from the [releases](https://github.com/Cumulocity-IoT/cumulocity-analytics-management/releases).
2. In your tenant, open Administration > Ecosystem > Extensions > Add extension package and upload it.
3. Clone the standard application, such as Streaming Analytics or Cockpit, under Administration > Ecosystem > Applications > Clone, if you have not done so yet.
4. Install the plugin in the cloned application.

The new application then appears in the app switcher.

## Build the plugin

**Prerequisites:** Git, Node.js 22 (the release builds use Node.js 22), and npm.

**Main dependencies:** Angular 21, `@c8y/ngx-components` 1024.22, TypeScript 5.9, RxJS 7.8 (see [package.json](analytics-ui/package.json)).

Set the target tenant URL, username, and password in your environment before you start.

```
git clone https://github.com/Cumulocity-IoT/cumulocity-analytics-management.git
cd cumulocity-analytics-management/analytics-ui
npm install
npm start          # optional: local development server
npm run build      # build the plugin
npm run deploy     # deploy to the tenant
npm run format     # optional: Prettier
npm run lint       # optional: ESLint with auto-fix
```

## Backend microservice

The microservice `analytics-ext-service` downloads the sample blocks from the configured repositories and builds an analytics extension as a zip file. You choose whether the microservice uploads the extension automatically or the browser downloads it. You must upload a downloaded file afterwards, see [Upload custom extension](#upload-custom-extension). The microservice supports multiple tenants. It requires the application roles described in [Access control](#access-control).

### Prerequisites to build and deploy
* Python 3.12 (the version the CI pipeline uses)
* Docker host or client
* [go-c8y-cli](https://goc8ycli.netlify.app) (`c8y`)

### Local debugging with VS Code / Dev Container
To run and debug the microservice locally, use VS Code with the `analytics-service/.devcontainer/devcontainer.json` configuration. To test with real microservice credentials, create an `.env-admin` file with administrative credentials in the analytics service directory. Then start the container (F1 > Open Folder in Container). The script `get_service_creds.py` fetches the bootstrap credentials and creates the `.env` file that contains them.

To use your own credentials, comment out the line `"postAttachCommand": "python3 .devcontainer/get_service_creds.py",` in `devcontainer.json` and create the `.env` file yourself. The file formats are:

* Example .env-admin
```
C8Y_BASEURL=https://<tenant>.cumulocity.com
C8Y_TENANT=<tenantId>
C8Y_USER=<user>
C8Y_PASSWORD=<password>
```

* Example .env
```
C8Y_BASEURL=https://<tenant>.eu-latest.cumulocity.com
C8Y_BOOTSTRAP_TENANT=<tenant_id>
C8Y_BOOTSTRAP_USER=servicebootstrap_analytics-ext-service
C8Y_BOOTSTRAP_PASSWORD=<password>
```

After the dev container has started, you can debug `app.py` as a Python file.

To test the microservice, run the following curl command:
```
curl --location 'http://127.0.0.1:<container host port>/extension' \
--header 'Content-Type: application/json' \
--header 'Authorization: Basic <tenant_id>/<username> as base64' \
--data '{
    "extension_name": "Test",
    "upload": true,
    "monitors": ["https://raw.githubusercontent.com/Cumulocity-IoT/apama-analytics-builder-block-sdk/rel/10.18.0.x/samples/blocks/CreateEvent.mon"]
}'
```

### Build and deploy

To build the backend as the microservice `analytics-ext-service`:
* run the script:
```
# cd analytics-service
# ./build.sh analytics-ext-service VERSION 
```
* upload the created archive:
```
# c8y microservices list --name analytics-ext-service | c8y microservices createBinary --file dist/analytics-ext-service.zip --timeout 360
```
* or build and upload in one step with the active `c8y` session (creates the microservice on the first run, uploads a new version afterwards):
```
# ./build.sh --push VERSION
```
> **Note:** for the first deployment, create the microservice instead:
```
# c8y microservices create --file dist/analytics-ext-service.zip --name analytics-ext-service --timeout 360
```

## Analytics Builder block SDK

Custom blocks are developed with the [Analytics Builder block SDK](https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk), which also documents how to write blocks. The release section includes an example block for testing. The block adds two inputs.

![Example block](resources/images/block-example-detail.png)


## Troubleshooting

* **Is an extension deployed?** Look for a message like the following in the analytics engine log (Administration > Ecosystem > Microservices > apama-ctrl-1c-4g > Logs):
  `[correlator]  2023-12-04 12:29:43.752 INFO [139659199286272] - Applying extension "/config/extensions/Sample_AB_Extension.zip"`
* **No extension is loaded after an upload:** the engine is probably in [Safe Mode](#safe-mode); delete the suspected extension and restart.
* **Repository list is empty with a 401 error:** configure a personal access token, see [Sample repositories](#sample-repositories-and-building-custom-extensions). **Repository list is empty without an error:** turn on Expert mode.
* **Cannot build extensions:** check that the backend microservice is deployed and the **Use backend service** switch is on, see [Backend service switch](#backend-service-switch).


## Repository layout for building extensions

The extension builder supports two layouts for a GitHub repository path. The **Extension Builder Layouts** dialog on the **Repositories** tab describes them in the plugin.

### Directory is extension

The builder reads the top-level items of the configured repository path:
* A `.mon` file, such as `Difference.mon`, becomes a single-file extension.
* A directory, such as `Python`, becomes an extension that contains everything in the directory, including subdirectories such as `venv`.

The grid lists each top-level `.mon` file and directory. You can select several items. The builder combines all selected items into one extension.

### Configuration file `extensions.yaml`

A file named `extensions.yaml` among the top-level items defines the extension contents explicitly:
* The file defines named sections. Each section lists the files to include, and the files are not limited to `.mon`.
* The grid shows only the section names. You can select several sections and build them in one request.
* The builder does not find the file in a subdirectory.
* Without the file, the builder uses the directory layout.

Building from either layout requires the [backend microservice](#backend-microservice).

> **Note:** the solution was renamed. Releases before 2.5.0 are still available in the [release section](https://github.com/Cumulocity-IoT/cumulocity-analytics-management/releases).

------------------------------

We provide these tools as-is, without warranty or support. They are not part of the Cumulocity product. You can use, fork, and modify them under the license agreement. We welcome contributions, but we cannot guarantee to include every contribution in the main project.

For more information, ask a question in the [Cumulocity tech community](https://techcommunity.cumulocity.com/).
