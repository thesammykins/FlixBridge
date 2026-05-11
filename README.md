# FlixBridge

[![npm version](https://badge.fury.io/js/@thesammykins%2Fflixbridge.svg)](https://badge.fury.io/js/@thesammykins%2Fflixbridge)
[![npm downloads](https://img.shields.io/npm/dt/@thesammykins/flixbridge.svg)](https://www.npmjs.com/package/@thesammykins/flixbridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Media Management MCP Server**  
> Connect your AI assistant to TV shows and movie management services

FlixBridge is a Model Context Protocol (MCP) server that bridges AI assistants with media management services. It provides a unified interface for monitoring downloads, managing libraries, and automating media workflows.

## ✨ Key Features

- **🎬 Multi-Service Support** - TV shows, movies, and download clients
- **🔄 Real-Time Monitoring** - Queue status, system health, and diagnostics  
- **🤖 Smart Automation** - Auto-fix stuck downloads and optimize workflows
- **🏢 Multi-Instance Ready** - Quality tiers, content types, environments
- **🔍 Intelligent Search** - Find and add new content with smart quality profiles
- **📊 Unified Dashboard** - Single view across all your services
- **🐛 Advanced Debugging** - Comprehensive logging and diagnostics
- **⚡ High Performance** - Efficient, lightweight, TypeScript-first

## 📦 Installation

### From npm (Recommended)

```bash
# Install globally
npm install -g @thesammykins/flixbridge

# Or install locally in your project
npm install @thesammykins/flixbridge
```

📦 **[View on npm](https://www.npmjs.com/package/@thesammykins/flixbridge)**

### From Source

```bash
# Clone the repository
git clone https://github.com/thesammykins/FlixBridge.git
cd FlixBridge

# Install dependencies and build
npm install && npm run build
```

## 🚀 Quick Start

```bash
# 1. Configure your services via environment variables
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-sonarr-api-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="your-radarr-api-key"
# Optional downloader
export SABNZBD_URL="http://localhost:8080"
export SABNZBD_API_KEY="your-sabnzbd-api-key"

# 2. Build and run
npm run build
npm start
```

Or with slug-based configuration for multiple instances:

```bash
# Multiple Sonarr instances
export SONARR_HD_URL="http://localhost:8989"
export SONARR_HD_API_KEY="your-hd-sonarr-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="your-4k-sonarr-key"

# Multiple Radarr instances  
export RADARR_MAIN_URL="http://localhost:7878"
export RADARR_MAIN_API_KEY="your-main-radarr-key"
export RADARR_UHD_URL="http://localhost:7879"
export RADARR_UHD_API_KEY="your-uhd-radarr-key"

npm start
```

## ⚙️ Configuration

FlixBridge v0.3.x uses environment-only configuration with slug-based discovery. No config files and no JSON-in-env mapping required.

### Slug-based multiple instances
- Sonarr: `SONARR_<SLUG>_URL`, `SONARR_<SLUG>_API_KEY`, `SONARR_<SLUG>_NAME` (optional)
- Radarr: `RADARR_<SLUG>_URL`, `RADARR_<SLUG>_API_KEY`, `RADARR_<SLUG>_NAME` (optional)
- SABnzbd: `SABNZBD_<SLUG>_URL`, `SABNZBD_<SLUG>_API_KEY`, `SABNZBD_<SLUG>_NAME` (optional)
- Prefixed aliases are also accepted: `FLIX_BRIDGE_SONARR_<SLUG>_URL` with `_KEY` or `_API_KEY`.
- Single-instance prefixed aliases are accepted too, e.g. `FLIX_BRIDGE_SABNZBD_URL` with `FLIX_BRIDGE_SABNZBD_KEY`.

### Single-instance fallback variables
- `SONARR_URL`
- `SONARR_API_KEY`
- `RADARR_URL`
- `RADARR_API_KEY`
- `SABNZBD_URL`
- `SABNZBD_API_KEY`

### Multi-Instance Example

```bash
# Sonarr
export SONARR_MAIN_URL="http://sonarr-main:8989"
export SONARR_MAIN_API_KEY="{{SONARR_MAIN_KEY}}"
export SONARR_4K_URL="http://sonarr-4k:8989"
export SONARR_4K_API_KEY="{{SONARR_4K_KEY}}"

# Radarr
export RADARR_MAIN_URL="http://radarr-main:7878"
export RADARR_MAIN_API_KEY="{{RADARR_MAIN_KEY}}"
export RADARR_UHD_URL="http://radarr-uhd:7878"
export RADARR_UHD_API_KEY="{{RADARR_UHD_KEY}}"

# SABnzbd (optional)
export SABNZBD_MAIN_URL="http://sab-main:8080"
export SABNZBD_MAIN_API_KEY="{{SAB_MAIN_KEY}}"
```

**Notes:**
- Service names default to `sonarr-<slug>` / `radarr-<slug>` (slug lowercased, `_` → `-`).
- If you set `<KIND>_<SLUG>_NAME`, that overrides the final name (ensure it contains "sonarr"/"radarr" to pass current detection).
- Single-instance fallback (SONARR_URL/RADARR_URL/SABNZBD_URL) still works for simple setups.

## 🛠️ Available Tools

> **⚠️ Important**: Always call `list_services` first to discover available services before using any other tools.

### Service Discovery
- **list_services** - Discover all configured services and downloaders

### Core Operations
- **system_status** - Health and version information
- **queue_list** - Download queue with progress tracking
- **queue_grab** - Force retry/grab specific downloads  
- **queue_diagnostics** - Analyze stuck items; pass `autoFix:false` for read-only checks
- **manual_import** - Preview and execute one-item manual imports with confirmation-token flow
- **remove_content** - Preview and remove queue, library, or downloader items with confirmation
- **root_folders** - Storage locations and free space

### Media Management
- **search** - Find new series/movies to add
- **add_new** - Add media with intelligent quality profiles
- **quality_profiles** - List available quality configurations
- **history_detail** - Download and import history
- **import_issues** - Detect stuck downloads and import problems

### Multi-Service Tools
- **all_services_diagnostics** - Run diagnostics across all instances
- **download_status** - Unified status across services and downloaders
- **server_metrics** - Local operation metrics and health status

> **Production Safety**: `queue_diagnostics` and `all_services_diagnostics` default to `autoFix:true`; explicitly pass `autoFix:false` for read-only production baselines. Use `remove_content` with `dryRun:true` first and execute only with the returned `confirmationToken` after checking the preview.

## 🔧 MCP Client Setup

### Copy/Paste Agent Install Prompt

Use this prompt with your coding agent to install FlixBridge and return a ready-to-paste MCP config:

```text
Install and configure FlixBridge MCP for me.

Requirements:
1) Install package: @thesammykins/flixbridge
2) Generate MCP config for Claude Desktop using command "npx" and args ["@thesammykins/flixbridge"]
3) Include these env vars in the config with my values:
   - SONARR_URL
   - SONARR_API_KEY
   - RADARR_URL
   - RADARR_API_KEY
   - SABNZBD_URL (optional)
   - SABNZBD_API_KEY (optional)
4) Return only:
   - exact install command(s)
   - exact claude_desktop_config.json snippet
   - a 3-step verification checklist
5) After setup, remind me to call list_services first.
```

If you use slug-based multi-instance setup, ask the agent to use `SONARR_<SLUG>_*`, `RADARR_<SLUG>_*`, and `SABNZBD_<SLUG>_*` variables.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flixbridge": {
      "command": "npx",
      "args": ["@thesammykins/flixbridge"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "your-sonarr-api-key",
        "RADARR_URL": "http://localhost:7878",
        "RADARR_API_KEY": "your-radarr-api-key"
      }
    }
  }
}
```

### Alternative: Global Installation

```bash
# Install globally for easier usage
npm install -g @thesammykins/flixbridge
```

Then use with Claude Desktop by providing environment variables (standard or via mapping):

```json
{
  "mcpServers": {
    "flixbridge": {
      "command": "flixbridge",
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

### Single Instance Setup (Alternative)

```bash
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-sonarr-api-key"
export RADARR_URL="http://localhost:7878" 
export RADARR_API_KEY="your-radarr-api-key"
export SABNZBD_URL="http://localhost:8080"
export SABNZBD_API_KEY="your-sabnzbd-api-key"
```

## 🐛 Debugging

Enable comprehensive debug logging:

```bash
FLIX_BRIDGE_DEBUG=1 npm run dev
```

## 🧪 Testing

```bash
# Basic functionality test
npm run smoke

# Test with debug output  
FLIX_BRIDGE_DEBUG=1 npm run smoke
```

## 📚 Documentation

- **[Installation & Setup](docs/installation.md)** - Requirements and installation
- **[Configuration Guide](docs/configuration.md)** - All configuration methods  
- **[Usage Guide](docs/usage.md)** - MCP client setup and workflows
- **[API Reference](docs/api-reference.md)** - Complete tool documentation
- **[Multi-Instance Setup](docs/multi-instance.md)** - Advanced multi-instance patterns
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions
- **[Architecture Guide](docs/architecture.md)** - Technical architecture for developers

## 🤝 Contributing

1. Read the [Architecture Guide](docs/architecture.md)
2. Follow engineering principles in `AGENTS.md`
3. Maintain TypeScript strict mode
4. Add tests for new features
5. Run `npm run smoke` before submitting

## 📄 License

MIT - see [LICENSE](LICENSE) file for details

## 🆘 Need Help?

1. **Check the [troubleshooting guide](docs/troubleshooting.md)**
2. **Run diagnostics:** `npm run smoke`
3. **Enable debug mode:** `FLIX_BRIDGE_DEBUG=1`
4. **Review logs** from your media management services

---

**Made with ❤️ for the home media automation community**
