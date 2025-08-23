# RULE.md

Concise guidance for LLMs using the Flix-Bridge MCP server for Sonarr/Radarr media management.

## Essential Workflow

**ALWAYS start with `list_services`** - This discovers available services and downloaders before using any other tools.

```json
{"tool": "list_services", "arguments": {}}
```

All other tools require a valid `service` parameter from the `list_services` response.

## Core Operations

### Status & Monitoring
- `system_status` - Health check and version info
- `queue_list` - Download queue with progress/status
- `root_folders` - Storage locations and free space

### Queue Management
- `queue_grab` - Force grab/retry items (single ID or bulk with `ids` array)
- `queue_diagnostics` - Auto-detect and fix common queue issues

### Content Management
- `search` - Find new content to add (requires `query` parameter)
- `add_new` - Add content to library (requires `title`, `foreignId`, optional `monitored`)
- `quality_profiles` - List available quality configurations
- `history_detail` - Recent download/import history

### Advanced Diagnostics
- `all_services_diagnostics` - Run diagnostics across all services
- `download_status` - Unified status across arr services and downloaders
- `server_metrics` - Performance and health assessment

## Service Types & Multi-Instance

Services are auto-detected by name:
- Names containing "sonarr" → TV series management
- Names containing "radarr" → Movie management
- Downloaders (SABnzbd) → Download client monitoring

Common multi-instance patterns:
- Quality tiers: `sonarr-main`, `sonarr-4k`, `radarr-uhd`
- Content types: `sonarr-anime`, `radarr-foreign`
- Environments: `sonarr-prod`, `sonarr-test`

## Response Format

All tools return consistent structure:
```json
{
  "ok": boolean,
  "data": {
    "service": "service-name",
    "mediaKind": "series|movie",
    // ... operation-specific fields
  },
  "error": {
    "service": "service-name",
    "status": number,
    "message": "description"
  }
}
```

## Common Usage Patterns

### Check System Health
```json
{"tool": "system_status", "arguments": {"service": "sonarr-main"}}
```

### Monitor Download Queue
```json
{"tool": "queue_list", "arguments": {"service": "radarr-4k", "pageSize": 25}}
```

### Force Download Retry
```json
{"tool": "queue_grab", "arguments": {"service": "sonarr-main", "ids": [123, 456]}}
```

### Search for New Content
```json
{"tool": "search", "arguments": {"service": "radarr-main", "query": "Inception", "limit": 5}}
```

### Add Content to Library
```json
{"tool": "add_new", "arguments": {"service": "sonarr-main", "title": "Breaking Bad", "foreignId": 81189, "monitored": true}}
```

### Run Diagnostics
```json
{"tool": "queue_diagnostics", "arguments": {"service": "sonarr-main"}}
```

### Get Unified Download Status
```json
{"tool": "download_status", "arguments": {"services": ["sonarr-main", "radarr-main"], "includeDownloader": true}}
```

## Error Handling

- **Service Not Found**: Verify service name from `list_services` response
- **API Connection Issues**: Check if service is accessible and API key is valid
- **Queue Issues**: Use `queue_diagnostics` for automatic problem detection
- **Import Problems**: Check `import_issues` for stuck downloads

## Key Constraints

- Always call `list_services` first to discover available services
- Service names must contain "sonarr" or "radarr" for proper type detection
- Use pagination (`pageSize` parameter) for large result sets
- Bulk operations (like `queue_grab` with multiple IDs) are preferred over individual calls
- All responses include `mediaKind` field to distinguish between TV series and movies

## Troubleshooting

1. **No services found**: Check configuration environment variables
2. **Authentication errors**: Verify API keys have proper permissions
3. **Timeout errors**: Service may be overloaded or unreachable
4. **Queue stuck**: Use `queue_diagnostics` for automated fixes
5. **Import failures**: Check `import_issues` for detailed problem analysis

## Performance Tips

- Use `pageSize` parameter to limit large responses
- Batch queue operations using `ids` array instead of individual calls
- Call `queue_diagnostics` before manual queue management
- Use `download_status` for unified monitoring across multiple services
- Check `server_metrics` for performance insights

## Configuration Context

Services are configured via environment variables:
- Single instance: `SONARR_URL`, `SONARR_API_KEY`
- Multi-instance: `SONARR_<SLUG>_URL`, `SONARR_<SLUG>_API_KEY`
- Same pattern for Radarr and SABnzbd

The `list_services` tool automatically discovers all configured instances regardless of configuration method.
