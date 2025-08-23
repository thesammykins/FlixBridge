# FlixBridge Configuration Examples

This directory contains configuration examples for FlixBridge using the new slug-based environment variable system.

## Overview

FlixBridge v0.3.0+ uses a simplified, environment-only configuration system that eliminates JSON files and mapping configurations. All services are discovered automatically from environment variables using a slug-based naming convention.

## Configuration Methods

### 1. Slug-Based Configuration (Recommended)

The slug-based system allows you to configure multiple instances of each service type using environment variable patterns:

**Pattern**: `<SERVICE>_<SLUG>_<FIELD>`

- **SERVICE**: `SONARR`, `RADARR`, or `SABNZBD`
- **SLUG**: A unique identifier (e.g., `MAIN`, `4K`, `ANIME`, `UHD`)
- **FIELD**: `URL`, `API_KEY`, or `NAME` (optional)

**Examples**:
```bash
# Sonarr instances
SONARR_MAIN_URL=http://localhost:8989
SONARR_MAIN_API_KEY=abc123...
SONARR_4K_URL=http://localhost:8990
SONARR_4K_API_KEY=def456...

# Radarr instances
RADARR_MAIN_URL=http://localhost:7878
RADARR_MAIN_API_KEY=ghi789...
RADARR_UHD_URL=http://localhost:7879
RADARR_UHD_API_KEY=jkl012...

# SABnzbd instances
SABNZBD_MAIN_URL=http://localhost:8080
SABNZBD_MAIN_API_KEY=mno345...
```

### 2. Single Instance Fallback

For simple setups with one instance per service:

```bash
SONARR_URL=http://localhost:8989
SONARR_API_KEY=your-api-key
RADARR_URL=http://localhost:7878
RADARR_API_KEY=your-api-key
SABNZBD_URL=http://localhost:8080
SABNZBD_API_KEY=your-api-key
```

## Service Name Derivation

Service names are automatically derived from slugs:

| Environment Variables | Derived Service Name |
|----------------------|---------------------|
| `SONARR_MAIN_*` | `sonarr-main` |
| `SONARR_4K_*` | `sonarr-4k` |
| `RADARR_UHD_*` | `radarr-uhd` |
| `SABNZBD_ANIME_*` | `sabnzbd-anime` |

### Custom Service Names

Override the derived name using the `NAME` field:

```bash
SONARR_ANIME_URL=http://localhost:8991
SONARR_ANIME_API_KEY=your-key
SONARR_ANIME_NAME=sonarr-anime-special
```

**Important**: Service names must contain `sonarr` or `radarr` for proper type detection by the current registry system.

## Configuration Files

### For Claude Desktop

Use one of these MCP configuration files:

- [`claude-mcp-config.json`](./claude-mcp-config.json) - Multi-instance setup
- [`claude-mcp-config-simple.json`](./claude-mcp-config-simple.json) - Single instance setup

Copy the contents to your Claude Desktop MCP configuration file (usually `~/.claude/config.json` or similar).

### Environment Variables

- [`.env.example`](./.env.example) - Complete environment variable reference

Copy to `.env` in your project root and update with your actual URLs and API keys.

## Usage Examples

Once configured, use the derived service names in your MCP tool calls:

```json
{
  "tool": "system_status",
  "arguments": {
    "service": "sonarr-main"
  }
}
```

```json
{
  "tool": "queue_list",
  "arguments": {
    "service": "radarr-uhd"
  }
}
```

```json
{
  "tool": "download_status",
  "arguments": {
    "services": ["sonarr-4k", "radarr-uhd"],
    "includeDownloader": true,
    "downloader": "sabnzbd-main"
  }
}
```

## Migration from v0.2.x

If you're upgrading from FlixBridge v0.2.x or earlier:

1. **Remove old configuration files**: `config.json`, `env-mapping.json`
2. **Remove environment variables**: `FLIX_BRIDGE_ENV_MAPPING`
3. **Convert to slug-based format**: Use the patterns above

### Migration Example

**Old (v0.2.x)**:
```json
{
  "services": {
    "sonarr-hd": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "abc123"
    },
    "radarr-4k": {
      "baseUrl": "http://localhost:7878",
      "apiKey": "def456"
    }
  }
}
```

**New (v0.3.x)**:
```bash
SONARR_HD_URL=http://localhost:8989
SONARR_HD_API_KEY=abc123
RADARR_4K_URL=http://localhost:7878
RADARR_4K_API_KEY=def456
```

## Debugging

Enable debug logging to see service discovery:

```bash
FLIX_BRIDGE_DEBUG=1
```

This will show:
- Discovered slugs and service names
- Configuration validation warnings
- Service registration logs

## Validation Rules

- Both `URL` and `API_KEY` must be present for a service to be registered
- Incomplete slugs (missing URL or API key) are skipped silently
- URLs are normalized (trailing slashes removed)
- Service names containing `sonarr` or `radarr` are required for type detection

## Troubleshooting

### No Services Configured Error

```
No services configured. Provide slug-based env vars (SONARR_<SLUG>_URL/API_KEY, RADARR_<SLUG>_URL/API_KEY) or single-instance fallbacks (SONARR_URL/API_KEY, RADARR_URL/API_KEY).
```

**Solution**: Ensure you have at least one complete service configuration with both URL and API_KEY.

### Service Name Type Detection Warning

```
Warning: Service name 'my-service' does not contain 'sonarr' or 'radarr'. Current registry requires this for type detection.
```

**Solution**: Ensure custom service names (via `NAME` override) contain the appropriate keyword.

### Service Not Found

```
Unknown service: my-service. Available services: sonarr-main, radarr-uhd
```

**Solution**: Use the exact service names shown in the error message. Check debug logs to see discovered service names.

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use environment files** (`.env`) that are gitignored
3. **Restrict API key permissions** in your *arr applications
4. **Use HTTPS URLs** when accessing services over networks
5. **Validate URLs** before deployment

## Support

For issues with configuration:
1. Enable `FLIX_BRIDGE_DEBUG=1` to see discovery logs
2. Check that your environment variables follow the exact pattern
3. Verify API keys are correct and have appropriate permissions
4. Ensure services are accessible from the FlixBridge host