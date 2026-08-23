"""

## Structure

- `test_app.py` - Main Flask application tests
- `test_extensions.py` - Extension building and management tests
- `test_repositories.py` - Repository management tests
- `conftest.py` - Pytest configuration and fixtures

## Running Tests

Run all tests:
```bash
pytest
```

Run with coverage:
```bash
pytest --cov=. --cov-report=html
```

Run specific test file:
```bash
pytest tests/test_app.py
```

Run with verbose output:
```bash
pytest -v
```

## Test Coverage Goals

- Aim for 70%+ code coverage
- 100% coverage for critical functions
- Integration tests for API endpoints
- Mock external services (GitHub, Cumulocity)
