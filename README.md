# FlixBridge

[![Build and Publish](https://github.com/thesammykins/arr_mcp/actions/workflows/build-and-publish.yml/badge.svg)](https://github.com/thesammykins/arr_mcp/actions/workflows/build-and-publish.yml)
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

### From Source

```bash
# Clone the repository
git clone https://github.com/thesammykins/arr_mcp.git
cd arr_mcp

# Install dependencies and build
npm install && npm run build
```

## 🚀 Quick Start

```bash
# 1. Configure your services  
cp config.sample.json config.json
# Edit config.json with your API keys

# 2. Test connectivity
npm run smoke

# 3. Run the server
npm start
```

## ⚙️ Configuration

### Basic Setup

Create a `config.json` file:

```json
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
  },
  "downloaders": {
    "sabnzbd": {
      "baseUrl": "http://localhost:8080",
      "apiKey": "your-sabnzbd-api-key",
      "name": "SABnzbd"
    }
  }
}
```

### Multi-Instance Example

```json
{
  "services": {
    "sonarr-hd": {"baseUrl": "http://localhost:8989", "apiKey": "key1"},
    "sonarr-4k": {"baseUrl": "http://localhost:8990", "apiKey": "key2"},
    "radarr-main": {"baseUrl": "http://localhost:7878", "apiKey": "key3"}
  }
}
```

**Service Naming:** Names must contain "sonarr" or "radarr" for automatic detection.

## 🛠️ Available Tools

### Core Operations
- **System Status** - Health and version information
- **Queue List** - Download queue with progress tracking
- **Queue Grab** - Force retry/grab specific downloads  
- **Queue Diagnostics** - Auto-detect and fix stuck items
- **Root Folders** - Storage locations and free space

### Media Management
- **Search** - Find new series/movies to add
- **Add New** - Add media with intelligent quality profiles
- **Quality Profiles** - List available quality configurations
- **History Detail** - Download and import history
- **Import Issues** - Detect stuck downloads and import problems

### Multi-Service Tools
- **All Services Diagnostics** - Run diagnostics across all instances
- **Download Status** - Unified status across services and downloaders

## 🔧 MCP Client Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flix-bridge": {
      "command": "node",
      "args": ["/path/to/flix-bridge/dist/index.js"],
      "env": {
        "FLIX_BRIDGE_CONFIG": "/path/to/flix-bridge/config.json"
      }
    }
  }
}
```

### Environment Variables (Alternative)

```bash
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-sonarr-api-key"
export RADARR_URL="http://localhost:7878" 
export RADARR_API_KEY="your-radarr-api-key"
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
