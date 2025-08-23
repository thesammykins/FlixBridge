# Technical Architecture

> **📖 Flix-Bridge Documentation**  
> [← Troubleshooting](troubleshooting.md) | [Back to README →](../README.md)

Technical architecture guide for developers and contributors to Flix-Bridge.

## Overview

Flix-Bridge follows a clean architecture with clear separation of concerns, designed to be maintainable, extensible, and efficient within strict constraints.

## Architecture Principles

From the project's engineering guidelines (`AGENTS.md`):

1. **Minimal Dependencies**: Only essential packages (MCP SDK, zod, TypeScript tooling)
2. **No Heavy Frameworks**: Prefer native Node.js APIs (fetch, etc.)
3. **Strict TypeScript**: All strict settings enabled, no `any` types
4. **Single HTTP Helper**: All external requests through `fetchJson()` function
5. **Inheritance Pattern**: Uses abstract BaseArrService class for shared functionality

## High-Level Architecture

```
/src
  index.ts                 -> MCP server bootstrap + tool registration
  core.ts                  -> shared fetch wrapper (retry + timeout)
  debug.ts                 -> debug logging system (Phase 3)
  metrics.ts               -> observability & metrics collection (Phase 3)
  services/
    base.ts                -> shared service & operation type contracts
    shared.ts              -> BaseArrService implementation
    registry.ts            -> service registry: serviceName -> adapter
    arr/
      sonarr.ts            -> TV series service adapter
      radarr.ts            -> Movie service adapter
    downloaders/
      sabnzbd.ts           -> Download client integration (Phase 2)
```

## Core Components

### Service Abstraction Layer

The service abstraction provides a unified interface for different media management services while preserving their specific characteristics.

#### ServiceImplementation Interface
```typescript
export interface ServiceImplementation {
  id: string;
  mediaKind: 'series' | 'movie';
  endpoints: {
    lookup: string;
    add: string;
    wanted: string;
  };
}
```

#### BaseArrService (Abstract Class)
Located in `src/services/shared.ts`, this class provides shared functionality:

- **Authentication**: Manages API key injection
- **URL Construction**: Builds proper API endpoints
- **Response Processing**: Handles response normalization  
- **Error Handling**: Provides consistent error handling via `handleError()`
- **HTTP Communication**: Centralized through `fetchJson()`

#### Service-Specific Classes

**SonarrService** (`src/services/arr/sonarr.ts`):
- Sets `mediaKind = "series"`
- Configures TV-specific endpoints (`/series/lookup`, `/series`, `/wanted/missing`)
- Handles TVDB ID mapping

**RadarrService** (`src/services/arr/radarr.ts`):
- Sets `mediaKind = "movie"`
- Configures movie-specific endpoints (`/movie/lookup`, `/movie`, `/movie/wanted`)
- Handles TMDB ID mapping

### Service Registry

The `ServiceRegistry` class (`src/services/registry.ts`) manages service instances:

```typescript
class ServiceRegistry {
  register(serviceName: string, config: ServiceConfig): void
  get(serviceName: string): ServiceImplementation | undefined
  list(): string[]
  private detectServiceType(serviceName: string): 'sonarr' | 'radarr'
}
```

**Service Detection Logic:**
- Service names containing "sonarr" → `SonarrService`
- Service names containing "radarr" → `RadarrService`
- Automatic type detection enables multi-instance support

### HTTP Layer

Centralized HTTP handling through `fetchJson()` in `src/core.ts`:

```typescript
fetchJson<T>(input: RequestInfo, init?: RequestInit & { timeoutMs?: number }): Promise<T>
```

**Responsibilities:**
- Injects authentication headers (`X-Api-Key`)
- Enforces default timeout (5000ms) via `AbortController`
- Normalizes error responses to `ServiceError` format
- Provides retry mechanism for idempotent operations

**Error Handling:**
```typescript
interface ServiceError {
  service: string;
  status: number;
  code?: string;
  message: string;
  raw?: unknown;
}
```

### Response Format Standards

All operations return consistent response structure:

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

## Data Flow Pattern

1. **Tool Invocation**: LLM calls MCP tool with `service` parameter
2. **Service Resolution**: ServiceRegistry looks up service instance by name
3. **Method Invocation**: Call appropriate method on SonarrService/RadarrService instance
4. **Shared Implementation**: BaseArrService handles API communication and response processing
5. **Response Normalization**: Zod schemas validate and transform raw API responses
6. **Result Return**: Structured response with consistent format

## Service Organization Structure

As of Phase 3, services are organized in a dedicated subdirectory structure:
Services are organized in a dedicated subdirectory structure with environment-based configuration:

### Current Structure (Phase 3+)
```
/src/services/
  arr/               # Media management services
    sonarr.ts        # TV series service
    radarr.ts        # Movie service
  downloaders/       # Download client services
    sabnzbd.ts       # SABnzbd downloader
  base.ts           # Service contracts and types
  shared.ts         # BaseArrService implementation
  registry.ts       # Service registry with auto-discovery
```

### Configuration System
```
/src/
  config.ts         # Slug-based environment variable discovery
                   # Replaces JSON config with pure env var detection
```

**Benefits:**
- **Clear Separation**: Media management vs download client services
- **Extensibility**: Easy to add new arr services in `arr/` subdirectory
- **Organization**: Related services grouped logically

## Multi-Instance Architecture

Service names containing "sonarr" are treated as Sonarr instances, "radarr" as Radarr instances:

```bash
# Environment variables with slug-based discovery
export SONARR_MAIN_URL="http://localhost:8989"
export SONARR_MAIN_API_KEY="your-main-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="your-4k-key"
export RADARR_HD_URL="http://localhost:7878"
export RADARR_HD_API_KEY="your-hd-key"

# Results in discovered services: sonarr-main, sonarr-4k, radarr-hd
```

Each service instance gets its own adapter while sharing the common BaseArrService implementation. Services are auto-discovered from environment variables following the pattern `<SERVICE>_<SLUG>_<FIELD>`.

## Operation Normalization

Operations are normalized across different service types:

| Semantic Operation | Sonarr Path                    | Radarr Path                     | Notes |
|--------------------|--------------------------------|--------------------------------|-------|
| systemStatus       | /api/v3/system/status          | /api/v3/system/status          | Identical |
| queueList          | /api/v3/queue                  | /api/v3/queue                  | Identical |
| historyDetail      | /api/v3/history/series         | /api/v3/history/movie          | Divergent noun |
| lookupGeneral      | /api/v3/series/lookup          | /api/v3/movie/lookup           | Divergent noun |
| lookupTmdb         | n/a                            | /api/v3/movie/lookup/tmdb      | Radarr only |

**Implementation Pattern:**
- Each semantic operation is one exported function returning a typed result
- Use discriminated union for results when divergent fields exist
- Service-specific endpoints handled by subclass endpoint configuration

## Phase Evolution

The codebase has evolved through three phases:

### Phase 1: Core Operations
- Basic arr service operations with class-based architecture
- Foundation for code reuse and consistency

### Phase 2: Enhanced Integration  
- SABnzbd integration for download client monitoring
- Queue diagnostics and multi-downloader support
- Unified download status across services

### Phase 3: Observability & Organization
- Debug logging system with `FLIX_BRIDGE_DEBUG=1` environment flag
- Performance metrics and server metrics collection
- Service organization into dedicated subdirectories

This evolution handles 12+ different operations across multiple service types while maintaining code reuse and consistency.

## Extension Guide

### Adding New Arr Services

**1. Create Service File:**
```bash
touch src/services/arr/lidarr.ts
```

**2. Implement Service:**
```typescript
// src/services/arr/lidarr.ts
import type { ServiceImplementation } from "../base.js";
import { BaseArrService } from "../shared.js";

export class LidarrService
  extends BaseArrService
  implements ServiceImplementation
{
  readonly id = "lidarr" as const;
  readonly mediaKind = "music" as const;
  readonly endpoints = {
    lookup: "/artist/lookup",
    add: "/artist",
    wanted: "/wanted/missing",
  };
}
```

**3. Register in Registry:**
```typescript
// src/services/registry.ts
import { LidarrService } from "./arr/lidarr.js";

private detectServiceType(serviceName: string): "sonarr" | "radarr" | "lidarr" {
  const name = serviceName.toLowerCase();
  if (name.includes("sonarr")) return "sonarr";
  if (name.includes("radarr")) return "radarr";
  if (name.includes("lidarr")) return "lidarr";
  // ...
}
```

**4. Update Tool Registration:**
Add new tools to `src/index.ts` tool registry as needed.

### Adding New Service Categories

For other service types (indexers, monitoring, etc.):

```
/src/services/
  arr/              # Media management
  downloaders/      # Download clients  
  indexers/         # New: Indexer management
    jackett.ts
    prowlarr.ts
  monitoring/       # New: Monitoring services
    overseerr.ts
    tautulli.ts
```

Follow the same patterns established for arr services.

## Performance Considerations

### Memory Management
- Use pagination for large datasets
- Validate response schemas with Zod only where safety matters
- Avoid over-modeling dynamic arrays

### HTTP Optimization
- Single HTTP helper reduces overhead
- Built-in timeout and retry mechanisms
- Connection reuse through native fetch

### Service Isolation
- Each service instance is independent
- No shared state between instances
- Clean error boundaries per service

## Debug and Observability

### Debug Logging
Enable with `FLIX_BRIDGE_DEBUG=1`:
- Detailed HTTP request/response logging
- Timing information for all operations  
- Service registry debugging
- Error stack traces and context

### Performance Metrics
Built-in observability features:
- Request/response timing metrics
- Service health monitoring
- Queue operation performance tracking
- Multi-instance performance comparison

### Testing Strategy

**Smoke Tests** (`scripts/smoke.ts`):
- Loads local configuration
- Tests core operations across all services
- Provides pass/fail summary

**Diagnostic Tools:**
- Built-in queue diagnostics
- Service health checks
- Configuration validation

## Contributing Guidelines

1. **Follow AGENTS.md principles** - Read architectural decisions and constraints
2. **Maintain LOC Budget** - Core runtime TypeScript should stay minimal
3. **Understand Service Abstraction** - Review BaseService interface and patterns
4. **Test Multi-Instance Support** - Ensure service name→type mapping works
5. **Validate with Smoke Tests** - Use `npm run smoke` to verify changes

Before making changes:
- Check current line count: `find src -name "*.ts" -exec wc -l {} + | tail -1`
- Review multi-instance architecture patterns
- Understand operation normalization approach

---

**Related Documentation:**
- **[Installation →](installation.md)** - Setup and requirements
- **[Configuration →](configuration.md)** - Configuration methods and options  
- **[Multi-Instance →](multi-instance.md)** - Multi-instance patterns and use cases

---
*Part of the [Flix-Bridge](../README.md) documentation*
