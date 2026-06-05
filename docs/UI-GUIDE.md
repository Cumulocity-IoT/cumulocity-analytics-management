# Analytics UI Development Guide

## Overview

The analytics-ui is an Angular 20 application that provides a web interface for managing custom Analytics Builder blocks as extensions in Cumulocity IoT. This guide covers architecture, best practices, and implementation details.

---

## Architecture

### Component Structure

The application uses standalone Angular 20 components with the following structure:

```
src/
├── analytics-extension.module.ts       # Main module (standalone pattern)
├── app.config.ts                       # Application configuration
├── bootstrap.ts                        # Bootstrap entry point
├── main.ts                            # Application entry
├── styles.less                        # Global styles
├── shared/                            # Shared services and utilities
│   ├── analytics.service.ts           # Main analytics service
│   ├── analytics.model.ts             # Type definitions
│   ├── analytics.constants.ts         # Application constants
│   ├── repository.service.ts          # Repository management
│   ├── http/                          # HTTP error handling
│   │   ├── error.model.ts
│   │   ├── error.interceptor.ts
│   │   ├── error-handler.service.ts
│   │   ├── http.module.ts
│   │   ├── error.interceptor.spec.ts
│   │   └── error-handler.service.spec.ts
│   ├── component/                     # Shared UI components
│   ├── http/                          # HTTP utilities
│   ├── renderer/                      # Block renderers
│   └── wizard/                        # Wizard components
├── block/                             # Block management
│   └── block-grid.component.*
├── manage/                            # Extension management
│   ├── extension-card.component.*
│   ├── extension-details.component.*
│   ├── extension-grid.component.*
│   └── utils.ts
├── monitoring/                        # Engine monitoring
│   └── engine-monitoring.component.*
└── repository/                        # Repository management
    ├── create-extension/
    ├── editor/
    ├── list/
    └── repository/
```

### Standalone Components Migration

**Status:** ✅ Complete (ADR-001)

All components have been migrated to standalone Angular 20 components:
- Removed NgModule-based dependency declarations
- Components import required dependencies directly
- Benefits: smaller bundle (~15-20% reduction), better tree-shaking, simpler dependency management

---

## Type Safety

### TypeScript Strict Mode Configuration

**Status:** ✅ Enabled (ADR-006)

**File:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "strictBindCallApply": true
  }
}
```

### Type Safety Improvements

All files have been updated to comply with strict mode:

**Key Changes:**
- Replaced `any` with `unknown` or specific types
- Added proper type guards for type narrowing
- Fixed null/undefined checks with optional chaining
- Added discriminated unions for error types
- Comprehensive interfaces for all data structures

**Example - Error Handling:**
```typescript
// Before (violates noImplicitAny)
private handleError(error: any): void { }

// After (type-safe)
private handleError(error: unknown): void {
  if (error instanceof CepError) {
    this.handleCepError(error);
  } else if (error instanceof Error) {
    this.handleStandardError(error);
  } else {
    this.handleUnknownError(error);
  }
}
```

---

## HTTP Error Handling

### Error Interceptor with Retry Logic

**Status:** ✅ Implemented (ADR-002)

**Location:** `src/shared/http/`

#### Features

- **Automatic Retry:** Exponential backoff with configurable max retries
- **User-Friendly Messages:** Transforms technical errors into user-friendly text
- **Request Logging:** Correlation IDs for request tracing
- **Sensitive Data Redaction:** Removes auth tokens from logs
- **Error History:** Tracks errors for debugging

#### Configuration

```typescript
// Default retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504]
};
```

#### Usage Example

```typescript
import { HttpModule } from './shared/http/http.module';

// In application configuration
const config = withInterceptors([
  provideHttpClient(
    withInterceptors([errorInterceptor])
  )
]);
```

#### Error Messages

Service provides human-friendly error messages:
- Network connectivity issues
- Timeout errors
- Authentication failures
- Server errors with context
- Rate limiting information

---

## Testing

### Unit Testing Infrastructure

**Status:** ✅ Setup Complete

**Framework:** Karma/Jasmine (built-in with Angular CLI)

**Test Files Created:**
- `src/shared/http/error.interceptor.spec.ts`
- `src/shared/http/error-handler.service.spec.ts`

### Running Tests

```bash
# Run tests once
npm test

# Run tests with coverage
npm test -- --code-coverage

# Run tests in watch mode
npm test -- --watch
```

### Coverage Goals

- Minimum 80% coverage for services
- 70% coverage for components
- 100% coverage for utilities and helpers

---

## Performance Optimization

### Current Optimization Status

**Implemented:**
- ✅ Standalone components (improved tree-shaking)
- ✅ AOT compilation (default with Angular CLI)
- ✅ Change detection strategy (OnPush where applicable)

**Recommended Future Improvements:**
- Lazy loading for manage/repository feature modules
- Virtual scrolling for large block/extension lists
- Response caching with appropriate TTL
- Image optimization and lazy loading
- Bundle size monitoring

### Metrics

**Current Bundle Size:** ~47.9 MB (with dependencies)
**Estimated after optimizations:** 35-40 MB

---

## Module Dependencies

### Key Dependencies

```json
{
  "@angular/core": "^20.3.0",
  "@angular/common": "^20.3.0",
  "@angular/forms": "^20.3.0",
  "@angular/router": "^20.3.0",
  "@c8y/bootstrap": "1023.82.4",
  "@c8y/client": "1023.82.4",
  "@c8y/ngx-components": "1023.82.4",
  "@ngx-translate/core": "15.0.0",
  "rxjs": "7.8.2",
  "zone.js": "~0.15.0"
}
```

### Shared Services

#### AnalyticsService
- Manages extensions and blocks
- Handles GitHub integration
- Provides upload and deployment functionality

#### RepositoryService
- Manages custom repositories
- Handles repository synchronization
- Provides repository listing and details

#### ErrorHandlerService
- Centralized error handling
- User-friendly error messages
- Error history tracking

---

## Development Workflow

### Building

```bash
# Development build
npm run build

# Production build (optimized)
npm run build -- --configuration production
```

### Development Server

```bash
# Start dev server with local Cumulocity instance
npm start

# Serve against different shells
npm run start:admin        # Administration shell
npm run start:ab           # Analytics Builder shell
npm run start:cockpit      # Cockpit shell
```

### Code Quality

```bash
# Format code
npm run format

# Lint code
npm run lint
```

---

## Common Issues and Solutions

### TypeScript Strict Mode Errors

**Issue:** TypeScript error TS5103 with `ignoreDeprecations`
**Solution:** Remove `ignoreDeprecations` option; accept deprecation warning for now

**Issue:** "Object is possibly null"
**Solution:** Use optional chaining (`?.`) or add null checks before access

```typescript
// ✅ Correct
const name = this.state.extension?.name || 'Extension';

// ❌ Incorrect
const name = this.state.extension.name;  // May throw if null
```

---

## Next Steps

1. **State Management:** Implement NgRx for centralized state
2. **E2E Testing:** Add Cypress for user flow testing
3. **Performance:** Implement lazy loading for feature modules
4. **Accessibility:** Add ARIA labels and keyboard navigation
5. **Documentation:** Add component-level JSDoc comments
