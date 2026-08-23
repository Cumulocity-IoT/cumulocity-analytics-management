# Contributing to Cumulocity Analytics Management

## Getting Started

### Prerequisites
- Node.js 18+ (for frontend)
- Python 3.8+ (for backend)
- Git
- Docker (for backend testing)

### Setting Up Development Environment

#### Frontend (analytics-ui)

```bash
cd analytics-ui
npm install
npm start  # Start dev server at http://localhost:4200
```

#### Backend (analytics-service)

```bash
cd analytics-service

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment example
cp .env.example .env
# Update .env with your Cumulocity credentials

# Run app
python app.py
```

## Development Workflow

### 1. Create Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes
- Follow code style guidelines
- Add tests for new functionality
- Update documentation

### 3. Run Tests
```bash
# Frontend
cd analytics-ui
npm test

# Backend
cd analytics-service
pytest --cov=. --cov-report=html
```

### 4. Check Code Quality
```bash
# Frontend
npm run lint
npm run format

# Backend
pylint *.py
black *.py
```

### 5. Commit Changes
```bash
git commit -m "feat: add feature description

- Added feature X
- Added tests for feature X
- Updated documentation"
```

### 6. Push and Create Pull Request
```bash
git push origin feature/your-feature-name
```

## Code Standards

### TypeScript/Angular (Frontend)
- Use strict TypeScript mode
- Follow Angular style guide
- Use standalone components
- Add JSDoc comments for public methods
- Minimum 80% test coverage
- No `any` types

### Python (Backend)
- Follow PEP 8 style guide
- Use type hints
- Add docstrings to functions
- Maximum line length: 100 characters
- Minimum 70% test coverage
- Use logging instead of print()

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, missing semicolons, etc)
- `refactor` - Code refactoring without feature changes
- `perf` - Performance improvements
- `test` - Test additions/updates
- `chore` - Dependency updates, build config changes

### Examples
```
feat(extensions): add batch delete functionality
fix(errors): handle GitHub API timeouts gracefully
docs(api): update API documentation
test(services): add error handler tests
```

## Testing Guidelines

### Frontend Testing
- Unit tests for services
- Component tests for user interactions
- E2E tests for critical workflows
- Use testing utilities from @angular/core/testing

### Backend Testing
- Unit tests for business logic
- Integration tests for API endpoints
- Mock external services
- Test error cases and edge cases

## Pull Request Process

1. Update documentation if needed
2. Add/update tests
3. Run full test suite locally
4. Keep PR focused (one feature per PR)
5. Request review from at least 2 maintainers
6. Address feedback and re-request review
7. Maintainer merges PR after approval

## Reporting Issues

### Security Issues
- Do NOT create public issues
- Email: security@cumulocity.com with details

### Bug Reports
- Use GitHub Issues
- Include: steps to reproduce, expected behavior, actual behavior
- Include: environment details, logs, screenshots

### Feature Requests
- Use GitHub Discussions
- Include: use case, proposed solution, alternatives considered

## Questions?

- Check [ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions
- Check [README.md](README.md) for project overview
- Check [API.md](analytics-service/API.md) for API documentation
- Open an issue or discussion for questions

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
