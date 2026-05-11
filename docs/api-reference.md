# API Reference

> **📖 Flix-Bridge Documentation**
> [← Usage](usage.md) | [Next: Multi-Instance →](multi-instance.md)

Complete reference for all available Flix-Bridge tools with examples and response formats.

> **Production Safety Note**: Use `queue_diagnostics` and `all_services_diagnostics` with `autoFix:false` for read-only production baselines. Their default is `autoFix:true`, which can retry downloads, trigger manual imports, or remove not-an-upgrade queue items.

> **ℹ️ API Version Note**: This documentation is based on the Sonarr/Radarr v3 API specification. The v3 API is compatible with both v3 and v4 versions of Sonarr/Radarr applications. Flix-Bridge is designed to be extensible to other *arr services (Lidarr, Readarr, etc.) in the future.

## Table of Contents

- [Service Discovery](#service-discovery)
  - [list_services](#list_services)
- [Core Operations](#core-operations)
  - [system_status](#system_status)
  - [queue_list](#queue_list)
  - [queue_grab](#queue_grab)
  - [remove_content](#remove_content)
  - [manual_import](#manual_import)
  - [root_folders](#root_folders)
- [Media Management](#media-management)
  - [search](#search)
  - [add_new](#add_new)
  - [quality_profiles](#quality_profiles)
  - [history_detail](#history_detail)
  - [import_issues](#import_issues)
- [Diagnostics & Monitoring](#diagnostics--monitoring)
  - [queue_diagnostics](#queue_diagnostics)
  - [all_services_diagnostics](#all_services_diagnostics)
  - [download_status](#download_status)
  - [server_metrics](#server_metrics)

## Service Discovery

> **⚠️ Important**: Always call `list_services` first to discover available services before using any other tools.

### list_services

List all configured services and downloaders. This tool provides discovery of available services and must be called before using any service-specific operations.

**Input:**
```json
{}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "services": [
      {
        "name": "sonarr-hd",
        "type": "sonarr"
      },
      {
        "name": "sonarr-4k",
        "type": "sonarr"
      },
      {
        "name": "radarr-main",
        "type": "radarr"
      }
    ],
    "downloaders": [
      {
        "name": "sabnzbd-main",
        "type": "sabnzbd"
      }
    ],
    "summary": {
      "totalServices": 3,
      "totalDownloaders": 1
    }
  }
}
```

**Parameters:**
- None required

**Usage Notes:**
- This tool requires no service parameter unlike all other tools
- Use the service names returned here for all subsequent tool calls
- Service names are determined by your environment variable configuration
- Service types help identify whether a service is Sonarr or Radarr

## Core Operations

### system_status

Get system status and health information for a specific service.

> **Service Compatibility:** Works with both Sonarr and Radarr instances. Response format is identical across services.

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

### queue_list

List items in the download queue with status and progress information.

> **Service Compatibility:** Works with both Sonarr and Radarr instances. The `mediaKind` field in responses indicates whether items are "series" (Sonarr) or "movie" (Radarr).

**Input:**
```json
{
  "service": "sonarr-main",
  "page": 1,
  "pageSize": 25
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
- `page` (optional): Page number for pagination (default: 1)
- `pageSize` (optional): Number of items per page (default: 25, API default: 10)

**Diagnosing Stuck Items:**
- Sonarr/Radarr attach `statusMessages` to each queue entry. The raw payload (available via `GET /api/v3/queue` or `GET /api/v3/queue/details`) looks like:
  ```json
  {
    "status": "completed",
    "errorMessage": "Automatic import is not possible.",
    "statusMessages": [
      {
        "title": "Downloaded - Unable to Import",
        "messages": ["Manual investigation required", "Additional details here"]
      }
    ]
  }
  ```
  **Note:** `statusMessages` is an array where each object contains:
  - `title` (string): Summary of the issue
  - `messages` (array of strings): Detailed messages about the issue
- `queue_list` keeps the response lightweight. For richer explanations use [`queue_diagnostics`](#queue_diagnostics) (we surface normalized messages derived from these fields) or query the queue endpoint directly when you need the exact text.
- Torrent jobs do not expose the original payload through the manual-import API. You may see `statusMessages` explaining the failure, but follow-up actions (copying files, retriggering import) must be handled by your download client or through the service UI.

### queue_grab

Force grab/retry download of specific queued items.

**API Endpoints:**
- Single item: `POST /api/v3/queue/grab/{id}`
- Bulk operation: `POST /api/v3/queue/grab/bulk`

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
    "grabbed": 1,
    "ids": [123]
  }
}
```

### remove_content

Remove items from queue or library with optional preview and confirmation workflow.

**API Endpoints:**
- Queue deletion: `DELETE /api/v3/queue/{id}`
- Library deletion (Sonarr): `DELETE /api/v3/series/{id}`
- Library deletion (Radarr): `DELETE /api/v3/movie/{id}`

**Preview Mode (dryRun: true - default):**
```json
{
  "service": "sonarr-main",
  "target": "queue",
  "ids": [123, 456],
  "dryRun": true,
  "removeFromClient": true,
  "blocklist": false
}
```

**Execute Mode (dryRun: false):**
```json
{
  "service": "sonarr-main",
  "target": "queue",
  "ids": [123, 456],
  "dryRun": false,
  "confirmationToken": "token_from_preview",
  "removeFromClient": true,
  "blocklist": false,
  "allowManualRemoval": false
}
```

**Output (Preview Mode):**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "target": "queue",
    "preview": {
      "requestedIds": [123, 456],
      "targets": [
        {
          "id": 123,
          "source": "queue",
          "title": "Sample.Series.S01E01",
          "status": "warning",
          "downloadId": "SAB_nzo_abc123",
          "protocol": "usenet",
          "manualReviewRequired": true
        }
      ]
    },
    "confirmationToken": "unique_token_here",
    "nextAction": "Call remove_content with dryRun:false and the provided confirmationToken to execute the removal."
  }
}
```

**Output (Execute Mode):**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "kind": "queue",
    "removed": 2,
    "failed": 0,
    "skipped": 0,
    "details": [
      {
        "id": 123,
        "title": "Sample.Series.S01E01",
        "source": "queue",
        "status": "removed",
        "message": "Manual import triggered"
      }
    ]
  }
}
```

**Parameters:**
- `service` (required): Service instance name
- `target` (required): Removal target - "queue" or "library"
- `ids` (required): Array of item IDs to remove
- `dryRun` (optional): Preview mode without executing (default: true)
- `confirmationToken` (optional): Token from preview mode (required when dryRun: false)
- `removeFromClient` (optional): Remove from download client when removing queue items (default: true)
- `blocklist` (optional): Add to blocklist when removing queue items (default: false)
- `deleteFiles` (optional): Delete media files when removing from library (default: false)
- `addImportExclusion` (optional): Add to import exclusion list when removing from library (default: false)
- `allowManualRemoval` (optional): Allow removal of items flagged for manual review (default: false)
- `manualImport` (optional): Try manual import before removing queue items unless set to false (default: true)

**Workflow:**
1. **Preview**: Call with `dryRun: true` to see what will be removed
2. **Review**: Check the preview response and `manualReviewRequired` flags
3. **Execute**: Call with `dryRun: false` and the `confirmationToken` to confirm removal

**Safety Features:**
- Two-step confirmation workflow prevents accidental deletions
- Automatic manual import attempt before queue removal (when possible)
- Manual review flags for items requiring investigation
- Detailed preview showing exactly what will be affected
- Optional downloader cleanup is previewed before execution when `removeFromDownloader:true` is used

### manual_import

Preview and execute safe one-item manual import candidates for a queue entry.

The flow is strict by design: preview first, then execution only with the returned token.

**Input (preview):**
```json
{
  "service": "sonarr-main",
  "queueId": 123,
  "dryRun": true
}
```

**Output (preview):**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "queueId": 123,
    "candidates": [
      {
        "fileId": "uuid-or-id",
        "path": "/media/downloads/show.S01E05.mkv",
        "rejections": [],
        "quality": "WEB-DL"
      }
    ],
    "confirmationToken": "candidate_token",
    "nextAction": "Call manual_import with dryRun:false and confirmationToken"
  }
}
```

**Input (execute):**
```json
{
  "service": "sonarr-main",
  "queueId": 123,
  "dryRun": false,
  "confirmationToken": "candidate_token"
}
```

Execution uses Sonarr/Radarr UI-equivalent payload:
`POST /api/v3/command` with `{"name":"ManualImport","files":[...],"importMode":"auto"}`.

Execution is considered successful only if queue state changes after the POST (the item disappears or transitions away).

**Output (execute):**
```json
{
  "ok": true,
  "data": {
    "service": "sonarr-main",
    "mediaKind": "series",
    "queueId": 123,
    "attempted": true,
    "success": true,
    "details": {
      "message": "Manual import command sent and queue state changed"
    }
  }
}
```

### root_folders

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

### search

Search for media (series/movies) to add to your library.

> **Service Compatibility:** Works with both Sonarr and Radarr instances.
> - **Sonarr**: Returns TVDB IDs in the `foreignId` field
> - **Radarr**: Returns TMDB IDs in the `foreignId` field

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
    "total": 3,
    "results": [
      {
        "id": 81189,
        "foreignId": 81189,
        "title": "Breaking Bad",
        "year": 2008,
        "overview": "High school chemistry teacher...",
        "mediaKind": "series",
        "imdbId": "tt0903747"
      }
    ],
    "truncated": false
  }
}
```

**Parameters:**
- `service` (required): Service instance name
- `query` (required): Search term
- `limit` (optional): Maximum results to return

**Radarr Example:**
```json
// Input
{"service": "radarr-main", "query": "The Matrix", "limit": 5}

// Output
{
  "ok": true,
  "data": {
    "service": "radarr-main",
    "mediaKind": "movie",
    "total": 5,
    "results": [
      {
        "id": 603,
        "foreignId": 603,
        "title": "The Matrix",
        "year": 1999,
        "overview": "Set in the 22nd century...",
        "mediaKind": "movie",
        "imdbId": "tt0133093"
      }
    ],
    "truncated": false
  }
}
```

### add_new

Add new media (series/movies) to your library with intelligent quality profile selection.

> **Service Compatibility:** Works with both Sonarr and Radarr instances.
> - **Sonarr**: Requires `foreignId` as TVDB ID, adds to series library
> - **Radarr**: Requires `foreignId` as TMDB ID, adds to movie library

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

### quality_profiles

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

### history_detail

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
        "title": "Sample Series S01E01",
        "quality": "HDTV-1080p",
        "eventType": "grabbed",
        "date": "2024-01-15T10:00:00Z",
        "mediaKind": "series"
      }
    ],
    "truncated": false
  }
}
```

**Parameters:**
- `service` (required): Service instance name
- `page` (optional): Page number for pagination (default: 1)
- `pageSize` (optional): Items per page (default: 10)
- `since` (optional): Only show history after this date (ISO format)

### import_issues

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
    "issues": [
      {
        "id": 123,
        "title": "Sample Series S01E01",
        "reason": "Missing episode",
        "ageMinutes": 0
      }
    ],
    "summary": {
      "total": 5,
      "stuckPending": 1,
      "failedImport": 0
    }
  }
}
```

## Diagnostics & Monitoring

### queue_diagnostics

Analyze and automatically fix stuck queue items for a specific service.

**Input:**
```json
{
  "service": "sonarr-main",
  "autoFix": false
}
```

Set `autoFix:false` for read-only diagnostics. If omitted, `autoFix` defaults to true and can trigger write operations for auto-fixable issues.

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

**Where Messages Come From:**
- Flix-Bridge inspects Sonarr’s queue payload (`status`, `errorMessage`, and `statusMessages[].message`). That is why many diagnostics read “Manual investigation required” or “Automatic import is not possible.”
- Manual import attempts are executed using the Sonarr/Radarr UI-equivalent endpoint (`POST /api/v3/command`, `name: "ManualImport"`, `importMode: "auto"`) when candidates are available from `GET /manualimport`. If a manual-import POST returns success but the queue item remains present, Flix-Bridge treats that as unsuccessful and retries with an explicit queue-state check.
- If Sonarr returns no manual-import candidates (common with torrent downloads), the diagnostic will state “Manual import unavailable: no candidates returned.” At that point the download can be removed safely, but you may choose to keep the payload for manual processing.

### all_services_diagnostics

Run queue diagnostics across all configured services simultaneously.

Use `autoFix:false` for read-only production checks. The default is true.

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

### download_status

Get unified download status across multiple services and download clients.

**Input:**
```json
{
  "services": ["sonarr-main", "radarr-main"],
  "includeDownloader": true,
  "downloader": "sabnzbd-main"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "services": ["sonarr-main", "radarr-main"],
    "totals": {
      "queued": 8,
      "downloading": 5,
      "completedPendingImport": 1
    },
    "serviceResults": [
      {
        "service": "sonarr-main",
        "mediaKind": "series",
        "total": 3,
        "downloading": 2,
        "pending": 1
      }
    ],
    "downloader": {
      "service": "sabnzbd-main",
      "name": "SABnzbd",
      "version": "4.3.0",
      "isHealthy": true,
      "paused": false,
      "totalSlots": 5,
      "speedKBps": 15564,
      "totalSizeMB": 12000,
      "remainingSizeMB": 8000,
      "items": 5
    },
    "correlationRatio": 1
  }
}
```

**Parameters:**
- `services` (optional): Array of service names to include
- `includeDownloader` (optional): Whether to include download client status
- `downloader` (optional): Download client name (if includeDownloader is true)

### server_metrics

Get local server operation metrics and health status.

**Input:**
```json
{
  "detailed": true
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "uptime": 123456,
    "totalRequests": 42,
    "successRate": 100,
    "averageResponseTime": 120,
    "serviceCount": 2,
    "topErrors": [],
    "health": {
      "status": "healthy",
      "issues": [],
      "recentFailureRate": 0
    },
    "recentOperations": []
  }
}
```

**Parameters:**
- `service` (optional): Return metrics for one service if metrics exist
- `detailed` (optional): Include recent operations and exported metrics

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
