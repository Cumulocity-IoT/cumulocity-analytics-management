# Cumulocity Analytics Management - System Overview

## What is this system?

**Cumulocity Analytics Management** is a comprehensive solution for managing custom Analytics Builder Blocks as extensions in Cumulocity IoT's Streaming Analytics application. It consists of two main components:

- **Analytics UI Plugin**: An Angular-based web application that provides a user interface for managing analytics extensions, uploading custom blocks, and viewing monitoring information
- **Analytics Backend Microservice**: A Python-based microservice that builds analytics extensions from GitHub repositories and deploys them to the Streaming Analytics engine

### Key Capabilities
- Upload, download, update, and delete custom Analytics Builder extensions
- Build extensions from GitHub repositories
- Manage GitHub repository configurations
- Monitor Streaming Analytics engine status via alarms and events
- Deploy and restart the Streaming Analytics engine

## How is it organized?

### Directory Structure
```
cumulocity-analytics-management/
├── analytics-ui/                 # Angular 20 frontend application
│   ├── src/                      # TypeScript source code
│   │   ├── app/                  # Main application module
│   │   ├── block/                # Block grid components
│   │   ├── manage/               # Extension management UI
│   │   ├── monitoring/           # Engine monitoring components
│   │   ├── repository/           # Repository management
│   │   │   ├── create-extension/
│   │   │   ├── editor/           # EPL code editor
│   │   │   └── list/             # Extension listing
│   │   └── shared/               # Shared services and utilities
│   ├── angular.json              # Angular CLI config
│   └── package.json              # Frontend dependencies
│
├── analytics-service/            # Python Flask microservice
│   ├── app.py                    # Flask application entry point
│   ├── c8y_agent.py             # Cumulocity integration
│   ├── solution_utils.py         # Utility functions
│   ├── requirements.txt          # Python dependencies
│   ├── Dockerfile               # Container configuration
│   └── build.sh                 # Build script
│
├── repository/                   # Sample blocks repository
│   └── blocks/                   # Example .mon files
│
└── resources/                    # Documentation images
    └── images/
```

### Technology Stack

**Frontend (analytics-ui):**
- Angular 21.2.x - Core framework
- TypeScript 5.9.3 - Language
- RxJS 7.8.2 - Reactive programming
- Cumulocity 1024.15.1 - IoT platform integration
- ngx-bootstrap 21.2.2 - UI components
- ESLint + Prettier - Code quality

**Backend (analytics-service):**
- Python 3.8+
- Flask - Web framework
- Docker - Containerization
- Cumulocity Python SDK - Platform integration

## How do I run it?

### Frontend Development

1. **Install dependencies:**
   ```bash
   cd analytics-ui
   npm install
   ```

2. **Start local development server:**
   ```bash
   npm start
   # Serves on http://localhost:4200
   ```

3. **Build for production:**
   ```bash
   npm run build
   # Creates dist/ directory with optimized bundle
   ```

4. **Code quality:**
   ```bash
   npm run format   # Format with Prettier
   npm run lint     # Check and fix with ESLint
   ```

5. **Deploy to Cumulocity:**
   ```bash
   npm run deploy
   ```

### Available Angular CLI commands

```bash
npm run start:admin              # Serve with admin shell
npm run start:ab                # Serve with Analytics Builder shell
npm run start:cockpit           # Serve with Cockpit shell
```

### Backend Microservice

1. **Build Docker image:**
   ```bash
   cd analytics-service
   ./build.sh analytics-ext-service VERSION
   ```

2. **Deploy to Cumulocity:**
   ```bash
   c8y microservices create --file dist/analytics-ext-service.zip
   ```

3. **Local debugging (Dev Container):**
   - Open in VS Code with Dev Container extension
   - Configure `.env-admin` with Cumulocity credentials
   - Debug `flask_wrapper.py` directly in VS Code

## How do I verify it?

### Frontend Verification

1. **Check build succeeds:**
   ```bash
   cd analytics-ui
   npm run build
   # Should complete without errors
   ```

2. **Run linting:**
   ```bash
   npm run lint
   # Should show no errors
   ```

3. **Browser development:**
   - Start: `npm start`
   - Navigate to configured shell (administration, streaminganalytics, or cockpit)
   - Verify UI loads without console errors

### Backend Verification

1. **Test microservice endpoint:**
   ```bash
   curl --location 'http://127.0.0.1:<port>/extension' \
     --header 'Content-Type: application/json' \
     --header 'Authorization: Basic <base64_credentials>' \
     --data '{
       "extension_name": "Test",
       "upload": true,
       "monitors": ["https://raw.githubusercontent.com/Cumulocity-IoT/apama-analytics-builder-block-sdk/rel/10.18.0.x/samples/blocks/CreateEvent.mon"]
     }'
   ```

2. **Check logs:**
   - Administration > Ecosystem > Microservices > apama-ctrl-* > Logs
   - Look for: `[correlator] INFO - Applying extension`

### Integration Verification

1. **Upload extension through UI:**
   - Navigate to Manage Extensions
   - Click "Add extension"
   - Upload test .zip file
   - Restart Streaming Analytics engine
   - Verify blocks appear in Analytics Builder

2. **Monitor deployment:**
   - Check Monitoring tab for alarms/events
   - Look for engine status and safe mode indicators

## What's the current progress?

### Recent Updates (May 28, 2026)

✅ **Completed:**
- Updated Angular packages to v20.3.0 across frontend
- Updated Cumulocity packages to v1023.82.4
- Updated TypeScript to v5.9.2
- Updated RxJS to v7.8.2
- Updated ngx-bootstrap to v20.0.2
- Added @c8y/bootstrap and @c8y/options packages
- Removed unnecessary Angular dev dependencies (@angular-eslint/*, @angular-devkit/build-angular)
- Replaced with @angular/build for streamlined development
- Successfully ran `npm install` with no dependency conflicts
- Updated README.md with current versions and build instructions

### Package Status
- **Frontend:** ✅ All npm dependencies installed successfully
- **Backend:** Ready for deployment (see analytics-service/README.md)
- **Compatibility:** Tested with Cumulocity 1023.82.4

### Known Issues & Considerations
- `@c8y/ngx-components v1023.82.4` requires specific peer dependency versions
- Angular 20 development requires Node.js 18+ or 20+
- Backend microservice requires separate Docker build and deployment

### Next Steps for Review
1. Run full test suite (if available)
2. Verify UI displays correctly with current Cumulocity version
3. Test extension upload and deployment workflow
4. Review EPL code editor functionality
5. Validate GitHub repository integration
6. Check monitoring and alarm display features

### Build Artifacts
- **Frontend:** `/dist/` - Angular build output
- **Backend:** `/analytics-service/dist/analytics-ext-service.zip` - Docker image archive
- **Documentation:** Images in `/resources/images/`

### Documentation
- See [README.md](README.md) for detailed build and deployment instructions
- See [analytics-ui/README.md](analytics-ui/README.md) for frontend-specific details
- See [analytics-service/README.md](analytics-service/README.md) for backend details
