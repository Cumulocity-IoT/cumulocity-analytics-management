# Architecture & Development Guides

> The ADRs record decisions; each now carries an **Implementation status** note (aligned with the code on 2026-10-14). Decisions are not all implemented, check the status before relying on one.

## Quick Navigation

- **[UI Development Guide](./UI-GUIDE.md)** - Frontend architecture, components, testing, and best practices
- **[Backend Development Guide](./BACKEND-GUIDE.md)** - API design, deployment, logging, and best practices
- **Architecture Decision Records** - Key architectural decisions documented below

---

## Architecture Decision Records (ADRs)

## ADR-001: Use Standalone Angular Components Over NgModule

**Status:** ACCEPTED - IMPLEMENTED (plugin module retained)  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14):** All feature components are standalone. `analytics-extension.module.ts`
> is deliberately kept as the plugin's NgModule: the Cumulocity plugin mechanism requires it to register routes,
> tabs, navigation and wizard hooks. The "remove the NgModule" part of the decision does not apply to that file.
> The bundle-size estimate below was never measured.

### Context
The analytics-ui was using a mixture of NgModule-based and standalone components. With Angular 20, standalone components are the recommended approach for new code.

### Decision
Migrate all components to standalone Angular 20 components and remove the NgModule pattern from analytics-extension.module.ts.

### Rationale
- **Smaller bundle size:** Standalone components enable better tree-shaking
- **Simpler dependency management:** No need to declare in NgModule
- **Better IDE support:** Easier to understand component dependencies
- **Future-proof:** Align with Angular's direction
- **Faster development:** Less boilerplate code

### Consequences
- **Positive:**
  - Smaller bundle size (estimated 15-20% reduction)
  - Simpler codebase
  - Better performance
- **Negative:**
  - Requires migration work for existing components
  - Team needs to learn new patterns

### Implementation
- Convert components gradually in phases
- Update route definitions to use standalone flag
- Update service providers in root module

---

## ADR-002: Error Handling with Retry Logic via HTTP Interceptors

**Status:** ACCEPTED - NOT ENABLED  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14): not enabled.** `ErrorInterceptor`, `ErrorHandlerService` and `HttpModule`
> exist in `src/shared/http/` and are unit tested, but nothing imports `HttpModule`, so no request goes through them.
> Application code uses the c8y `FetchClient` and native `fetch()`, not Angular `HttpClient`, so registering the
> interceptor would affect almost no calls. Retrying every method would also be unsafe for non-idempotent
> `POST /extension/*` calls (build + upload). The listed "Features Implemented" exist in the code only.
> Open decision: enable with GET-only retries (and an opt-out for alerts), or remove the code. Error handling in
> practice is per area (`CepError`, `GitHubReleaseError`, `RepositoryError`, grid-level transient retry).

### Context
HTTP requests were failing without proper retry logic or user-friendly error handling. Different parts of the application handled errors inconsistently.

### Decision
Implement a centralized HTTP interceptor with automatic retry logic and standardized error handling.

### Rationale
- **Centralized:** All HTTP errors handled in one place
- **Resilience:** Automatic retry for transient failures (5xx, 408, 429)
- **User-friendly:** Standardized error messages instead of technical responses
- **Observable:** Request tracing with unique IDs for debugging

### Features Implemented
- Automatic retry with exponential backoff
- User-friendly error messages
- Request/response logging
- Error tracking and history
- Sensitive data redaction in logs

### Consequences
- **Positive:**
  - Improved reliability
  - Better error visibility
  - Reduced user frustration
- **Negative:**
  - May mask some server-side issues temporarily (by retrying)
  - Adds latency for failed requests

---

## ADR-003: Structured Logging with JSON Format

**Status:** ACCEPTED - IMPLEMENTED (partially)  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14):** `logging_config.py` provides JSON logging (`LOG_FORMAT=json` or
> `ENV=production`), text logging otherwise, a rotating file handler in production and `LOG_LEVEL`/`LOG_FILE`.
> Not implemented: request ids, per-request access logging, automatic redaction (the code avoids logging secrets instead).

### Context
The analytics-service used basic string logging which was difficult to parse, aggregate, and analyze in production environments.

### Decision
Implement structured logging with JSON format for production environments.

### Rationale
- **Parseability:** JSON logs are easily parsed by log aggregation tools
- **Consistency:** Structured data ensures consistent log format
- **Searchability:** Easy to filter and search logs by fields
- **Integration:** Works well with ELK, Splunk, CloudWatch, etc.
- **Backwards compatible:** Development still uses readable text format

### Implementation
- Custom JSON formatter for production
- Standard text format for development
- Configurable via LOG_FORMAT environment variable
- Includes request ID for tracing

### Consequences
- **Positive:**
  - Better debugging in production
  - Easier log analysis
  - Better integration with monitoring tools
- **Negative:**
  - Less human-readable in production logs
  - Slightly larger log size

---

## ADR-004: Use Pydantic for Request Validation

**Status:** ACCEPTED - PLANNED (not implemented)  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14): not implemented.** `pydantic` is in `requirements.txt` but unused.
> Routes validate input by hand (`isinstance` checks, `_validate_extension_name`, required-field checks) and return
> `{"error": ...}` with 400. All roadmap steps below are open.

### Context
The analytics-service had limited input validation, relying on manual validation scattered throughout the code.

### Decision
Adopt Pydantic for declarative request validation and serialization.

### Rationale
- **Declarative:** Models clearly define expected input
- **Automatic:** Validation happens automatically on request deserialization
- **Type-safe:** Runtime validation matches type hints
- **Consistent:** All endpoints use same validation logic
- **Documented:** Models serve as self-documentation

### Implementation Roadmap
1. Define Pydantic models for all request types
2. Add request validation middleware
3. Return structured validation errors to clients

### Consequences
- **Positive:**
  - Fewer bugs from invalid input
  - Better API documentation
  - Easier to maintain validation rules
- **Negative:**
  - Adds dependency (Pydantic)
  - Requires schema updates to be reflected in models

---

## ADR-005: Implement Health Checks Endpoint

**Status:** ACCEPTED - PARTIAL (static liveness only)  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14):** `GET /health` returns `{"status": "UP"}` without checking anything.
> `health_check.py` (system/Cumulocity/GitHub checks) is not imported by `app.py` and not copied into the Docker image.
> Decide whether to wire it in (keeping external calls out of the liveness probe) or delete it.

### Context
The analytics-service had no way to check its health status or external dependencies status. This made it difficult to diagnose issues and configure monitoring.

### Decision
Implement a comprehensive `/health` endpoint that checks system, Cumulocity, and GitHub connectivity.

### Rationale
- **Monitoring:** Enables automated health monitoring
- **Debugging:** Helps diagnose issues quickly
- **Deployment:** Required for Kubernetes liveness probes
- **Visibility:** Provides status of all external dependencies

### Checks Included
- System resources (memory, CPU, disk)
- Cumulocity credentials availability
- GitHub API connectivity
- Overall uptime

### Consequences
- **Positive:**
  - Better operational visibility
  - Enables automated monitoring
  - Supports Kubernetes deployment
- **Negative:**
  - External API calls add latency to health check
  - Must handle timeouts gracefully

---

## ADR-006: Enable TypeScript Strict Mode

**Status:** ACCEPTED - PARTIAL  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14):** `tsconfig.json` has `strict: true`, but `tsconfig.app.json` (used by the build)
> overrides it with `strict: false`, and roughly 40 `any` usages remain in non-test code. Specs compile under strict.
> `noUnusedLocals` is not enabled. Enabling strict mode for the app build is still open.

### Context
The analytics-ui had loose TypeScript configuration with `any` types and missing null checks, leading to runtime errors.

### Decision
Enable TypeScript strict mode and eliminate `any` types throughout the codebase.

### Rationale
- **Type safety:** Catches more errors at compile time
- **IDE support:** Better autocomplete and refactoring
- **Maintainability:** Easier to understand code intent
- **Documentation:** Types serve as code documentation
- **Performance:** Enables better optimization

### Strict Mode Settings Enabled
- `strict: true` - Enables all strict type checking options
- `noImplicitAny: true` - Error on implicit any
- `strictNullChecks: true` - Better null/undefined handling
- `noUnusedLocals: true` - Error on unused variables
- `noFallthroughCasesInSwitch: true` - Prevent logic errors

### Consequences
- **Positive:**
  - Fewer runtime type errors
  - Better IDE experience
  - More maintainable code
- **Negative:**
  - More verbose code initially
  - Requires fixing existing type issues

### Migration Plan
1. Enable strict mode in tsconfig.json
2. Fix compilation errors systematically
3. Add type definitions for all public APIs
4. Review and update tests

---

## ADR-007: Testing Strategy

**Status:** ACCEPTED - IMPLEMENTED (unit level, in CI); E2E open  
**Date:** 2026-05-28  
**Authors:** Development Team

> **Implementation status (2026-10-14):** Backend: pytest with about 166 tests, ~91% line coverage (target 70% met).
> Frontend: Karma/Jasmine with about 580 specs covering all services and components (~96% lines), so the 80%/70% targets are met.
> CI (`check-push.yml`) runs lint, naming rules and both test suites on every push/PR. Not done: Cypress/E2E tests, PR coverage comments, gating the release workflow on these checks.
> Jest/Protractor are not used. See [BACKEND-GUIDE.md](./BACKEND-GUIDE.md#testing) and [UI-GUIDE.md](./UI-GUIDE.md#testing).

### Context
The project had no comprehensive testing strategy or automated test execution.

### Decision
Implement multi-layered testing approach with unit, integration, and E2E tests.

### Rationale
- **Quality:** Higher code quality and fewer bugs
- **Confidence:** Refactoring with confidence
- **Documentation:** Tests document expected behavior
- **Regression prevention:** Catch regressions early

### Testing Layers

**Frontend (Analytics-UI):**
- Unit tests: Individual services and components (Jest/Karma)
- Integration tests: Component interaction (Protractor/Cypress)
- E2E tests: Complete user workflows (Cypress)
- Target coverage: 80%+

**Backend (Analytics-Service):**
- Unit tests: Business logic (pytest)
- Integration tests: API endpoints with mocked dependencies (pytest)
- Target coverage: 70%+

### CI/CD Integration
- Run tests on every PR
- Block merge if tests fail
- Generate coverage reports
- Report to pull request

### Consequences
- **Positive:**
  - Higher code quality
  - Reduced production bugs
  - Easier refactoring
- **Negative:**
  - Requires time to write tests
  - Must maintain test suite

---

## Decision Tracking

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| 001 | Standalone Components | Implemented (plugin NgModule kept) | 2026-05-28 |
| 002 | HTTP Error Interceptor | **Not enabled** | 2026-05-28 |
| 003 | Structured Logging | Implemented (partially) | 2026-05-28 |
| 004 | Pydantic Validation | Planned | 2026-05-28 |
| 005 | Health Checks | Partial (static `/health`) | 2026-05-28 |
| 006 | TypeScript Strict Mode | Partial (app build not strict) | 2026-05-28 |
| 007 | Testing Strategy | Implemented (unit, in CI); E2E open | 2026-05-28 |

For more information on ADRs, see: https://adr.github.io/
