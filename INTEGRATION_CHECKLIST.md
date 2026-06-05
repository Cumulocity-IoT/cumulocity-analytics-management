# Integration Checklist

Use this checklist to integrate all improvements into your development workflow.

## ✅ Frontend (analytics-ui)

### Step 1: Enable TypeScript Strict Mode
- [x] Updated `tsconfig.json` with strict mode
- [ ] Run `npm run build` to check for type errors
- [ ] Fix any TypeScript errors revealed by strict mode
- [ ] Commit changes: `git add tsconfig.json && git commit -m "chore(config): enable TypeScript strict mode"`

### Step 2: Integrate Error Handling
- [ ] The HTTP module files are ready in `src/shared/http/`
- [ ] Import in your main application file:
  ```typescript
  import { HttpModule } from './shared/http';
  
  // Add to module imports or standalone imports
  ```
- [ ] Test error handling by simulating a failed request
- [ ] Verify retry logic works (check browser Network tab)

### Step 3: Setup Unit Tests
- [x] Test templates created in `src/shared/http/*.spec.ts`
- [ ] Run `npm test` to launch test suite
- [ ] Verify test runner is working
- [ ] Add more tests for other services

### Step 4: Build & Verify
```bash
cd analytics-ui
npm install              # Install dependencies
npm run lint            # Check code quality
npm run build           # Build for production
npm test               # Run tests
```

---

## ✅ Backend (analytics-service)

### Step 1: Update Dependencies
```bash
cd analytics-service
pip install -r requirements.txt
```

New packages installed:
- `psutil` - For health checks
- `pytest` - Testing framework
- `pytest-cov` - Coverage reporting
- `pytest-mock` - Mocking
- `pydantic` - Validation (future use)

### Step 2: Setup Environment
```bash
# Copy example configuration
cp .env.example .env

# Edit .env with your Cumulocity credentials
nano .env  # or use your preferred editor
```

Required in `.env`:
```
C8Y_BASEURL=https://your-tenant.cumulocity.com
C8Y_BOOTSTRAP_TENANT=<tenant_id>
C8Y_BOOTSTRAP_USER=servicebootstrap_analytics-ext-service
C8Y_BOOTSTRAP_PASSWORD=<password>
```

### Step 3: Integrate Health Check
In your `app.py`, add:
```python
from health_check import health_check
from logging_config import setup_logging, get_logger

# Setup logging on startup
setup_logging()
logger = get_logger(__name__)

# Add health endpoint
@app.route('/health')
def health():
    return jsonify(health_check.get_health_status())
```

### Step 4: Setup Logging
In your `app.py`:
```python
from logging_config import setup_logging, get_logger

# Call on startup
setup_logging()
logger = get_logger(__name__)

# Use in your code
logger.info("Extension uploaded", extra={
    'extension_name': name,
    'size_bytes': size
})
```

### Step 5: Run Tests
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=. --cov-report=html

# Run specific test file
pytest tests/test_app.py -v
```

### Step 6: Verify Health Endpoint
```bash
curl -X GET http://localhost:5000/health \
  -H "Authorization: Basic <base64_credentials>"
```

---

## ✅ Project Level

### Documentation
- [ ] Review [AGENT.md](AGENT.md) - System overview
- [ ] Review [IMPROVEMENTS.md](IMPROVEMENTS.md) - Future roadmap
- [ ] Review [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Design decisions
- [ ] Review [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines

### Source Control
```bash
# Create feature branch
git checkout -b feature/integrate-improvements

# Stage changes
git add .

# Commit
git commit -m "feat: integrate quick wins improvements

- Add TypeScript strict mode
- Add HTTP error interceptor with retry logic
- Add health check endpoint
- Add structured logging
- Add testing infrastructure
- Add API documentation
- Add architecture decision records
- Add contributing guidelines"

# Push
git push origin feature/integrate-improvements

# Create pull request
```

---

## 📋 Verification Checklist

### Frontend
- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds with no errors
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] HTTP interceptor logs requests (check browser console)
- [ ] Failed requests show user-friendly error messages

### Backend
- [ ] `pip install -r requirements.txt` succeeds
- [ ] `.env` file is configured
- [ ] `pytest` runs successfully
- [ ] `pytest --cov=.` shows coverage
- [ ] `/health` endpoint returns valid JSON
- [ ] Logs are formatted correctly

### Project
- [ ] All documentation files are readable
- [ ] `.env.example` shows all required settings
- [ ] `CONTRIBUTING.md` is clear and complete
- [ ] Tests can be run from documentation

---

## 🎯 What to Validate

### Error Handling (Frontend)
1. Open browser DevTools (F12)
2. Navigate to a page that makes API calls
3. In DevTools Network tab, filter to XHR requests
4. Manually break network (DevTools → Network → Offline)
5. Verify error message appears to user
6. Verify retry happens automatically
7. Re-enable network
8. Verify request eventually succeeds

### Health Check (Backend)
1. Start the Flask app: `python app.py`
2. In another terminal, test health endpoint:
   ```bash
   curl http://localhost:5000/health
   ```
3. Verify all checks are present
4. Verify JSON is properly formatted

### Logging (Backend)
1. Look for log entries in console
2. Verify JSON format (if LOG_FORMAT=json)
3. Check for request IDs in logs
4. Verify sensitive data is redacted

### Testing (Both)
1. Frontend: `npm test` shows tests running
2. Backend: `pytest` shows test collection
3. Both show successful execution

---

## 📝 Commit Message Template

```
feat(improvements): integrate quick wins phase 1

## What changed
- TypeScript strict mode enabled
- HTTP error interceptor with retry logic
- Health check endpoint
- Structured logging
- Testing infrastructure
- API documentation
- Architecture decision records

## How to test
- Frontend: npm install && npm test
- Backend: pip install -r requirements.txt && pytest

## Review checklist
- [ ] TypeScript builds without errors
- [ ] Tests pass locally
- [ ] Health endpoint responds
- [ ] Error messages are user-friendly
- [ ] Logging is structured
```

---

## 📚 Next Steps After Integration

1. **Code Review** - Team reviews the changes
2. **Testing** - Run full test suite on CI/CD
3. **Deployment** - Deploy to development environment
4. **Validation** - Test in actual environment
5. **Phase 2** - Plan next improvements

---

## 🆘 Troubleshooting

### TypeScript Strict Mode Errors
- Check `tsconfig.json` is properly updated
- Run `npm run build` to see all errors
- Fix type errors systematically
- See [docs/ARCHITECTURE.md#adr-006](docs/ARCHITECTURE.md) for details

### Import Errors for HTTP Module
- Ensure `HttpModule` is imported in app bootstrap
- Check path: `src/shared/http`
- Verify files exist in that directory

### Health Check Not Working
- Verify `.env` file has `C8Y_BASEURL` set
- Check Flask app has the `/health` route
- Test with: `curl http://localhost:5000/health`

### Logging Not Appearing
- Verify `setup_logging()` is called on startup
- Check `LOG_LEVEL` environment variable
- Look for log file if configured

### Tests Not Running
- Frontend: Verify Karma/Jasmine is installed
- Backend: Verify pytest is installed
- Run `npm test` or `pytest` with verbose flag

---

## ✅ Sign-Off

Once you've completed this checklist:

- [ ] All verification items pass
- [ ] No merge conflicts
- [ ] Code review approved
- [ ] Ready to merge to main branch

---

**Last Updated:** May 28, 2026  
**Version:** 1.0  
**Status:** Ready for Integration
