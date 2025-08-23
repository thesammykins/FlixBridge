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

```bash
# Sonarr instances for different quality tiers
export SONARR_MAIN_URL="http://localhost:8989"
export SONARR_MAIN_API_KEY="your-main-sonarr-api-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="your-4k-sonarr-api-key"

# Radarr instances for different quality tiers
export RADARR_HD_URL="http://localhost:7878"
export RADARR_HD_API_KEY="your-hd-radarr-api-key"
export RADARR_UHD_URL="http://localhost:7879"
export RADARR_UHD_API_KEY="your-uhd-radarr-api-key"

# Service names: sonarr-main, sonarr-4k, radarr-hd, radarr-uhd
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

```bash
# Content-specific Sonarr instances
export SONARR_GENERAL_URL="http://localhost:8989"
export SONARR_GENERAL_API_KEY="your-general-key"
export SONARR_ANIME_URL="http://localhost:8991"
export SONARR_ANIME_API_KEY="your-anime-key"
export SONARR_KIDS_URL="http://localhost:8992"
export SONARR_KIDS_API_KEY="your-kids-key"

# Content-specific Radarr instances
export RADARR_MAINSTREAM_URL="http://localhost:7878"
export RADARR_MAINSTREAM_API_KEY="your-mainstream-key"
export RADARR_FOREIGN_URL="http://localhost:7880"
export RADARR_FOREIGN_API_KEY="your-foreign-key"

# Service names: sonarr-general, sonarr-anime, sonarr-kids, radarr-mainstream, radarr-foreign
```

**Benefits:**
- Specialized metadata sources for anime/foreign content
- Content-appropriate quality profiles
- Family-friendly filtering and organization
- Targeted indexer configurations

### 3. Environment Separation

Separate instances for different environments or purposes.

```bash
# Environment-specific instances
export SONARR_PROD_URL="http://production:8989"
export SONARR_PROD_API_KEY="production-key"
export SONARR_TEST_URL="http://testing:8989"
export SONARR_TEST_API_KEY="testing-key"
export SONARR_DEV_URL="http://localhost:8989"
export SONARR_DEV_API_KEY="development-key"

# Service names: sonarr-prod, sonarr-test, sonarr-dev
```

**Benefits:**
- Safe testing of configurations and updates
- Development environment for automation testing
- Production isolation and stability

### 4. Geographic/Network Separation

Different instances for different locations or network segments.

```bash
# Geographic/network separation
export SONARR_LOCAL_URL="http://local-server:8989"
export SONARR_LOCAL_API_KEY="local-key"
export SONARR_REMOTE_URL="http://remote-server:8989"
export SONARR_REMOTE_API_KEY="remote-key"
export SONARR_CLOUD_URL="https://cloud-instance:8989"
export SONARR_CLOUD_API_KEY="cloud-key"

# Service names: sonarr-local, sonarr-remote, sonarr-cloud
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

```bash
# Multiple arr services
export SONARR_HD_URL="http://localhost:8989"
export SONARR_HD_API_KEY="your-hd-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="your-4k-key"
export RADARR_MAIN_URL="http://localhost:7878"
export RADARR_MAIN_API_KEY="your-radarr-key"

# Multiple downloaders
export SABNZBD_MAIN_URL="http://localhost:8080"
export SABNZBD_MAIN_API_KEY="your-sabnzbd-key"
export SABNZBD_MAIN_NAME="Main SABnzbd"
export SABNZBD_4K_URL="http://localhost:8081"
export SABNZBD_4K_API_KEY="your-4k-sabnzbd-key"
export SABNZBD_4K_NAME="4K SABnzbd"

# Service names: sonarr-hd, sonarr-4k, radarr-main, sabnzbd-main, sabnzbd-4k
```

## Best Practices

### 1. Consistent Naming

Use clear, descriptive naming patterns:

```bash
# Good: Indicates quality and content type
SONARR_4K_*, SONARR_HD_ANIME_*, RADARR_UHD_*

# Better: More specific
SONARR_4K_SERIES_*, SONARR_1080P_ANIME_*, RADARR_2160P_*
```

### 2. Configuration Management

Keep configurations synchronized:

- Use consistent root folder structures
- Align quality profile names across instances
- Standardize indexer configurations
- Document instance purposes and responsibilities

### 3. Storage Planning

Plan storage allocation carefully:

```bash
# Plan storage allocation per instance
# sonarr-hd: /media/tv-hd (4TB)
# sonarr-4k: /media/tv-4k (12TB)
# radarr-main: /media/movies (8TB)
# radarr-uhd: /media/movies-4k (16TB)
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
   - Use exact service names (derived from slug: `SONARR_HD_*` → `sonarr-hd`)
   - Verify network connectivity to the intended instance

3. **Configuration Conflicts**
   - Check for port conflicts between instances (each needs unique ports)
   - Verify unique API keys for each instance (don't reuse keys)
   - Ensure separate database files and directories (different paths)

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
# Test individual instances with slug-based vars
SONARR_MAIN_URL=http://localhost:8989 SONARR_MAIN_API_KEY=... npm run smoke

# Or single-instance fallback
SONARR_URL=http://localhost:8989 SONARR_API_KEY=... npm run smoke
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
