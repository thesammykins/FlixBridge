# Configuration Guide

> **📖 Flix-Bridge Documentation**  
> [← Installation](installation.md) | [Next: Usage →](usage.md)

Comprehensive guide to configuring Flix-Bridge for your environment.

## Overview

Flix-Bridge v0.3.x uses environment-only configuration with slug-based discovery, tried in this order:

1. Slug-based Environment Variables: `SONARR_<SLUG>_URL`, `RADARR_<SLUG>_URL`, etc.
2. Single-instance fallback: `SONARR_URL`, `RADARR_URL`, etc.

No file-based configuration or JSON mapping is required.

## Method 1: Slug-based Environment Variables (Recommended)

Define multiple instances using slug-based patterns. Each service type uses a pattern like `<SERVICE>_<SLUG>_<FIELD>`:

### Basic Slug Configuration

```bash
# Sonarr instances
export SONARR_MAIN_URL="http://localhost:8989"
export SONARR_MAIN_API_KEY="your-main-sonarr-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="your-4k-sonarr-key"

# Radarr instances
export RADARR_HD_URL="http://localhost:7878"
export RADARR_HD_API_KEY="your-hd-radarr-key"
export RADARR_UHD_URL="http://localhost:7879"
export RADARR_UHD_API_KEY="your-uhd-radarr-key"

# SABnzbd downloaders (optional)
export SABNZBD_MAIN_URL="http://localhost:8080"
export SABNZBD_MAIN_API_KEY="your-sabnzbd-key"
export SABNZBD_MAIN_NAME="SABnzbd Main"
```

### Service Naming Rules

- Service names are derived as `<service>-<slug>` (slug lowercased, `_` → `-`)
- `SONARR_MAIN_URL` → service name: `sonarr-main`
- `RADARR_4K_URL` → service name: `radarr-4k`
- `SABNZBD_MAIN_URL` → downloader name: `sabnzbd-main`

### Custom Service Names

Override the derived name with the `_NAME` variable:

```bash
export SONARR_ANIME_URL="http://localhost:8991"
export SONARR_ANIME_API_KEY="your-anime-key"
export SONARR_ANIME_NAME="sonarr-japanese-content"  # Custom name
```

**Important**: Custom names must still contain "sonarr" or "radarr" for proper service detection.

## Method 2: Single-Instance Fallback

For simple setups with one instance of each service, use these standard variables:

```bash
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-sonarr-api-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="your-radarr-api-key"
export SABNZBD_URL="http://localhost:8080"
export SABNZBD_API_KEY="your-sabnzbd-api-key"
```

## Service Naming Rules

Important: Service names must contain keywords for proper detection:

- Names containing "sonarr" → TV series management instances
- Names containing "radarr" → Movie management instances

Examples:
- `sonarr-main`, `sonarr-4k`, `sonarr-anime` ✅
- `radarr-hd`, `radarr-uhd`, `radarr-kids` ✅
- `tv-manager`, `movie-server` ❌ (won't be detected)

## Common Use Cases

### Simple Local Development

Use single-instance fallback variables:

```bash
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="development-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="development-key"
```

### Docker Compose

```yaml
services:
  flix-bridge:
    image: flix-bridge
    environment:
      # Single instance setup
      - SONARR_URL=http://sonarr:8989
      - SONARR_API_KEY=${SONARR_API_KEY}
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=${RADARR_API_KEY}
      # Or multi-instance setup
      - SONARR_HD_URL=http://sonarr-hd:8989
      - SONARR_HD_API_KEY=${SONARR_HD_KEY}
      - SONARR_4K_URL=http://sonarr-4k:8990
      - SONARR_4K_API_KEY=${SONARR_4K_KEY}
```

### Multi-Instance Setup

Use slug-based variables for multiple service instances:

```bash
# Multiple quality tiers
export SONARR_HD_URL="http://sonarr-hd:8989"
export SONARR_HD_API_KEY="hd-key"
export SONARR_4K_URL="http://sonarr-4k:8990"
export SONARR_4K_API_KEY="4k-key"

# Multiple content types
export SONARR_ANIME_URL="http://sonarr-anime:8991"
export SONARR_ANIME_API_KEY="anime-key"
export RADARR_KIDS_URL="http://radarr-kids:7879"
export RADARR_KIDS_API_KEY="kids-key"
```

## Troubleshooting Configuration

### Configuration Not Loading

1. Ensure environment variables follow the correct pattern: `<SERVICE>_<SLUG>_<FIELD>`
2. For single instances, use: `SONARR_URL`, `RADARR_URL`, `SABNZBD_URL`
3. Check that both URL and API_KEY are set for each service
4. Verify slugs use only uppercase letters, numbers, and underscores

### Service Connection Issues

1. Verify base URLs are accessible
2. Test API keys manually:
   ```bash
   curl -H "X-Api-Key: your-api-key" http://localhost:8989/api/v3/system/status
   ```
3. Check for trailing slashes in URLs (they're automatically removed)

### Debug Configuration Loading

Enable debug logging to see service discovery:

```bash
export FLIX_BRIDGE_DEBUG=1
npm run dev
```

You'll see output like:
```
[Config] Discovered Sonarr service: sonarr-hd (slug: HD)
[Config] Discovered Radarr service: radarr-uhd (slug: UHD)
[Config] Total discovered services: 2
```

---

**Next Steps:**
- **[Usage →](usage.md)** - Set up MCP clients and start using Flix-Bridge
- **[Multi-Instance →](multi-instance.md)** - Advanced multi-instance configurations
- **[Troubleshooting →](troubleshooting.md)** - Common issues and solutions

---
*Part of the [Flix-Bridge](../README.md) documentation*
