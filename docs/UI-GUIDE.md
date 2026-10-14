# Analytics UI Development Guide

> Last aligned with the code: 2026-10-14. Items marked **Planned** are *not* implemented (see [Planned work](#planned-work)).

## Overview

`analytics-ui` is a Cumulocity web SDK plugin (Angular 21, `@c8y/*` 1024.x) named
`c8y-pkg-analytics-extension`. It adds pages to the Streaming Analytics / Administration shells
to manage custom Analytics Builder blocks as extensions: browse blocks, deploy extensions,
manage GitHub repositories and releases, and monitor the engine.

---

## Architecture

### Entry point

`AnalyticsExtensionModule` ([analytics-extension.module.ts](../analytics-ui/src/analytics-extension.module.ts))
is the plugin's NgModule. It is **required** by the c8y plugin mechanism and stays an NgModule:
it imports the (standalone) components and registers the c8y hooks (`hookRoute`, `hookTab`,
`hookNavigator`, `hookWizard`, Formly types). All feature components are standalone (see ADR-001).

Routes (all under `c8y-pkg-analytics-extension/`, defined once in `ROUTES` in `shared/analytics.constants.ts`):
`manage` (+ `manage/details/:name`), `installed-blocks`, `repository`, `monitoring`, `release`. `manage` uses resolvers
(`backendResolver`, `extensionResolver` in `manage/resolvers.ts`). Page names (tab, page title, breadcrumb) come from
`PAGE_LABELS` in the same file: Extensions, Installed blocks, Repositories, Monitoring. Use these constants, never literals.
Label style: sentence case, product names capitalised (Streaming Analytics, Analytics Builder); every label goes through
`gettext()` (TS) or the `translate` pipe/directive (templates).

### Source layout

```
src/
├── analytics-extension.module.ts   # plugin module + c8y hooks/routes
├── bootstrap.ts, main.ts, app.config.ts, polyfills.ts, i18n.ts
├── block/                          # BlockGridComponent: blocks deployed in the engine
├── manage/                         # extension grid / card / details, resolvers.ts
├── monitoring/                     # engine monitoring
├── repository/
│   ├── list/                       # RepositoryBlockGridComponent, ExtensionListComponent (Formly field), help modal
│   ├── create-extension/           # ExtensionCreateModalComponent
│   ├── editor/                     # EditorModalComponent, EplConfigService, token provider
│   ├── release-deploy/ release-list/   # deploy GitHub releases
│   └── drawer/                     # RepositoriesDrawerComponent (manage repos, PATs)
└── shared/
    ├── analytics.service.ts        # facade used by components
    ├── cep-*.service.ts, cep-error.ts      # engine status, restart, errors
    ├── extension-*.service.ts      # inventory, enrichment, builder
    ├── repository-*.service.ts     # config, backend, items, mode
    ├── github-*.service.ts         # content and release access (native fetch)
    ├── component/                  # reusable components, cell renderers, Formly fields
    ├── wizard/ http/               # add-extension wizard; dormant interceptor (ADR-002)
    └── analytics.model.ts, analytics.constants.ts, utils.ts
```

---

## Naming and structure

Enforced by `npm run lint:naming` (ESLint rules in `.eslintrc.naming.js`, which `.eslintrc.js` also uses, plus
`scripts/check-naming.js` for files, folders and selectors). CI runs it on every push (see CI below).

| Subject | Rule | Example |
|---------|------|---------|
| Files and folders | lowercase kebab-case; optional `.kind` suffix: `.component`, `.service`, `.factory`, `.interceptor`, `.module`, `.model`, `.constants`, `.spec` | `extension-grid.component.ts` |
| Class <-> file | the class exported by `foo-bar.<kind>.ts` is `FooBar<Kind>` (case-insensitive, so `github-*` / `GitHub*` is fine) | `repository-items.service.ts` -> `RepositoryItemsService` |
| Component classes | end in `Component` (also modals, wizards, cell renderers and Formly fields) | `CustomSwitchFieldComponent` |
| Services | end in `Service`; navigation/tab hooks in `Factory`; HTTP interceptors in `Interceptor`; errors in `Error` | `CepRestartService`, `CepError` |
| Selectors | `a17t-` + file name without `.component.ts`; components without a selector (cell renderers) are allowed | `a17t-extension-grid` |
| Unique class names | no two exported classes share a name anywhere in `src/` (no `import { X as XBlock }` aliases) | `BlockGridComponent` vs `RepositoryBlockGridComponent` |
| Types, interfaces, enums | PascalCase; interfaces without `I` prefix; enum members UPPER_CASE or PascalCase | `ErrorType.NO_MANIFEST_FILE` |
| Exported constants | `UPPER_SNAKE_CASE` for values, `camelCase` for functions/resolvers/objects; no numeric suffixes | `CEP_METADATA_JSON_SUFFIX`, `extensionResolver` |
| Functions | camelCase, verb first | `createShortId()` |
| Folders | a folder never repeats its parent's name; group by feature (`manage/`, `repository/...`), shared code in `shared/` | `repository/drawer/` |
| Specs | next to the source file, `<source>.spec.ts` | `utils.spec.ts` |

Structure rules of thumb: feature folders contain only what that feature's routes use; anything used by two
features moves to `shared/`; components do not call `FetchClient`/`fetch` or c8y data services directly, they go through a service
(`AnalyticsService` or `RepositoryService` facades); one facade per area, focused services behind it.
Known exception: `EngineMonitoringComponent` injects c8y's `EventService` itself (candidate for a service).

### Talking to backends

Almost all calls use the c8y `FetchClient` (`@c8y/client`) or the native `fetch()` API
(GitHub). **`HttpClient` is not used by application code.** Errors are normalised per area:
`CepError`/`fetchCepJSON` for engine calls, `GitHubReleaseError`, `RepositoryError`.
The microservice is reached through `/service/analytics-ext-service/...`.

### Shared services

| Service | Role |
|---------|------|
| `AnalyticsService` | Facade: extensions, blocks, upload, CEP status/restart, cache invalidation |
| `RepositoryService` | Repository list, enable/disable state, unsaved-change tracking, global PAT, connection test |
| `CepStatusService` / `CepRestartService` | Engine status stream, restart lifecycle and transient-error handling |
| `ExtensionEnrichmentService` | Combines deployed extensions with block metadata |
| `GitHubReleaseService` / `GitHubContentService` | GitHub releases and content via `fetch` |

---

## HTTP error handling

**Status: not enabled.** See ADR-002 in [ARCHITECTURE.md](./ARCHITECTURE.md).

`src/shared/http/` contains an `HttpClient` interceptor (`ErrorInterceptor`) with retry/backoff, a
user-friendly message mapping and an `ErrorHandlerService`, plus `HttpModule` that would register
them. Nothing imports `HttpModule`, and since application code does not use `HttpClient`, wiring it
in would currently affect almost nothing. The code is kept and unit tested but is dormant.

What is active instead:

- per-area error classes and messages (above),
- the extension grid retries *transient* 502/503/504 load errors with a backoff and stays quiet,
  alerting only on genuine failures,
- c8y `AlertService` for user feedback.

Before enabling the interceptor: retry only idempotent methods (GET), decide how to avoid duplicate
alerts, and move the FetchClient/fetch call sites onto `HttpClient` if they should benefit.

---

## Type safety

Configuration:

- `tsconfig.json` sets `strict: true` and strict Angular template checking.
- `tsconfig.app.json` (used by the build) **overrides `strict: false`** and `noImplicitOverride: false`.
  The application build is therefore *not* strict, while the spec build (`tsconfig.spec.json`) is.
- About 40 explicit `any` usages remain in non-test code.

Guidelines for new code: prefer `unknown` + type guards over `any`, use optional chaining for
possibly-null values, and keep new files compilable under the strict root config. Turning strict mode
on for the app build is a planned task (ADR-006).

---

## Testing

**Framework:** Karma + Jasmine (Chrome Headless), run through `@angular/build:karma`.
Specs live next to the code as `*.spec.ts`; `tsconfig.spec.json` is the spec compiler config.

```bash
cd analytics-ui
export CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # if Chrome is not found
npm test                 # single run, ChromeHeadless
npm run test:watch       # watch mode in a browser
npm run test:coverage    # with coverage report
npm run test:ci          # what CI runs: ChromeHeadlessCI (no sandbox) + coverage
```

| Spec (all under `src/`) | Covers |
|------|--------|
| `shared/utils.spec.ts`, `analytics.model.spec.ts` | file helpers, Apama block-name/FQN extraction, GitHub URL conversion, default repositories, error messages |
| `shared/apama-block-metadata.spec.ts` | doc-comment/annotation parsing and `.evt` generation |
| `shared/cep-error.spec.ts`, `repository-error.spec.ts` | error classes, `fetchCepJSON`, `extractErrorMessage` |
| `shared/cep-restart.service.spec.ts` | restart lifecycle, grace period, safety timer, warnings |
| `shared/cep-status.service.spec.ts` | realtime stream, backend availability probe/caching, status/id lookup with fallbacks, restart trigger |
| `shared/extension-inventory|enrichment|builder.service.spec.ts` | inventory CRUD/paging, deployment status + block categorisation, client-side zip build |
| `shared/analytics.service.spec.ts` | facade delegation and cache invalidation |
| `shared/repository-config|backend|items.service.spec.ts`, `github-content|github-release.service.spec.ts`, `repository-mode.service.spec.ts` | tenant-option storage and token semantics, backend/GitHub content access, item listing/FQN/installed status |
| `shared/repository.service.spec.ts` | state, serialized mutations, unsaved changes, items stream, delegation |
| `shared/fetch-extension.service.spec.ts` | `c8y_FetchExtension` event flow |
| `shared/analytics-navigation|tab.factory.spec.ts` | permission-gated navigation, tab set |
| `shared/http/*.spec.ts` | dormant interceptor (retry/backoff) and error handler service |
| `repository/editor/epl-config.service.spec.ts` | EPL editor/language configuration and token provider |
| `manage/extension-grid.component.spec.ts` | engine status streams, load/retry/alert behaviour, reload, actions |
| `repository/drawer/repositories-drawer.component.spec.ts` | form, change detection, save/cancel/delete flows, global token |

Conventions:

- Component specs replace the template (`overrideComponent(..., { set: { template: '', imports: [] } })`)
  and test component logic with spied services. Rendered DOM is **not** covered.
- Use `fakeAsync` + `tick` for timers/retries; don't create rejected promises eagerly in `returnValues`.
- Spy on `window.fetch` for GitHub code (see `github-release.service.spec.ts`).
- Do not leave specs without expectations; the runner warns about them.

Status: all services under `src/shared/` and the EPL config service have specs (about 400 specs, ~81% line
coverage of the files that are loaded; that figure excludes files without any spec). Components without specs:
`extension-add`, both block grids, `extension-card`, `extension-details`, `engine-monitoring`, the release
wizard/list, the create-extension and editor modals, `extension-list`, and the small renderers/modals.
There are no E2E tests.

---

## CI

`.github/workflows/check-push.yml` runs on every push and pull request: spell check (`typos`), the **ui** job
(`npm ci`, `lint:check`, `lint:naming`, `test:ci`, coverage uploaded as an artifact) and the **service** job
(pytest with coverage). `karma.conf.js` defines `ChromeHeadlessCI` (`--no-sandbox`) for runners where Chrome's
sandbox is unavailable. The release workflow (`build-release.yml`, `v*` tags) only builds; it does not depend on these checks.
Lint disables: `no-useless-escape` is switched off in `epl-config.service.ts` and `epl-token.provider.ts`, whose
regular expressions are copied verbatim from the EPL/Monaco grammar. Unused arguments/variables may start with `_`.

---

## Development workflow

```bash
npm start                   # ng serve against the configured Cumulocity tenant
npm run start:admin         # administration shell
npm run start:ab            # streaminganalytics shell
npm run start:cockpit       # cockpit shell
npm run build               # development build (`npm run build -- --configuration production` for prod)
npm run lint                # eslint --fix
npm run lint:check          # eslint without fixing (what CI runs; must be clean)
npm run lint:naming         # naming/structure rules only (see Naming and structure)
npm run format              # prettier
```

### Key dependencies (see `package.json` for exact versions)

Angular 21.2, TypeScript 5.9, RxJS 7.8, `@c8y/*` 1024.19, `ngx-bootstrap` 21.2, `jszip`, `js-yaml`.
Karma 6 / Jasmine 5 for tests.

---

## Common issues

- **"Object is possibly null"** in specs or new strict code: use `?.` or guard first.
- **Karma cannot find Chrome:** set `CHROME_BIN` (see Testing).
- **"Cannot configure the test module when it has already been instantiated":** call
  `TestBed.resetTestingModule()` before configuring again within one test.

---

## Planned work

1. Decide on the HTTP interceptor (enable GET-only retries, or remove it) - ADR-002.
2. Enable strict mode for the application build and remove `any` - ADR-006.
3. Unit tests for the remaining components (see Testing).
4. State management (NgRx) - only if the current service-based state becomes a problem.
5. E2E tests (e.g. Cypress), accessibility pass, lazy loading and virtual scrolling for large lists.
6. Component-level documentation.
