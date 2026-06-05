# Analytics Service API Documentation

## Base URL

```
https://<cumulocity-tenant>.cumulocity.com/service/analytics-ext-service
```

## Authentication

All requests require HTTP Basic Authentication with Cumulocity credentials:

```
Authorization: Basic <base64(tenant/username:password)>
```

## Response Format

All responses are JSON with the following structure:

### Success Response (2xx)
```json
{
  "status": "success",
  "data": {},
  "message": "Operation completed successfully"
}
```

### Error Response (4xx, 5xx)
```json
{
  "status": "error",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  },
  "timestamp": "2026-05-28T12:00:00Z"
}
```

---

## Endpoints

### Health Check

#### `GET /health`

Check service health status

**Response:**
```json
{
  "timestamp": "2026-05-28T12:00:00Z",
  "uptime_seconds": 3600,
  "status": "healthy",
  "checks": {
    "system": {
      "status": "healthy",
      "memory_percent": 45,
      "cpu_percent": 20,
      "disk_usage_percent": 60
    },
    "cumulocity": {
      "status": "healthy",
      "message": "Cumulocity credentials available"
    },
    "github": {
      "status": "healthy",
      "message": "GitHub API reachable"
    }
  }
}
```

---

### Extensions

#### `GET /extension`

List all uploaded extensions

**Query Parameters:**
- `limit` (optional): Number of results to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "status": "success",
  "data": {
    "extensions": [
      {
        "name": "Sample_Extension",
        "version": "1.0.0",
        "created": "2026-05-28T10:00:00Z",
        "blocks": ["BlockA", "BlockB"],
        "source": "uploaded"
      }
    ],
    "total": 1
  }
}
```

---

#### `POST /extension`

Upload or build a new extension

**Request Body:**
```json
{
  "extension_name": "My_Extension",
  "upload": true,
  "monitors": [
    "https://raw.githubusercontent.com/org/repo/main/Block.mon"
  ],
  "repositories": [
    {
      "url": "https://github.com/org/repo",
      "path": "blocks",
      "branch": "main"
    }
  ]
}
```

**Parameters:**
- `extension_name` (required): Name of the extension
- `upload` (optional, default: true): Upload to Cumulocity inventory after build
- `monitors` (optional): Array of .mon file URLs to build extension from
- `repositories` (optional): Array of GitHub repository configs to build from

**Response:**
```json
{
  "status": "success",
  "data": {
    "extension_id": "ext_123",
    "name": "My_Extension",
    "size_bytes": 5242880,
    "url": "https://cumulocity.com/inventory/My_Extension.zip",
    "blocks": ["BlockA", "BlockB"],
    "uploaded": true
  }
}
```

**Error Codes:**
- `INVALID_EXTENSION_NAME`: Extension name contains invalid characters
- `EXTENSION_EXISTS`: Extension with this name already exists
- `BUILD_FAILED`: Failed to build extension from repositories
- `UPLOAD_FAILED`: Failed to upload extension to Cumulocity

---

#### `GET /extension/<name>`

Get extension details

**Response:**
```json
{
  "status": "success",
  "data": {
    "name": "Sample_Extension",
    "version": "1.0.0",
    "size_bytes": 1024000,
    "created": "2026-05-28T10:00:00Z",
    "blocks": [
      {
        "name": "SampleBlock",
        "category": "Analytics",
        "custom": true
      }
    ]
  }
}
```

---

#### `DELETE /extension/<name>`

Delete an extension

**Response:**
```json
{
  "status": "success",
  "data": {
    "message": "Extension deleted successfully"
  }
}
```

---

### Repositories

#### `GET /repository`

List configured repositories

**Response:**
```json
{
  "status": "success",
  "data": {
    "repositories": [
      {
        "id": "repo_123",
        "url": "https://github.com/org/repo",
        "path": "blocks",
        "branch": "main",
        "enabled": true,
        "created": "2026-05-28T09:00:00Z"
      }
    ]
  }
}
```

---

#### `POST /repository`

Add a new repository

**Request Body:**
```json
{
  "url": "https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk",
  "path": "samples/blocks",
  "branch": "main"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "repo_123",
    "url": "https://github.com/org/repo",
    "blocks_found": 15
  }
}
```

---

#### `DELETE /repository/<id>`

Remove a repository

**Response:**
```json
{
  "status": "success",
  "data": {
    "message": "Repository removed successfully"
  }
}
```

---

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| INVALID_REQUEST | 400 | Invalid request parameters |
| UNAUTHORIZED | 401 | Authentication failed |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource already exists |
| GITHUB_ERROR | 502 | GitHub API error |
| CUMULOCITY_ERROR | 502 | Cumulocity API error |
| INTERNAL_ERROR | 500 | Internal server error |

---

## Rate Limiting

Requests are limited to:
- 100 requests per minute per user
- 1000 requests per hour per user

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1685276400
```

---

## Examples

### Build Extension from Repository

```bash
curl -X POST https://tenant.cumulocity.com/service/analytics-ext-service/extension \
  -H "Authorization: Basic $(echo -n 'tenant/user:pass' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "extension_name": "Custom_Blocks",
    "upload": true,
    "repositories": [{
      "url": "https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk",
      "path": "samples/blocks",
      "branch": "main"
    }]
  }'
```

### Check Service Health

```bash
curl https://tenant.cumulocity.com/service/analytics-ext-service/health \
  -H "Authorization: Basic $(echo -n 'tenant/user:pass' | base64)"
```

---

## Changelog

### v1.0.0
- Initial API release
- Extension upload and management
- Repository management
- Health checks
