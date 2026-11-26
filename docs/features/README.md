# Feature documentation

One page per feature of the Analytics Management solution (the `analytics-ui` plugin and the `analytics-service` microservice). Each page has two parts, and the split is the point:

| Part | Answers | Changes when |
|---|---|---|
| **Requirements** | What must be true for this feature, observable from outside: the contract, the rules, the guarantees, the deliberate non-goals. No class names, no file paths. | The product decision changes |
| **Implementation** | How it is built: components, endpoints, flow, data structures, the reasoning behind non-obvious choices, and the traps. Links into the source. | The code changes |

The requirements outlive any given implementation and are what you check a change against. The implementation half is what you read before touching the code, and it goes stale by design.

**Writing the requirements half.** State rules as assertions about behavior a user or an integrator could observe. Include the deliberate non-goals, so a reader knows that something was decided against rather than forgotten. Unresolved product decisions are marked `OPEN QUESTION` in the page.

---

## Pages

### Extensions

| Page | Covers |
|---|---|
| [extensions-management.md](extensions-management.md) | The Extensions tab: grid and cards, details page, build information, update, delete, loaded status |
| [add-extension-wizard.md](add-extension-wizard.md) | The wizard in the bottom drawer: release, build or upload, steps, content rules, review, optional restart |
| [extension-upload.md](extension-upload.md) | Uploading a zip: name resolution, add and update, replacement |
| [extension-naming-versioning.md](extension-naming-versioning.md) | Name versus version, where the version is stored, replacement by name |
| [installed-blocks.md](installed-blocks.md) | The Installed blocks tab: blocks of the engine, category, custom flag, owning extension |

### Block library and repositories

| Page | Covers |
|---|---|
| [block-library.md](block-library.md) | The Block library tab: repository dropdown, hide installed, selecting rows to start the wizard |
| [repository-configuration.md](repository-configuration.md) | The Repositories drawer: configured GitHub repositories, access tokens, tenant options |
| [repository-layouts-and-builder.md](repository-layouts-and-builder.md) | Directory layout and `extensions.yaml` sections, how the extension zip is built in the browser and in the service |
| [release-deployment.md](release-deployment.md) | Deploying a GitHub release asset: service endpoint, limits, replacement, manual fallback |

### Engine and platform

| Page | Covers |
|---|---|
| [engine-status-and-restart.md](engine-status-and-restart.md) | Streaming Analytics engine status, optional restart, errors during a restart |
| [backend-and-browser-mode.md](backend-and-browser-mode.md) | What works with and without the `analytics-ext-service` microservice, how the plugin decides |
| [roles-and-security.md](roles-and-security.md) | Service roles, what the UI gates, token handling, input validation |

---

## Related documents

| Document | Covers |
|---|---|
| [block-marketplace/](block-marketplace/REQUIREMENTS.md) | Earlier requirements and concept for the browser-based block ecosystem ([CONCEPT.md](block-marketplace/CONCEPT.md), [DIRECT_UPLOAD.md](block-marketplace/DIRECT_UPLOAD.md)) |
| [pipeline/](pipeline/REQUIREMENTS.md) | CI pipeline integration requirements |
| [../UI-GUIDE.md](../UI-GUIDE.md) · [../BACKEND-GUIDE.md](../BACKEND-GUIDE.md) · [../ARCHITECTURE.md](../ARCHITECTURE.md) | Development guides and architecture decisions |
| [../api/](../api/README.md) | REST API of the microservice |

## Not documented yet

| Topic | State |
|---|---|
| CI pipeline, Helm charts, SBOM | Planned, nothing implemented. See [pipeline/REQUIREMENTS.md](pipeline/REQUIREMENTS.md) |
| Event-driven direct upload | Unverified experiment. See [block-marketplace/DIRECT_UPLOAD.md](block-marketplace/DIRECT_UPLOAD.md) |
| German translations | `de.po` is not regenerated for recent texts |
