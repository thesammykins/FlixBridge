# Flix-Bridge Test Suite

Comprehensive test suite for validating MCP server tools against the Sonarr/Radarr v3 API specification.

## Structure

```
tests/
├── unit/                   # Unit tests for individual service methods
│   ├── service-discovery.test.ts
│   ├── queue-operations.test.ts
│   ├── system-operations.test.ts
│   └── queue-diagnostics.test.ts
├── integration/            # Integration tests for MCP tools (planned)
├── fixtures/               # Mock API response data
│   ├── sonarr-responses.ts
│   └── radarr-responses.ts
├── helpers/                # Test utilities
│   ├── assertions.ts       # Custom assertion helpers
│   ├── mock-services.ts    # Mock service implementations
│   └── test-runner.ts      # Minimal test runner
└── run-all.ts              # Main test entry point
```

## Running Tests

```bash
# Run all unit tests
npm test

# Run unit tests explicitly
npm run test:unit

# Run specific test file (development)
tsx tests/unit/queue-operations.test.ts
```

## Test Philosophy

### Minimal Dependencies
- Uses Node.js built-in `assert` module
- No external test frameworks (Jest, Vitest, etc.)
- Aligns with project's minimal dependency philosophy

### API Specification Driven
- Fixtures based on official Sonarr/Radarr v3 OpenAPI specs
- Tests validate against actual API response structures
- Ensures compatibility with both service types

### Multi-Service Testing
- Tests cover both Sonarr (series) and Radarr (movies)
- Validates cross-service compatibility
- Ensures consistent behavior across service types

## Writing Tests

### Basic Test Structure

```typescript
import { describe, test } from "../helpers/test-runner.js";
import { assertOk, assertHasData } from "../helpers/assertions.js";
import { MockSonarrService } from "../helpers/mock-services.js";

await describe("Feature Name", [
  test("should do something", async () => {
    // Setup
    const service = new MockSonarrService("sonarr-main");

    // Execute
    const result = await service.someMethod();

    // Assert
    assertOk(result);
    assertHasData(result);
  })
]);
```

### Using Mock Services

```typescript
// Create mock service
const service = new MockSonarrService("test-service");

// Override specific endpoint responses
service.setMockResponse("/queue", {
  totalRecords: 0,
  records: []
});

// Use predefined fixtures
service.setStuckQueueItems();
service.setManualImportRejected();
```

### Custom Assertions

The test suite provides specialized assertions:

```typescript
// Response structure
assertOk(result);                    // result.ok === true
assertHasData(result);               // result.data exists
assertHasError(result);              // result.error exists

// Service metadata
assertServiceName(data, "sonarr-main");
assertMediaKind(data, "series");

// Data validation
assertArrayLength(arr, 5);
assertArrayNotEmpty(arr);
assertPropertyEquals(obj, "key", value);

// Domain-specific
assertQueueItem(item);
assertValidForeignId(id, "series");
assertValidQualityProfile(profile);
assertValidRootFolder(folder);
```

## Test Coverage

### Completed
- ✅ Service Discovery (`list_services`)
- ✅ Queue Operations (`queue_list`, `queue_grab`)
- ✅ System Operations (`system_status`, `root_folders`)
- ✅ Queue Diagnostics (issue detection, auto-fix)

### Planned
- ⏳ Media Management (`search`, `add_new`, `quality_profiles`)
- ⏳ History Operations (`history_detail`, `import_issues`)
- ⏳ Content Removal (`remove_content` with confirmation workflow)
- ⏳ Download Status (multi-service aggregation)
- ⏳ Integration Tests (full MCP tool workflows)

## Fixtures

### Sonarr Fixtures
Located in `fixtures/sonarr-responses.ts`:
- `sonarrSystemStatus` - System status response
- `sonarrQueueResponse` - Queue with 3 items
- `sonarrQueueStuckItems` - Queue with diagnostic issues
- `sonarrSeriesLookup` - Search results
- `sonarrQualityProfiles` - Quality profile configurations
- `sonarrRootFolders` - Storage configuration
- `sonarrHistoryResponse` - History events
- `sonarrManualImportCandidates` - Importable files
- `sonarrManualImportRejected` - Rejected imports

### Radarr Fixtures
Located in `fixtures/radarr-responses.ts`:
- Similar structure to Sonarr with movie-specific data
- Custom format upgrade scenarios
- 4K quality profiles

## Debugging Tests

### Enable Verbose Output
```bash
# Run with debug logging (if implemented)
FLIX_BRIDGE_DEBUG=1 npm test
```

### Run Single Test File
```bash
tsx tests/unit/queue-operations.test.ts
```

### Inspect Mock Responses
```typescript
const service = new MockSonarrService("test");
console.log(service.getMockResponse("/queue"));
```

## Contributing

When adding new tests:

1. **Create fixtures first** - Add API responses to `fixtures/`
2. **Use descriptive names** - Test names should explain what they validate
3. **Follow AAA pattern** - Arrange, Act, Assert
4. **Test both services** - Validate Sonarr and Radarr where applicable
5. **Use assertions** - Leverage custom assertions for clarity

## CI/CD Integration

Tests can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: npm test

- name: Check test coverage
  run: npm run test:unit
```

## Future Enhancements

- [ ] Integration tests for full MCP tool workflows
- [ ] E2E tests with actual Sonarr/Radarr instances
- [ ] Test coverage reporting
- [ ] Performance benchmarks
- [ ] Visual test reports