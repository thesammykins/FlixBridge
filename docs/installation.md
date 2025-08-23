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

```bash
# Clone and setup
git clone https://github.com/your-org/flix-bridge.git
cd flix-bridge
npm install
npm run build
```

## Configuration

Create a `config.json` file:

```bash
cp config.sample.json config.json
```

Edit `config.json` with your service details:

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
# Basic connectivity test
npm run smoke

# With detailed debug output
FLIX_BRIDGE_DEBUG=1 npm run smoke
```

You should see output like:
```
✅ sonarr: System Status - OK (v4.0.0.746)
✅ radarr: System Status - OK (v5.3.6.8612) 
✅ sabnzbd: Connection test - OK
```

## Running the Server

### Development Mode
```bash
npm run dev
```

### Production Mode  
```bash
npm start
```

### Debug Mode
```bash
FLIX_BRIDGE_DEBUG=1 npm run dev
```

## Next Steps

- **[Configuration →](configuration.md)** - Learn about advanced configuration options
- **[Usage →](usage.md)** - Set up MCP clients and start using Flix-Bridge
- **[Multi-Instance →](multi-instance.md)** - Configure multiple service instances

---
*Part of the [Flix-Bridge](../README.md) documentation*
