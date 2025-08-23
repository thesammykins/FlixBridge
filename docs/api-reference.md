# API Reference

> **📖 Flix-Bridge Documentation**  
> [← Usage](usage.md) | [Next: Multi-Instance →](multi-instance.md)

Complete reference for all available Flix-Bridge tools with examples and response formats.

## Table of Contents

- [Core Operations](#core-operations)
  - [System Status](#system-status)
  - [Queue List](#queue-list) 
  - [Queue Grab](#queue-grab)
  - [Root Folders](#root-folders)
- [Media Management](#media-management)
  - [Search](#search)
  - [Add New](#add-new)
  - [Quality Profiles](#quality-profiles)
  - [History Detail](#history-detail)
  - [Import Issues](#import-issues)
- [Diagnostics & Monitoring](#diagnostics--monitoring)
  - [Queue Diagnostics](#queue-diagnostics)
  - [All Services Diagnostics](#all-services-diagnostics)
  - [Download Status](#download-status)

## Core Operations

### System Status

Get system status and health information for a specific service.

**Input:**
```json
{
  "service": "sonarr-main"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "name": "Sonarr",
    "version": "4.0.0.746",
    "isHealthy": true,
    "startTime": "2024-01-15T10:30:00Z"
  }
}
```

**Multi-Instance Examples:**
```json
// Check 4K instance
{"service": "radarr-4k"}

// Check anime instance
{"service": "sonarr-anime"}
```

### Queue List

List items in the download queue with status and progress information.

**Input:**
```json
{
  "service": "sonarr-main",
  "page": 1,
  "pageSize": 25,
  "sortKey": "progress",
  "sortDirection": "descending"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "total": 5,
    "items": [
      {
        "id": 123,
        "title": "Sample.TV.Series.S01E01",
        "status": "downloading",
        "progressPct": 75,
        "mediaKind": "series",
        "protocol": "usenet",
        "estimatedCompletionTime": "2024-01-15T11:30:00Z"
      }
    ],
    "truncated": false
  }
}
```

**Parameters:**
- `service` (required): Service instance name
- `page` (optional): Page number for pagination
- `pageSize` (optional): Number of items per page (default: 25)
- `sortKey` (optional): Sort by field (progress, title, status)
- `sortDirection` (optional): "ascending" or "descending"

### Queue Grab

Force grab/retry download of specific queued items.

**Single Item:**
```json
{
  "service": "sonarr-main",
  "ids": [123]
}
```

**Multiple Items (Bulk):**
```json
{
  "service": "radarr-4k",
  "ids": [456, 789, 101112]
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "attempted": 1,
    "succeeded": 1,
    "failed": 0,
    "results": [
      {
        "id": 123,
        "success": true,
        "message": "Grab triggered successfully"
      }
    ]
  }
}
```

### Root Folders

List configured root folders and storage information.

**Input:**
```json
{
  "service": "sonarr-main"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "total": 2,
    "folders": [
      {
        "id": 1,
        "path": "/media/tv",
        "freeSpaceBytes": 1000000000000,
        "accessible": true
      },
      {
        "id": 2,
        "path": "/media/tv-4k",
        "freeSpaceBytes": 500000000000,
        "accessible": true
      }
    ],
    "defaultId": 1
  }
}
```

## Media Management

### Search

Search for media (series/movies) to add to your library.

**Input:**
```json
{
  "service": "sonarr-main",
  "query": "Breaking Bad",
  "limit": 5
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "query": "Breaking Bad",
    "total": 3,
    "results": [
      {
        "foreignId": 81189,
        "title": "Breaking Bad",
        "year": 2008,
        "overview": "High school chemistry teacher...",
        "network": "AMC",
        "status": "ended",
        "existing": false
      }
    ]
  }
}
```

**Parameters:**
- `service` (required): Service instance name
- `query` (required): Search term
- `limit` (optional): Maximum results to return

### Add New

Add new media (series/movies) to your library with intelligent quality profile selection.

**Input:**
```json
{
  "service": "sonarr-main",
  "title": "Breaking Bad",
  "foreignId": 81189,
  "qualityProfileId": 2,
  "monitored": true
}
```

**Input (Auto Quality Profile):**
```json
{
  "service": "sonarr-4k",
  "title": "Sample TV Series", 
  "foreignId": 67890
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series", 
    "added": true,
    "id": 789,
    "title": "Breaking Bad",
    "existing": false,
    "qualityProfile": {
      "id": 2,
      "name": "HD-1080p"
    }
  }
}
```

**Quality Profile Safety:**
- If you don't specify `qualityProfileId`, the system intelligently chooses based on service name
- Services with "4k", "uhd", "2160" prefer 4K quality profiles
- Services with "hd", "1080" prefer HD quality profiles  
- Services with "anime" prefer anime-specific profiles
- Use the `Quality Profiles` tool to see available options

**Parameters:**
- `service` (required): Service instance name
- `title` (required): Media title
- `foreignId` (required): External ID (TVDB for TV, TMDB for movies)
- `qualityProfileId` (optional): Quality profile ID (auto-selected if not specified)
- `monitored` (optional): Whether to monitor for downloads (default: true)
- `rootFolderPath` (optional): Storage location (uses default if not specified)

### Quality Profiles

List available quality profiles with intelligent recommendations.

**Input:**
```json
{
  "service": "sonarr-4k"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-4k",
    "mediaKind": "series",
    "total": 3,
    "profiles": [
      {
        "id": 1,
        "name": "Any",
        "upgradeAllowed": true
      },
      {
        "id": 2,
        "name": "HD-1080p",
        "upgradeAllowed": true
      },
      {
        "id": 3,
        "name": "4K-2160p",
        "upgradeAllowed": false
      }
    ],
    "recommended": 3
  }
}
```

The `recommended` field suggests the best quality profile based on your service name.

### History Detail

Get download and import history with optional filtering.

**Input:**
```json
{
  "service": "sonarr-main",
  "page": 1,
  "pageSize": 10,
  "since": "2024-01-01T00:00:00Z"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "total": 25,
    "items": [
      {
        "id": 456,
        "eventType": "grabbed",
        "date": "2024-01-15T10:00:00Z",
        "mediaTitle": "Sample Series S01E01",
        "quality": "HDTV-1080p",
        "successful": true
      }
    ]
  }
}
```

**Parameters:**
- `service` (required): Service instance name
- `page` (optional): Page number for pagination
- `pageSize` (optional): Items per page
- `since` (optional): Only show history after this date (ISO format)

### Import Issues

Check for import issues and stuck downloads.

**Input:**
```json
{
  "service": "sonarr-main"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "totalFiles": 5,
    "issueCount": 2,
    "issues": [
      {
        "path": "/downloads/Sample.Series.S01E01.mkv",
        "reason": "No series found matching file",
        "severity": "warning"
      }
    ]
  }
}
```

## Diagnostics & Monitoring

### Queue Diagnostics

Analyze and automatically fix stuck queue items for a specific service.

**Input:**
```json
{
  "service": "sonarr-main"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "totalQueueItems": 5,
    "issuesFound": 2,
    "issuesAnalyzed": [
      {
        "id": 123,
        "title": "Sample.Series.S01E05",
        "status": "warning",
        "category": {
          "type": "mapping",
          "severity": "warning",
          "autoFixable": true
        },
        "message": "TheXEM mapping issue detected",
        "suggestedAction": "Trigger manual import to bypass mapping requirements"
      }
    ],
    "fixesAttempted": [
      {
        "id": 123,
        "action": "manual_import",
        "reason": "TheXEM mapping issue detected",
        "attempted": true,
        "success": true
      }
    ],
    "summary": {
      "fixed": 2,
      "failed": 0,
      "requiresManual": 0
    }
  }
}
```

**Auto-Fix Categories:**
- **Mapping Issues**: TheXEM episode mapping problems → triggers manual import
- **Quality Downgrades**: Downloads that don't improve existing files → removes from queue
- **Network Errors**: Connectivity issues → retries downloads
- **Unknown Issues**: Provides analysis but requires manual intervention

### All Services Diagnostics

Run queue diagnostics across all configured services simultaneously.

**Input:**
```json
{
  "autoFix": true
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "totalServices": 5,
    "servicesScanned": ["sonarr-hd", "sonarr-uhd", "sonarr-anime", "radarr-hd", "radarr-uhd"],
    "overallSummary": {
      "totalQueueItems": 12,
      "totalIssuesFound": 4,
      "totalFixed": 3,
      "totalFailed": 0,
      "totalRequiresManual": 1
    },
    "serviceResults": [
      {
        "service": "sonarr-hd",
        "mediaKind": "series",
        "totalQueueItems": 5,
        "issuesFound": 2,
        "summary": {
          "fixed": 2,
          "failed": 0,
          "requiresManual": 0
        }
      }
    ]
  }
}
```

**Parameters:**
- `autoFix` (optional): Whether to automatically fix detected issues (default: true)

### Download Status

Get unified download status across multiple services and download clients.

**Input:**
```json
{
  "services": ["sonarr-main", "radarr-main"],
  "includeDownloader": true,
  "downloader": "sabnzbd"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "services": [
      {
        "service": "sonarr-main",
        "mediaKind": "series",
        "queueCount": 3,
        "activeDownloads": 2
      }
    ],
    "downloader": {
      "name": "SABnzbd",
      "status": "idle",
      "queueCount": 5,
      "downloadSpeed": "15.2 MB/s"
    },
    "summary": {
      "totalQueueItems": 8,
      "activeDownloads": 5,
      "completedToday": 12
    }
  }
}
```

**Parameters:**
- `services` (optional): Array of service names to include
- `includeDownloader` (optional): Whether to include download client status
- `downloader` (optional): Download client name (if includeDownloader is true)

## Response Format Standards

All operations return this consistent structure:

```typescript
{
  ok: boolean;
  data?: {
    service: string;           // Service instance name
    mediaKind: 'series' | 'movie';  // Content type indicator
    // ... operation-specific fields
  };
  error?: {
    service: string;
    status?: number;
    message: string;
    // ... error details
  };
}
```

## Common Parameters

- **service**: Always required, must match exact service name from configuration
- **page**: Page number for paginated results (default: 1)
- **pageSize**: Items per page (default: 25, max: 100)

## Error Responses

```json
{
  "ok": false,
  "error": {
    "service": "sonarr-main",
    "status": 404,
    "message": "Resource not found",
    "code": "NotFound"
  }
}
```

Common error codes:
- **NotFound** (404): Service or resource not found
- **Unauthorized** (401): Invalid API key
- **Timeout** (0): Network timeout
- **BadRequest** (400): Invalid parameters

---

**Next Steps:**
- **[Multi-Instance →](multi-instance.md)** - Advanced multi-instance configurations
- **[Troubleshooting →](troubleshooting.md)** - Common issues and solutions
- **[Architecture →](architecture.md)** - Technical architecture and extension guide

---
*Part of the [Flix-Bridge](../README.md) documentation*
