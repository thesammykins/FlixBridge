# Usage Guide

> **📖 Flix-Bridge Documentation**  
> [← Configuration](configuration.md) | [Next: API Reference →](api-reference.md)

Learn how to set up MCP clients and use Flix-Bridge effectively.

## MCP Client Configuration

### Claude Desktop Configuration

Add Flix-Bridge to your Claude Desktop `claude_desktop_config.json` file:

**Using Configuration File:**
```json
{
  "mcpServers": {
    "flix-bridge": {
      "command": "npx",
      "args": ["@thesammykins/flixbridge"],
      "env": {
        "FLIX_BRIDGE_CONFIG": "/path/to/your/config.json"
      }
    }
  }
}
```

**Using Environment Variables Directly:**
```json
{
  "mcpServers": {
    "flix-bridge": {
      "command": "npx",
      "args": ["@thesammykins/flixbridge"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-sonarr-api-key",
        "RADARR_URL": "http://localhost:7878", 
        "RADARR_API_KEY": "your-radarr-api-key",
        "SABNZBD_URL": "http://localhost:8080",
        "SABNZBD_API_KEY": "your-sabnzbd-api-key"
      }
    }
  }
}
```

**Development Mode Configuration:**
```json
{
  "mcpServers": {
    "flix-bridge-dev": {
      "command": "npx",
      "args": ["@thesammykins/flixbridge"],
      "env": {
        "FLIX_BRIDGE_CONFIG": "/path/to/your/config.json",
        "FLIX_BRIDGE_DEBUG": "1"
      }
    }
  }
}
```

### Quick Setup for Claude Desktop

1. **Install the package:**
   ```bash
   npm install -g @thesammykins/flixbridge
   ```

2. **Create your config file:**
   ```bash
   # Create config.json with your service details
   cat > config.json << 'EOF'
   {
     "services": {
       "sonarr": {
         "baseUrl": "http://localhost:8989",
         "apiKey": "your-sonarr-api-key"
       },
       "radarr": {
         "baseUrl": "http://localhost:7878",
         "apiKey": "your-radarr-api-key"
       }
     }
   }
   EOF
   ```

3. **Test the configuration:**
   ```bash
   FLIX_BRIDGE_CONFIG=./config.json npx @thesammykins/flixbridge --test
   ```

4. **Add to Claude Desktop config** (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)

5. **Restart Claude Desktop** and start using Flix-Bridge tools!

### Generic MCP Client Configuration

For other MCP-compatible applications:

```json
{
  "name": "flix-bridge",
  "description": "Media management MCP server for TV shows and movies",
  "command": "npx",
  "args": ["@thesammykins/flixbridge"],
  "env": {
    "FLIX_BRIDGE_CONFIG": "/path/to/your/config.json"
  },
  "capabilities": ["tools"],
  "tools": [
    "system_status",
    "queue_list", 
    "queue_grab",
    "root_folders",
    "history_detail",
    "search",
    "add_new",
    "import_issues",
    "quality_profiles",
    "queue_diagnostics",
    "all_services_diagnostics",
    "download_status",
    "server_metrics"
  ]
}
```

## Common Workflows

### 1. Check System Health

Monitor the status of your media management services:

```
Check the status of my TV series service

Show me the system status for radarr-4k

What's the health of all my services?
```

### 2. Monitor Download Queue

Keep track of your downloads:

```
Show me what's currently downloading

List the queue for sonarr-main with progress details

Check if there are any stuck downloads in radarr-4k
```

### 3. Manage Downloads

Control your download queue:

```
Force grab the download with ID 123 in sonarr

Retry all failed downloads in radarr-main

Fix any stuck items in my download queues
```

### 4. Search and Add New Media

Find and add new content to your library:

```
Search for "Breaking Bad" in sonarr-main

Add "The Dark Knight" to radarr-4k with monitoring enabled

Find anime series "Attack on Titan" and add it to sonarr-anime
```

### 5. Check Storage Space

Monitor your storage capacity:

```
Show me the storage status for all my root folders

How much free space is left on sonarr-4k?

Check the disk usage for my media libraries
```

### 6. Troubleshoot Issues

Diagnose and fix problems:

```
Run diagnostics on sonarr-main to find any issues

Check for import problems in radarr

Automatically fix any stuck downloads across all services
```

### 7. Review History

Check what's been downloaded recently:

```
Show me the recent history for sonarr-main

What movies were downloaded in the last 24 hours?

Check the download history for radarr-4k
```

## Working with Multiple Instances

### Quality-Based Separation

```
# Check 4K instance
Show me the queue for sonarr-4k

# Monitor HD instance  
What's the status of radarr-main?

# Compare storage
Show root folders for both sonarr-main and sonarr-4k
```

### Content-Type Separation

```
# Anime content
Check the queue for sonarr-anime

# Kids content
Show downloads for radarr-kids

# Foreign films
Monitor radarr-foreign status
```

### Advanced Multi-Instance Workflows

```
# Cross-instance diagnostics
Run diagnostics on all my services and show me a summary

# Unified download status
Show me download status across sonarr-main, sonarr-4k, and radarr-main

# Storage monitoring across instances
Check free space on all my root folders
```

## Best Practices

### 1. Service Naming

Use descriptive names that indicate purpose:
- `sonarr-4k`, `sonarr-hd`, `sonarr-anime`
- `radarr-main`, `radarr-uhd`, `radarr-kids`

### 2. Quality Profile Management

Always check available quality profiles before adding media:
```
Show me quality profiles for sonarr-4k

What quality options are available for radarr-main?
```

### 3. Regular Monitoring

Set up regular checks:
```
Check system status for all services

Run diagnostics weekly to catch issues early

Monitor storage space on all instances
```

### 4. Debug Mode

When troubleshooting, enable debug mode:
```bash
FLIX_BRIDGE_DEBUG=1 npm run dev
```

This provides detailed logging for:
- HTTP requests and responses
- Configuration loading
- Service detection
- Error diagnostics

## Error Handling

Flix-Bridge provides clear error messages for common issues:

- **Service not found**: Check your service name matches config exactly
- **API connection failed**: Verify base URL and API key
- **Permission denied**: Ensure API key has proper permissions
- **Timeout**: Check network connectivity to services

All errors include the specific service name and helpful context for troubleshooting.

## Performance Tips

### 1. Use Appropriate Page Sizes

For large queues, use pagination:
```
Show me the first 50 items in my download queue

List recent history with 25 items per page
```

### 2. Target Specific Instances

Be specific about which instance to query:
```
Check sonarr-main queue (faster than "check all queues")

Show radarr-4k status (faster than "show all status")
```

### 3. Enable Caching

Consider enabling response caching for frequently accessed data like quality profiles and root folders.

---

**Next Steps:**
- **[API Reference →](api-reference.md)** - Complete tool documentation with examples
- **[Multi-Instance →](multi-instance.md)** - Advanced multi-instance patterns
- **[Troubleshooting →](troubleshooting.md)** - Common issues and solutions

---
*Part of the [Flix-Bridge](../README.md) documentation*
