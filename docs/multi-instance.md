# Multi-Instance Configuration

> **📖 Flix-Bridge Documentation**  
> [← API Reference](api-reference.md) | [Next: Troubleshooting →](troubleshooting.md)

Advanced guide to configuring and managing multiple service instances with Flix-Bridge.

## Overview

Flix-Bridge supports multiple instances of the same service type, enabling sophisticated media management setups. This guide covers common patterns, configuration strategies, and best practices.

## Service Detection Rules

**Important**: Service names must contain specific keywords for automatic detection:

- Names containing **"sonarr"** → treated as TV series management instances
- Names containing **"radarr"** → treated as movie management instances

✅ **Valid Examples:**
- `sonarr-main`, `sonarr-4k`, `sonarr-anime`
- `radarr-hd`, `radarr-uhd`, `radarr-kids`

❌ **Invalid Examples:**
- `tv-manager`, `movie-server` (won't be detected)
- `series-handler`, `film-processor` (no keyword match)

## Common Multi-Instance Patterns

### 1. Quality-Based Separation

Separate instances for different quality tiers to optimize storage and performance.

```json
{
  "services": {
    "sonarr-main": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "your-main-sonarr-api-key",
      "description": "Main Sonarr for 1080p TV shows"
    },
    "sonarr-4k": {
      "baseUrl": "http://localhost:8990",
      "apiKey": "your-4k-sonarr-api-key",
      "description": "4K Sonarr for UHD TV shows"
    },
    "radarr-hd": {
      "baseUrl": "http://localhost:7878",
      "apiKey": "your-hd-radarr-api-key",
      "description": "HD Radarr for 1080p movies"
    },
    "radarr-uhd": {
      "baseUrl": "http://localhost:7879",
      "apiKey": "your-uhd-radarr-api-key",
      "description": "UHD Radarr for 4K movies"
    }
  }
}
```

**Benefits:**
- Separate quality profiles and storage locations
- Independent upgrade policies
- Optimized indexer configurations per quality tier
- Isolated performance and resource usage

**Usage Examples:**
```
Show me the queue for sonarr-4k

Add "Breaking Bad" to sonarr-main

Check storage for both radarr-hd and radarr-uhd
```

### 2. Content-Type Separation

Different instances for specific content categories.

```json
{
  "services": {
    "sonarr-general": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "your-general-key"
    },
    "sonarr-anime": {
      "baseUrl": "http://localhost:8991",
      "apiKey": "your-anime-key"
    },
    "sonarr-kids": {
      "baseUrl": "http://localhost:8992",
      "apiKey": "your-kids-key"
    },
    "radarr-mainstream": {
      "baseUrl": "http://localhost:7878",
      "apiKey": "your-mainstream-key"
    },
    "radarr-foreign": {
      "baseUrl": "http://localhost:7880",
      "apiKey": "your-foreign-key"
    }
  }
}
```

**Benefits:**
- Specialized metadata sources for anime/foreign content
- Content-appropriate quality profiles
- Family-friendly filtering and organization
- Targeted indexer configurations

### 3. Environment Separation

Separate instances for different environments or purposes.

```json
{
  "services": {
    "sonarr-prod": {
      "baseUrl": "http://production:8989",
      "apiKey": "production-key"
    },
    "sonarr-test": {
      "baseUrl": "http://testing:8989",
      "apiKey": "testing-key"
    },
    "sonarr-dev": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "development-key"
    }
  }
}
```

**Benefits:**
- Safe testing of configurations and updates
- Development environment for automation testing
- Production isolation and stability

### 4. Geographic/Network Separation

Different instances for different locations or network segments.

```json
{
  "services": {
    "sonarr-local": {
      "baseUrl": "http://local-server:8989",
      "apiKey": "local-key"
    },
    "sonarr-remote": {
      "baseUrl": "http://remote-server:8989",
      "apiKey": "remote-key"
    },
    "sonarr-cloud": {
      "baseUrl": "https://cloud-instance:8989",
      "apiKey": "cloud-key"
    }
  }
}
```

**Benefits:**
- Distributed content management
- Regional content preferences
- Network optimization and redundancy

## Quality Profile Intelligence

Flix-Bridge automatically selects appropriate quality profiles based on service names when adding new media.

### Automatic Profile Selection

```javascript
// Service name → Preferred quality profile
"sonarr-4k"      → prefers 4K/UHD profiles
"sonarr-uhd"     → prefers 4K/UHD profiles  
"radarr-2160"    → prefers 4K/2160p profiles
"sonarr-hd"      → prefers HD/1080p profiles
"radarr-1080"    → prefers 1080p profiles
"sonarr-anime"   → prefers anime-specific profiles
```

### Manual Override

You can always specify quality profiles explicitly:

```json
{
  "service": "sonarr-4k",
  "title": "Sample Series",
  "foreignId": 123456,
  "qualityProfileId": 3
}
```

To see available profiles:
```
Show me quality profiles for sonarr-4k
```

## Advanced Multi-Instance Workflows

### Cross-Instance Diagnostics

Run diagnostics across all services:

```
Run diagnostics on all my services and show me a summary

Check for stuck downloads across sonarr-main, sonarr-4k, and sonarr-anime
```

### Unified Monitoring

Monitor multiple instances together:

```
Show me download status across sonarr-main, sonarr-4k, and radarr-hd

Check system status for all my anime and kids services

What's the storage situation across all my instances?
```

### Instance-Specific Operations

Target specific instances for focused operations:

```
Force grab downloads in radarr-4k queue

Search for "Spirited Away" in radarr-foreign

Add "Demon Slayer" to sonarr-anime with monitoring enabled
```

## Downloader Integration

Multiple service instances can share download clients:

```json
{
  "services": {
    "sonarr-hd": {"baseUrl": "...", "apiKey": "..."},
    "sonarr-4k": {"baseUrl": "...", "apiKey": "..."},
    "radarr-main": {"baseUrl": "...", "apiKey": "..."}
  },
  "downloaders": {
    "sabnzbd-main": {
      "baseUrl": "http://localhost:8080",
      "apiKey": "your-sabnzbd-key",
      "name": "Main SABnzbd"
    },
    "sabnzbd-4k": {
      "baseUrl": "http://localhost:8081",
      "apiKey": "your-4k-sabnzbd-key",
      "name": "4K SABnzbd"
    }
  }
}
```

## Best Practices

### 1. Consistent Naming

Use clear, descriptive naming patterns:

```json
// Good: Indicates quality and content type
"sonarr-4k", "sonarr-hd-anime", "radarr-uhd-movies"

// Better: More specific
"sonarr-4k-series", "sonarr-1080p-anime", "radarr-2160p-films"
```

### 2. Configuration Management

Keep configurations synchronized:

- Use consistent root folder structures
- Align quality profile names across instances
- Standardize indexer configurations
- Document instance purposes and responsibilities

### 3. Storage Planning

Plan storage allocation carefully:

```json
{
  "sonarr-hd": {
    "root_folders": ["/media/tv-hd"],
    "estimated_storage": "4TB"
  },
  "sonarr-4k": {
    "root_folders": ["/media/tv-4k"],
    "estimated_storage": "12TB"
  }
}
```

### 4. Performance Monitoring

Monitor resource usage across instances:

```
Check system status for all instances

Show me storage usage across sonarr-main, sonarr-4k, and sonarr-anime

Run diagnostics to check for performance issues
```

### 5. Backup and Recovery

Implement consistent backup strategies:

- Database backups for each instance
- Configuration file synchronization
- Metadata export and import procedures
- Disaster recovery testing

## Troubleshooting Multi-Instance Setups

### Common Issues

1. **Service Not Found**
   - Verify exact service name in config matches tool calls
   - Check that service name contains "sonarr" or "radarr"
   - Confirm service is properly registered

2. **Wrong Instance Responding**
   - Each response includes a "service" field showing which instance responded
   - Use exact service names from your configuration
   - Verify network connectivity to the intended instance

3. **Configuration Conflicts**
   - Check for port conflicts between instances
   - Verify unique API keys for each instance
   - Ensure separate database files and directories

### Debug Multi-Instance Issues

Enable debug logging to trace instance detection:

```bash
FLIX_BRIDGE_DEBUG=1 npm run dev
```

This shows:
- Which services were detected during startup
- Service type detection logic
- Configuration loading for each instance
- HTTP requests to specific instances

### Testing Specific Instances

Test individual instances:

```bash
# Modify config.json to test one service at a time
# Run smoke tests for validation
npm run smoke
```

## Migration Strategies

### Splitting Single Instance

When migrating from single to multi-instance setup:

1. **Export existing data** from current instance
2. **Set up new instances** with appropriate configurations
3. **Import data** to target instances based on quality/content rules
4. **Update automation** to use new instance names
5. **Test thoroughly** before decommissioning old instance

### Consolidating Instances

When merging instances:

1. **Export metadata** from source instances
2. **Merge quality profiles** on target instance
3. **Consolidate root folders** or maintain separate paths
4. **Import content** with appropriate quality mappings
5. **Update references** to use consolidated instance names

---

**Next Steps:**
- **[Troubleshooting →](troubleshooting.md)** - Common issues and solutions
- **[Architecture →](architecture.md)** - Technical architecture and extension guide

---
*Part of the [Flix-Bridge](../README.md) documentation*
