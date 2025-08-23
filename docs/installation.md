# Installation & Setup

> **📖 Flix-Bridge Documentation**  
> [← Back to README](../README.md) | [Next: Configuration →](configuration.md)

Get Flix-Bridge up and running in minutes.

## Requirements

- **Node.js 20.0.0** or later
- Access to one or more of the following services:
  - TV series management service (Sonarr-compatible API)  
  - Movie management service (Radarr-compatible API)
  - Download client (SABnzbd-compatible API)

## Quick Installation

### From npm (Recommended)

```bash
# Install globally
npm install -g @thesammykins/flixbridge

# Or install locally in your project
npm install @thesammykins/flixbridge
```

### From Source (Development)

```bash
# Clone and setup
git clone https://github.com/thesammykins/FlixBridge.git
cd FlixBridge
npm install
npm run build
```

## Configuration

Configure via environment variables (v0.3.x+):

```bash
# Slug-based configuration for multiple instances (recommended)
export SONARR_MAIN_URL="http://localhost:8989"
export SONARR_MAIN_API_KEY="your-main-sonarr-api-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="your-4k-sonarr-api-key"

export RADARR_HD_URL="http://localhost:7878"
export RADARR_HD_API_KEY="your-hd-radarr-api-key"
export RADARR_UHD_URL="http://localhost:7879"
export RADARR_UHD_API_KEY="your-uhd-radarr-api-key"

# Optional downloader
export SABNZBD_MAIN_URL="http://localhost:8080"
export SABNZBD_MAIN_API_KEY="your-sabnzbd-api-key"
```

Or use single-instance fallback for simple setups:

```bash
# Single instance fallback
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-sonarr-api-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="your-radarr-api-key"
export SABNZBD_URL="http://localhost:8080"
export SABNZBD_API_KEY="your-sabnzbd-api-key"
```

## Finding Your API Keys

### For Sonarr/Radarr
1. Open your service's web interface
2. Go to **Settings → General**  
3. Copy the **API Key** from the Security section

### For SABnzbd
1. Open SABnzbd web interface
2. Go to **Config → General**
3. Copy the **API Key** (generate if empty)

## Verification

Test your setup:

```bash
# If installed from source
SONARR_MAIN_URL=http://localhost:8989 SONARR_MAIN_API_KEY=... \
RADARR_HD_URL=http://localhost:7878 RADARR_HD_API_KEY=... \
npm run smoke

# With detailed debug output
FLIX_BRIDGE_DEBUG=1 SONARR_MAIN_URL=... SONARR_MAIN_API_KEY=... \
RADARR_HD_URL=... RADARR_HD_API_KEY=... npm run dev
```

You should see output like:
```
✅ sonarr-main: System Status - OK (v4.0.0.746)
✅ radarr-hd: System Status - OK (v5.3.6.8612) 
✅ sabnzbd-main: Connection test - OK
```

## Running the Server

### With npm Package
```bash
# Basic run with slug-based env vars
SONARR_MAIN_URL=http://localhost:8989 SONARR_MAIN_API_KEY=... \
RADARR_HD_URL=http://localhost:7878 RADARR_HD_API_KEY=... \
SABNZBD_MAIN_URL=http://localhost:8080 SABNZBD_MAIN_API_KEY=... \
 npx @thesammykins/flixbridge

# Or single-instance fallback
SONARR_URL=http://localhost:8989 SONARR_API_KEY=... \
RADARR_URL=http://localhost:7878 RADARR_API_KEY=... \
 npx @thesammykins/flixbridge

# Debug mode
FLIX_BRIDGE_DEBUG=1 npx @thesammykins/flixbridge
```

### From Source (Development)
```bash
# Development mode
npm run dev

# Production mode  
npm start

# Debug mode
FLIX_BRIDGE_DEBUG=1 npm run dev
```

## Next Steps

- **[Configuration →](configuration.md)** - Learn about advanced configuration options
- **[Usage →](usage.md)** - Set up MCP clients and start using Flix-Bridge
- **[Multi-Instance →](multi-instance.md)** - Configure multiple service instances

---
*Part of the [Flix-Bridge](../README.md) documentation*
