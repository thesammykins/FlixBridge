# Tests

The suite uses Node assertions, the small TypeScript runner in
`helpers/test-runner.ts`, and Node's built-in test runner for MCP wire/client tests.
No test framework is needed. These checks are offline: mocked fetch responses or
synthetic loopback HTTP servers exercise the product without accessing media services.

## Commands

```sh
npm ci --include=dev --ignore-scripts
npm run build
npm run check
npm test
```

- `npm test` runs `test:unit`, then builds and runs `test:mcp`.
- `npm run test:unit` imports every sorted `unit/*.test.ts` and prints the summary.
- `npm run test:mcp` builds, then runs `mcp-*.test.mjs`.
- To run one TypeScript suite, print the shared runner summary explicitly. Importing
  a suite alone can record a failure without setting a failing process exit:

```sh
node --import tsx --input-type=module -e 'await import("./tests/unit/sonarr-api.test.ts"); const {testRunner}=await import("./tests/helpers/test-runner.ts"); testRunner.printSummary();'
node --test --test-name-pattern='unsupported versions' tests/mcp-wire.test.mjs
```

Do not run live `scripts/` as a substitute for tests. Some contact configured
services and can mutate state; inspect them and obtain separate scoped authority.

## Boundaries covered

- Sonarr legacy/explicit-v3/explicit-v5/auto policy, discovery, family routing,
  URL bases, repeated queries, nullable DTOs, pack scope, frozen workflow plans,
  strict unsupported behavior and read-only statistics.
- Radarr/SAB/Plex semantics and negative mutation cases: scope, candidate identity,
  freshness, incomplete snapshots, pending work, exact readback and no timeout replay.
- Central HTTP limits, redirects, credential-safe errors and cancellation through
  fetch, body reads and verification delays.
- Actual stdio subprocesses: modern MCP `2026-07-28`, legacy initialization,
  metadata/version errors, tool/input/output contracts, bounded admission,
  cancellation/EOF/signals and installed-bin entry behavior.
- Clean build output and publication-free verification CI.

Read [the verification map](ALIGNMENT.md) for limitations. Test totals belong to a
specific run/revision; this file deliberately does not carry a timeless green badge.

## Package and actual-client checks

`tests/mcp-client.test.mjs` uses the installed split SDK client in legacy, automatic
modern and pinned-modern modes. Set `MCP_TEST_BIN` to an installed package's
`node_modules/.bin/flixbridge` to exercise that exact package in wire/client tests.

Optional `MCP_LEGACY_CLIENT_ROOT` points to an external test installation with
`mcp-sdk-1-29` (npm alias for SDK 1.29.0) and `@modelcontextprotocol/sdk` 1.32.1.
Those historical clients are test consumers, not runtime dependencies. Without the
variable, those two extra client cells do not run; do not report them as verified.
Fault-injection/corrupted-metadata fixtures still target their declared local
fixture artifacts, even when ordinary product checks use the installed-bin override.

## Adding regressions

Write a failing check at the changed seam, observe its failure, then make the
smallest correction. Prefer actual service methods with synthetic fetch responses
for routing and mutation safety. A mock replacing the changed method cannot prove
it works. Label source-derived fixtures as synthetic and pin their upstream source;
never introduce private payloads, endpoints or credentials into fixtures.

For release claims, rebuild and test after the final merge, inspect the exact npm
manifest/tarball, install it in a fresh consumer and retain source/artifact identity.
Live-provider behavior, playback, recovery after restart and remote CI are separate
claims requiring their own evidence and authority.
