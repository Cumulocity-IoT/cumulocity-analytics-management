# Architecture Decision Records (ADRs)

## ADR-001: Use Standalone Angular Components Over NgModule

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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

**Status:** ACCEPTED  
**Date:** 2026-05-28  
**Authors:** Development Team

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
| 001 | Standalone Components | ACCEPTED | 2026-05-28 |
| 002 | HTTP Error Interceptor | ACCEPTED | 2026-05-28 |
| 003 | Structured Logging | ACCEPTED | 2026-05-28 |
| 004 | Pydantic Validation | ACCEPTED | 2026-05-28 |
| 005 | Health Checks | ACCEPTED | 2026-05-28 |
| 006 | TypeScript Strict Mode | ACCEPTED | 2026-05-28 |
| 007 | Testing Strategy | ACCEPTED | 2026-05-28 |

For more information on ADRs, see: https://adr.github.io/
