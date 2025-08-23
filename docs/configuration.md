# Configuration Guide

> **📖 Flix-Bridge Documentation**  
> [← Installation](installation.md) | [Next: Usage →](usage.md)

Comprehensive guide to configuring Flix-Bridge for your environment.

## Overview

Flix-Bridge supports three configuration methods, tried in this order:

1. **Configuration File** (recommended for most users)
2. **Custom Environment Variable Mapping** (for MCP hosts with custom env vars)
3. **Standard Environment Variables** (fallback option)

## Method 1: Configuration File

### Basic Setup

Create a `config.json` file:

```json
{
  "services": {
    "sonarr": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "your-sonarr-api-key-here"
    },
    "radarr": {
      "baseUrl": "http://localhost:7878",
      "apiKey": "your-radarr-api-key-here"
    }
  },
  "downloaders": {
    "sabnzbd": {
      "baseUrl": "http://localhost:8080",
      "apiKey": "your-sabnzbd-api-key-here",
      "name": "SABnzbd"
    }
  }
}
```

### Multi-Instance Setup

For multiple instances of the same service:

```json
{
  "services": {
    "sonarr-hd": {
      "baseUrl": "http://sonarr-hd:8989",
      "apiKey": "your-hd-api-key"
    },
    "sonarr-4k": {
      "baseUrl": "http://sonarr-4k:8989",
      "apiKey": "your-4k-api-key"
    },
    "radarr-main": {
      "baseUrl": "http://radarr-main:7878",
      "apiKey": "your-main-radarr-key"
    },
    "radarr-4k": {
      "baseUrl": "http://radarr-4k:7878",
      "apiKey": "your-4k-radarr-key"
    }
  }
}
```

### Custom Configuration Path

Use the `FLIX_BRIDGE_CONFIG` environment variable to specify a custom config file location:

```bash
export FLIX_BRIDGE_CONFIG=/path/to/your/custom-config.json
```

## Method 2: Custom Environment Variable Mapping

This method is useful when your MCP host provides environment variables with custom names that don't match the standard Flix-Bridge convention.

### How It Works

1. Create a mapping structure that tells Flix-Bridge which environment variables to use
2. Set the `FLIX_BRIDGE_ENV_MAPPING` environment variable with the JSON mapping
3. Set the actual configuration values in the mapped environment variables

### Mapping Structure

```json
{
  "services": {
    "sonarr": {
      "baseUrl": "ENV_VAR_NAME_FOR_SONARR_URL",
      "apiKey": "ENV_VAR_NAME_FOR_SONARR_KEY"
    },
    "radarr": {
      "baseUrl": "ENV_VAR_NAME_FOR_RADARR_URL",
      "apiKey": "ENV_VAR_NAME_FOR_RADARR_KEY"
    }
  },
  "downloaders": {
    "sabnzbd": {
      "baseUrl": "ENV_VAR_NAME_FOR_SABNZBD_URL",
      "apiKey": "ENV_VAR_NAME_FOR_SABNZBD_KEY",
      "name": "ENV_VAR_NAME_FOR_SABNZBD_NAME"
    }
  }
}
```

### Example Setup

```bash
# Set the mapping (compact JSON)
export FLIX_BRIDGE_ENV_MAPPING='{"services":{"sonarr":{"baseUrl":"MCP_SONARR_BASE_URL","apiKey":"MCP_SONARR_API_KEY"},"radarr":{"baseUrl":"MCP_RADARR_BASE_URL","apiKey":"MCP_RADARR_API_KEY"}}}'

# Set the actual configuration values
export MCP_SONARR_BASE_URL="http://localhost:8989"
export MCP_SONARR_API_KEY="your-sonarr-api-key"
export MCP_RADARR_BASE_URL="http://localhost:7878"
export MCP_RADARR_API_KEY="your-radarr-api-key"
```

### MCP Configuration Example

In your MCP server configuration:

```json
{
  "mcpServers": {
    "flix-bridge": {
      "command": "npx",
      "args": ["@thesammykins/flixbridge"],
      "env": {
        "FLIX_BRIDGE_ENV_MAPPING": "{\"services\":{\"sonarr\":{\"baseUrl\":\"CUSTOM_SONARR_URL\",\"apiKey\":\"CUSTOM_SONARR_KEY\"},\"radarr\":{\"baseUrl\":\"CUSTOM_RADARR_URL\",\"apiKey\":\"CUSTOM_RADARR_KEY\"}}}",
        "CUSTOM_SONARR_URL": "http://localhost:8989",
        "CUSTOM_SONARR_KEY": "your-sonarr-api-key",
        "CUSTOM_RADARR_URL": "http://localhost:7878",
        "CUSTOM_RADARR_KEY": "your-radarr-api-key"
      }
    }
  }
}
```

## Method 3: Standard Environment Variables

If no config file exists and no custom mapping is provided, Flix-Bridge falls back to these standard environment variables:

```bash
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-sonarr-api-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="your-radarr-api-key"
export SABNZBD_URL="http://localhost:8080"
export SABNZBD_API_KEY="your-sabnzbd-api-key"
```

## Configuration Priority

The configuration methods are tried in this order:

1. **Config file** (specified by `FLIX_BRIDGE_CONFIG` or default `config.json`)
2. **Custom env mapping** (if `FLIX_BRIDGE_ENV_MAPPING` is set)
3. **Standard env variables** (fallback)

## Service Naming Rules

**Important**: Service names must contain specific keywords for proper detection:

- Names containing **"sonarr"** → treated as TV series management instances
- Names containing **"radarr"** → treated as movie management instances

Examples:
- `sonarr-main`, `sonarr-4k`, `sonarr-anime` ✅
- `radarr-hd`, `radarr-uhd`, `radarr-kids` ✅
- `tv-manager`, `movie-server` ❌ (won't be detected)

## Common Use Cases

### Use Case 1: Simple Local Development

Use a config file:

```json
{
  "services": {
    "sonarr": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "development-key"
    }
  }
}
```

### Use Case 2: Docker Compose

Use standard environment variables:

```yaml
services:
  flix-bridge:
    image: flix-bridge
    environment:
      - SONARR_URL=http://sonarr:8989
      - SONARR_API_KEY=${SONARR_API_KEY}
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=${RADARR_API_KEY}
```

### Use Case 3: MCP Host with Custom Variables

Use custom environment variable mapping when your MCP host provides variables like `SERVICE_SONARR_ENDPOINT` instead of `SONARR_URL`:

```json
{
  "env": {
    "FLIX_BRIDGE_ENV_MAPPING": "{\"services\":{\"sonarr\":{\"baseUrl\":\"SERVICE_SONARR_ENDPOINT\",\"apiKey\":\"SERVICE_SONARR_TOKEN\"}}}",
    "SERVICE_SONARR_ENDPOINT": "http://localhost:8989",
    "SERVICE_SONARR_TOKEN": "your-api-key"
  }
}
```

### Use Case 4: Multi-Tenant Setup

Use config file with multiple instances:

```json
{
  "services": {
    "sonarr-tenant-a": {
      "baseUrl": "http://sonarr-a:8989",
      "apiKey": "tenant-a-key"
    },
    "sonarr-tenant-b": {
      "baseUrl": "http://sonarr-b:8989",
      "apiKey": "tenant-b-key"
    }
  }
}
```

## Troubleshooting Configuration

### Configuration Not Loading

1. Check that your config file path is correct
2. Verify JSON syntax is valid
3. Ensure environment variables are set correctly
4. Check file permissions

### Environment Variable Mapping Issues

1. Ensure the mapping is properly escaped in your MCP config
2. Check that all referenced environment variables are set
3. Verify JSON syntax in the mapping string

### Service Connection Issues

1. Verify base URLs are accessible
2. Test API keys manually:
   ```bash
   curl -H "X-Api-Key: your-api-key" http://localhost:8989/api/v3/system/status
   ```
3. Check for trailing slashes in URLs (they're automatically removed)

### Debug Configuration Loading

Enable debug logging to see which configuration method was used:

```bash
export FLIX_BRIDGE_DEBUG=1
```

This will show configuration loading details and which services were detected.

---

**Next Steps:**
- **[Usage →](usage.md)** - Set up MCP clients and start using Flix-Bridge
- **[Multi-Instance →](multi-instance.md)** - Advanced multi-instance configurations
- **[Troubleshooting →](troubleshooting.md)** - Common issues and solutions

---
*Part of the [Flix-Bridge](../README.md) documentation*
