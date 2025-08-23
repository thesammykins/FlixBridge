# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

**Flix-Bridge** is a Model Context Protocol (MCP) server that provides LLMs with unified access to Sonarr (TV series) and Radarr (movie) media management applications. The server normalizes the different APIs into consistent operations and supports multi-instance configurations.

**Core Capabilities:**
- System status monitoring for Sonarr/Radarr instances
- Download queue management (list, grab/retry items)
- Root folder discovery and storage monitoring
- Multi-instance support for different quality tiers, content types, and environments

## Quick Start Commands

### Development Workflow
```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run production build
npm start

# Verify configuration and connectivity
npm run smoke

# Lint TypeScript code
npm run lint

# Enable debug logging
FLIX_BRIDGE_DEBUG=1 npm run dev

# Test Phase 2 features (SABnzbd integration, diagnostics)
npm run test:phase2

# Test queue diagnostics specifically
npm run test:queue-diagnostics

# Debug queue operations with detailed logging
npm run debug:queue
```

### Configuration Setup
```bash
# Copy sample configuration
cp config.sample.json config.json

# Edit with your actual API keys
# Find API keys at: Settings → General → Security → API Key

# Test specific instance configuration
FLIX_BRIDGE_CONFIG=config.json npm run smoke
```

## Architecture Overview

### Core Components

**Service Abstraction (`src/services/`)**
- `ServiceImplementation`: Interface defining all service operation methods
- `BaseArrService`: Abstract class with shared implementation for both services
- `SonarrService` / `RadarrService`: Service-specific implementations extending BaseArrService
- `ServiceRegistry`: Manages service instances and handles service type detection

**HTTP Layer (`src/core.ts`)**
- `fetchJson()`: Centralized HTTP client with timeout, error handling, and authentication
- `buildUrl()`: URL construction with query parameters
- `handleError()`: Consistent error normalization across all operations

**MCP Server (`src/index.ts`)**
- Tool registration with JSON schemas for all 12+ operations
- Request routing through service registry to appropriate service instances
- Multi-instance service management via ServiceRegistry
- Consistent response formatting for all operations

**Debug & Observability (`src/debug.ts`, `src/metrics.ts`)**
- `debug.ts`: Debug logging system with `FLIX_BRIDGE_DEBUG=1` environment flag
- `metrics.ts`: Performance monitoring and server metrics collection
- Comprehensive request/response logging and timing information

**Downloader Integration (`Phase 2`)**
- SABnzbd integration for download client monitoring
- Unified download status across arr services and downloaders
- Queue correlation between arr services and download clients

### Multi-Instance Architecture

Service names containing "sonarr" are treated as Sonarr instances, "radarr" as Radarr instances:

```json
{
  "services": {
    "sonarr-main": { "baseUrl": "http://localhost:8989", "apiKey": "..." },
    "sonarr-4k": { "baseUrl": "http://localhost:8990", "apiKey": "..." },
    "sonarr-anime": { "baseUrl": "http://anime:8989", "apiKey": "..." },
    "radarr-main": { "baseUrl": "http://localhost:7878", "apiKey": "..." },
    "radarr-4k": { "baseUrl": "http://localhost:7879", "apiKey": "..." }
  }
}
```

### Service Hierarchy

**BaseArrService** (abstract class in `shared.ts`):
- Contains all shared operation implementations
- Manages authentication and API URL construction  
- Handles response parsing and normalization
- Provides consistent error handling via `handleError()`

**Service-Specific Classes**:
- **SonarrService**: Sets `mediaKind = "series"` and TV-specific endpoints (`/series/lookup`, `/series`, `/wanted/missing`)
- **RadarrService**: Sets `mediaKind = "movie"` and movie-specific endpoints (`/movie/lookup`, `/movie`, `/movie/wanted`)

### Data Flow Pattern

1. **Tool Invocation**: LLM calls MCP tool with `service` parameter
2. **Service Resolution**: ServiceRegistry looks up service instance by name
3. **Method Invocation**: Call appropriate method on SonarrService/RadarrService instance
4. **Shared Implementation**: BaseArrService handles API communication and response processing
5. **Response Normalization**: Zod schemas validate and transform raw API responses
6. **Result Return**: Structured response with `{ ok, data?, error? }` format

## Response Format Standards

All operations return this consistent structure:

```typescript
{
  ok: boolean;
  data?: {
    service: string;           // Service instance name
    mediaKind: 'series' | 'movie';  // Content type indicator
    // ... operation-specific fields
  };
  error?: {
    service: string;
    status?: number;
    message: string;
    // ... error details
  };
}
```

## Common Development Patterns

### Adding New Operations

1. **Add Method to ServiceImplementation**: Define interface method in `src/services/base.ts`
2. **Implement in BaseArrService**: Add shared implementation to `src/services/shared.ts`
3. **Handle Service Differences**: Override in `SonarrService`/`RadarrService` if endpoints differ
4. **Add Zod Schemas**: Define validation schemas for API responses in `shared.ts`
5. **Register MCP Tool**: Add tool definition to `tools` array in `src/index.ts`
6. **Add Request Handler**: Add case to switch statement in call handler
7. **Update Types**: Add response types to `src/services/base.ts`

### Service-Specific Differences

Handle API differences between Sonarr and Radarr:
- **Endpoint Paths**: Defined in each service's `endpoints` property (`/series/*` vs `/movie/*`)
- **Media Type**: Automatically set via `mediaKind` property (`"series"` vs `"movie"`)
- **Field Mapping**: Handled in BaseArrService using `this.id` to branch logic (e.g., `tvdbId` vs `tmdbId`)
- **Service Detection**: ServiceRegistry automatically detects type from service name containing "sonarr" or "radarr"

### Error Handling Pattern

Always use the `handleError()` function to normalize errors:
- Network/timeout errors → ServiceError with status 0
- HTTP errors → Preserve status code and extract message
- Validation errors → Convert to readable message
- Never expose internal stack traces to MCP clients

## Critical Project Constraints

⚠️ **These constraints guide the project architecture (see AGENTS.md):**

- **LOC Budget**: Originally 400 lines, evolved to 700 lines for handwritten runtime TypeScript (AGENTS.md), currently ~2,705 lines due to expanded feature set with Phase 2 (SABnzbd integration) and Phase 3 (debug/metrics) capabilities
- **Minimal Dependencies**: Only essential packages (MCP SDK, zod, TypeScript tooling)
- **No Heavy Frameworks**: Prefer native Node.js APIs (fetch, etc.)
- **Strict TypeScript**: All strict settings enabled, no `any` types
- **Single HTTP Helper**: All external requests through `fetchJson()` function
- **Inheritance Pattern**: Uses abstract BaseArrService class for shared functionality while keeping service-specific logic separate

### Project Evolution
The codebase has evolved through three phases:
- **Phase 1**: Core arr service operations with class-based architecture for code reuse
- **Phase 2**: SABnzbd integration, queue diagnostics, and multi-downloader support
- **Phase 3**: Debug logging system, performance metrics, and comprehensive observability

This evolution handles 12+ different operations across multiple service types while maintaining code reuse and consistency.

## Multi-Instance Use Cases

**Quality Separation**: `sonarr-main` (1080p) vs `sonarr-4k` (UHD)
**Content Type**: `sonarr-anime`, `radarr-kids`, `radarr-foreign`
**Environment**: `sonarr-prod` vs `sonarr-test`
**Geographic**: Different server locations
**Performance**: High-traffic vs specialized instances

Service names must contain "sonarr" or "radarr" for proper type detection.

## Available Operations (12+ Tools)

### Core Operations
- **system_status**: Health and version information
- **queue_list**: Download queue with status and progress
- **queue_grab**: Force grab/retry queued items (single or bulk)
- **root_folders**: Storage locations and free space monitoring

### Extended Operations
- **History Detail**: Download and import history with filtering
- **Search**: Media lookup (series/movies) for adding to library
- **add_new**: Add new media to library with quality profiles
- **import_issues**: Check for stuck downloads and import problems
- **Quality Profiles**: List available quality configurations with recommendations

### Diagnostic & Monitoring Tools (Phase 2/3)
- **Queue Diagnostics**: Auto-detect and fix common queue issues
- **All Services Diagnostics**: Run diagnostics across all configured services
- **Download Status**: Unified status across arr services and SABnzbd downloaders
- **Server Metrics**: Performance monitoring and health assessment

## Common Tool Invocation Examples

```json
// System status for 4K Sonarr instance
{
  "tool": "system_status",
  "arguments": { "service": "sonarr-4k" }
}

// Queue list with pagination
{
  "tool": "queue_list",
  "arguments": { "service": "radarr-main", "pageSize": 25 }
}

// Bulk grab operation
{
  "tool": "Queue Grab",
  "arguments": { "service": "sonarr-anime", "ids": [123, 456, 789] }
}

// Search for new content
{
  "tool": "Search",
  "arguments": { "service": "radarr-main", "query": "Inception", "limit": 5 }
}

// Add new media to library
{
  "tool": "Add New",
  "arguments": {
    "service": "sonarr-main",
    "title": "Breaking Bad",
    "foreignId": 81189,
    "monitored": true
  }
}

// Check recent history
{
  "tool": "History Detail",
  "arguments": { "service": "sonarr-4k", "pageSize": 10 }
}

// Run queue diagnostics
{
  "tool": "Queue Diagnostics",
  "arguments": { "service": "sonarr-main" }
}

// Get unified download status
{
  "tool": "Download Status",
  "arguments": {
    "services": ["sonarr-main", "radarr-main"],
    "includeDownloader": true,
    "downloader": "sabnzbd"
  }
}

// List quality profiles
{
  "tool": "Quality Profiles",
  "arguments": { "service": "sonarr-4k" }
}
```

## Debug & Metrics Capabilities (Phase 3)

### Debug Logging

Enable comprehensive debug logging with the `FLIX_BRIDGE_DEBUG=1` environment variable:

```bash
# Development with debug logging
FLIX_BRIDGE_DEBUG=1 npm run dev

# Production with debug logging
FLIX_BRIDGE_DEBUG=1 npm start

# Smoke tests with debug logging
FLIX_BRIDGE_DEBUG=1 npm run smoke
```

**Debug Features:**
- Detailed HTTP request/response logging
- Timing information for all operations
- Service registry debugging
- Queue diagnostics trace information
- Error stack traces and context

### Performance Metrics

Built-in observability features:
- Request/response timing metrics
- Service health monitoring
- Queue operation performance tracking
- Error rate monitoring
- Multi-instance performance comparison

### Debug-Specific Commands

```bash
# Debug queue operations specifically
npm run debug:queue

# Test server metrics collection
npx tsx scripts/test-server-metrics.ts

# Trace diagnostics across all services
npx tsx scripts/trace-diagnostics.ts
```

## Configuration Methods

### Option 1: JSON Configuration (Recommended)
```bash
# config.json - Complete example with arr services and downloaders
{
  "services": {
    "sonarr-main": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "your-sonarr-api-key"
    },
    "radarr-main": {
      "baseUrl": "http://localhost:7878",
      "apiKey": "your-radarr-api-key"
    }
  },
  "downloaders": {
    "sabnzbd": {
      "baseUrl": "http://localhost:8080",
      "apiKey": "your-sabnzbd-api-key",
      "name": "SABnzbd Main"
    }
  }
}
```

### Option 2: Environment Variables
```bash
# Arr service configuration
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="your-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="your-key"

# SABnzbd downloader configuration
export SABNZBD_URL="http://localhost:8080"
export SABNZBD_API_KEY="your-sabnzbd-key"

# Optional custom config file path
export FLIX_BRIDGE_CONFIG="/path/to/config.json"
```

### Multi-Downloader Configuration

For multiple SABnzbd instances or different downloader types:

```json
{
  "services": {
    "sonarr-hd": {
      "baseUrl": "http://localhost:8989",
      "apiKey": "your-hd-sonarr-key"
    },
    "sonarr-4k": {
      "baseUrl": "http://localhost:8990", 
      "apiKey": "your-4k-sonarr-key"
    }
  },
  "downloaders": {
    "sabnzbd-main": {
      "baseUrl": "http://localhost:8080",
      "apiKey": "your-main-sabnzbd-key",
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

## Troubleshooting Checklist

1. **Service Not Found**: Verify exact service name in config matches tool calls
2. **API Connection**: Check baseUrl accessibility and API key permissions
3. **Multi-Instance Issues**: Ensure service names contain "sonarr" or "radarr"
4. **Response Validation**: Check that API responses match expected schemas
5. **Debug Logging**: Use `FLIX_BRIDGE_DEBUG=1` for detailed request/response logs

Run `npm run smoke` to validate all configured services.

## Claude Desktop Integration

Add to `claude_desktop_config.json`:

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

## WARP Development Guidance

### Before Making Changes

1. **Read AGENTS.md** - Contains architectural decisions and constraints
2. **Check LOC Budget** - Run `find src -name "*.ts" -exec wc -l {} + | tail -1` to verify ≤700 lines for core handwritten runtime TypeScript (per AGENTS.md)
3. **Understand Service Abstraction** - Review `BaseService` interface and operation patterns
4. **Review Multi-Instance Support** - Understand service name→type mapping

### Development Workflow

1. **Implement Changes** following existing patterns in `src/services/shared.ts` (BaseArrService)
2. **Update MCP Registration** in `src/index.ts` if adding new tools
3. **Test Configuration** with `npm run smoke`
4. **Validate TypeScript** with `npm run lint` and `npm run build`
5. **Verify LOC Budget** remains under 700 lines for handwritten runtime TypeScript (core services exempt but should stay minimal)

### Architecture Decisions

- **Why BaseArrService Class?** Maximizes code reuse between Sonarr/Radarr while keeping service-specific logic separate
- **Why Single HTTP Helper?** Centralized error handling and timeout management
- **Why Zod Validation?** Runtime type safety for external API responses
- **Why Service Registry?** Supports dynamic multi-instance configurations with automatic service type detection
- **Why Abstract Classes?** Enforces consistent interface while allowing service-specific endpoint configuration

### Integration Testing

The `scripts/smoke.ts` file provides comprehensive testing:
- Validates all configured service instances
- Tests core operations (status, queue, folders)
- Reports detailed pass/fail results
- Can test specific instances: `FLIX_BRIDGE_CONFIG=test-config.json npm run smoke`

⚠️ **Important**: Do not modify `AGENTS.md` without explicit permission - it contains the project's core architectural decisions and constraints.
