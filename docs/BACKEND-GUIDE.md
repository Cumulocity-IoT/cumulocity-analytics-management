# Analytics Service Backend Development Guide

## Overview

The analytics-service is a Python/Flask application that provides a RESTful API for managing custom Analytics Builder blocks and their deployment in Cumulocity IoT. This guide covers architecture, API design, deployment, and best practices.

---

## Architecture

### Project Structure

```
analytics-service/
├── app.py                          # Flask application entry point
├── c8y_agent.py                   # Cumulocity IoT integration
├── solution_utils.py              # Utility functions
├── cumulocity.json                # Cumulocity configuration
├── Dockerfile                     # Container configuration
├── requirements.txt               # Python dependencies
├── logging_config.py              # Logging configuration
├── health_check.py                # Health check endpoint
├── API.md                         # API documentation
├── local_deploy.sh                # Local deployment script
├── build.sh                       # Build script
├── build/                         # Build artifacts
└── tests/                         # Test suite
    ├── __init__.py
    ├── conftest.py
    └── test_app.py
```

### Technology Stack

- **Framework:** Flask 3.x
- **Server:** Gunicorn (production)
- **Container:** Docker
- **Python Version:** 3.11+
- **Testing:** pytest with coverage
- **Logging:** Python logging with JSON format

---

## API Design

### Base URL

```
Production: https://{tenant}.cumulocity.com/service/analytics-service/
Development: http://localhost:5000/
```

### Authentication

All endpoints except `/health` require Cumulocity authentication:
- Basic Auth or OAuth 2.0
- Tenant ID in header or URL

### Response Format

**Success Response (200-299):**
```json
{
  "success": true,
  "data": { /* response data */ },
  "timestamp": "2026-05-28T10:30:00Z"
}
```

**Error Response (400+):**
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2026-05-28T10:30:00Z"
}
```

### Rate Limiting

- **Limit:** 100 requests per minute per user
- **Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Status Code:** 429 Too Many Requests

---

## Health Checks Endpoint

**Status:** ✅ Implemented (ADR-005)

**Location:** `health_check.py`

### Endpoint

```
GET /health
```

### Response

```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2026-05-28T10:30:00Z",
  "checks": {
    "system": {
      "status": "healthy",
      "memory": {
        "available_mb": 2048,
        "used_percent": 45.5
      },
      "cpu": {
        "percent": 25.0
      },
      "disk": {
        "available_gb": 50,
        "used_percent": 30.0
      }
    },
    "cumulocity": {
      "status": "healthy",
      "credentials_available": true
    },
    "github": {
      "status": "healthy",
      "response_time_ms": 150
    }
  }
}
```

### Status Levels

- **healthy:** All checks passed
- **degraded:** Some non-critical checks failed
- **unhealthy:** Critical checks failed

### Checks Performed

1. **System Resources**
   - Available memory
   - CPU usage
   - Disk space
   - Thresholds: memory < 10%, cpu < 90%, disk < 10%

2. **Cumulocity Connectivity**
   - Credentials availability
   - Authentication token validity

3. **GitHub API Connectivity**
   - API endpoint reachability
   - Response time monitoring

4. **Service Uptime**
   - Time since service start

---

## Structured Logging

**Status:** ✅ Implemented (ADR-003)

**Location:** `logging_config.py`

### Features

- **JSON Logging (Production):** Machine-readable log format for aggregation
- **Text Logging (Development):** Human-readable format with colors
- **Rotating Handler:** Automatic log rotation based on file size
- **Request Correlation:** Unique IDs for request tracing
- **Data Redaction:** Automatic removal of sensitive information

### Configuration

**Environment Variables:**
```bash
LOG_LEVEL=INFO              # DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_FORMAT=json             # json or text
LOG_FILE=logs/app.log       # Log file path
LOG_MAX_BYTES=10485760      # 10MB
LOG_BACKUP_COUNT=5          # Keep 5 old files
```

### Log Format

**JSON Log Example:**
```json
{
  "timestamp": "2026-05-28T10:30:00Z",
  "level": "INFO",
  "logger": "app",
  "message": "Request started",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/extension",
  "status": 201,
  "duration_ms": 250,
  "user": "admin@tenant.com"
}
```

### Redacted Fields

The following sensitive fields are automatically redacted:
- Authorization headers
- API tokens
- Passwords
- SSH keys
- Access tokens

---

## Testing Infrastructure

**Status:** ✅ Setup Complete

**Location:** `tests/`

### Framework

- **Test Runner:** pytest
- **Coverage Tool:** pytest-cov
- **Fixtures:** Defined in `conftest.py`

### Test Files

- `test_app.py` - Application and endpoint tests
- `conftest.py` - pytest configuration and fixtures

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage report
pytest --cov=. --cov-report=html --cov-report=term

# Run specific test
pytest tests/test_app.py::test_health_check

# Run with verbose output
pytest -vv

# Run only integration tests
pytest -m integration
```

### Coverage Reports

```bash
# Generate HTML coverage report
pytest --cov=. --cov-report=html

# View report
open htmlcov/index.html
```

### Target Coverage

- Minimum 80% for services
- Minimum 70% for utils
- Minimum 60% for routes

---

## Request Validation

**Status:** ✅ Implementation Roadmap (ADR-004)

Using Pydantic for declarative request validation:

```python
from pydantic import BaseModel, Field

class ExtensionRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=1000)
    github_url: str = Field(..., regex=r'https://github\.com/.*')
    version: str = Field(default="1.0.0")

# Automatic validation on request deserialization
@app.post('/extension')
def create_extension(req: ExtensionRequest):
    # req is already validated
    pass
```

### Benefits

- Declarative schemas
- Automatic type validation
- Self-documenting API
- Consistent error messages
- Request serialization

---

## Deployment

### Docker Build

```bash
# Build image
docker build -t analytics-service:latest .

# Run container
docker run -p 5000:5000 \
  -e CUMULOCITY_BASEURL=https://tenant.cumulocity.com \
  -e CUMULOCITY_USERNAME=admin \
  -e CUMULOCITY_PASSWORD=password \
  analytics-service:latest
```

### Environment Configuration

**Required Environment Variables:**
```bash
CUMULOCITY_BASEURL=https://tenant.cumulocity.com
CUMULOCITY_USERNAME=admin
CUMULOCITY_PASSWORD=password
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

**Optional Environment Variables:**
```bash
FLASK_ENV=production              # production or development
LOG_LEVEL=INFO
LOG_FORMAT=json                   # json or text
PORT=5000
WORKERS=4                         # Gunicorn workers
```

### Local Deployment

```bash
# Setup virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run local server
python app.py
```

### Production Deployment

**Using Gunicorn:**
```bash
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  analytics-service:
    build: .
    ports:
      - "5000:5000"
    environment:
      - FLASK_ENV=production
      - LOG_FORMAT=json
    volumes:
      - ./logs:/app/logs
```

---

## API Endpoints

### Extension Management

**GET /extension**
- List all extensions
- Query parameters: `skip=0`, `limit=50`
- Response: List of extensions with metadata

**POST /extension**
- Upload and build extension
- Request body: ExtensionRequest
- Response: Deployment result

**GET /extension/{name}**
- Get extension details
- Response: Extension with full metadata

**DELETE /extension/{name}**
- Delete extension
- Response: Deletion confirmation

### Repository Management

**GET /repository**
- List all repositories
- Response: List of repositories

**POST /repository**
- Add new repository
- Request body: RepositoryRequest
- Response: Repository confirmation

**DELETE /repository/{id}**
- Remove repository
- Response: Deletion confirmation

### Health & Status

**GET /health**
- Health check with system metrics
- Response: Health status with checks

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

### Error Response Example

```json
{
  "success": false,
  "error": "Invalid extension configuration",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "github_url",
    "message": "Invalid GitHub URL format"
  },
  "timestamp": "2026-05-28T10:30:00Z"
}
```

---

## Dependencies

**Core Dependencies:**
```
Flask==3.0.0
Gunicorn==21.0.0
Requests==2.31.0
python-dotenv==1.0.0
```

**Development Dependencies:**
```
pytest==7.4.0
pytest-cov==4.1.0
black==23.0.0
pylint==2.17.0
```

### Managing Dependencies

```bash
# Add new dependency
pip install package-name
pip freeze > requirements.txt

# Update dependencies
pip install --upgrade -r requirements.txt
```

---

## Common Issues and Solutions

### Issue: Cumulocity Authentication Failure
**Solution:** 
- Verify credentials in environment variables
- Check tenant URL format
- Ensure user has necessary permissions

### Issue: GitHub Rate Limiting
**Solution:**
- Use GitHub token instead of basic auth
- Check remaining API rate limit in logs
- Implement caching for frequently accessed repos

### Issue: High Memory Usage
**Solution:**
- Check health endpoint for memory metrics
- Review log file size and rotation settings
- Consider using Gunicorn worker limits

---

## Next Steps

1. **Request Validation:** Implement Pydantic models for all endpoints
2. **Database:** Add persistence layer for extension metadata
3. **Caching:** Implement Redis for response caching
4. **Monitoring:** Setup APM (Application Performance Monitoring)
5. **Security:** Implement rate limiting and DDoS protection
