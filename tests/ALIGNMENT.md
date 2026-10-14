# Verification map

This replaces an obsolete static “full alignment” report. Passing fixture tests are
not certification of all Sonarr/Radarr endpoints or deployed media behavior.
Run commands in [the test guide](README.md) against the final revision and record
actual output; do not carry old totals or source line numbers forward.

| Claim | Executable evidence | Not established by that evidence |
| --- | --- | --- |
| Existing semantic tools remain usable | MCP catalogue/required-input checks and actual SDK clients | Every host's UI or every undocumented argument |
| Current MCP and legacy stdio coexist | `mcp-wire.test.mjs`, `mcp-client.test.mjs`, `mcp-http.test.mjs`, legacy stdio regression | Optional protocol subsystems not exposed by this server |
| Sonarr policies choose reviewed contracts | `unit/sonarr-api-policy.test.ts`, `unit/sonarr-api.test.ts` through real service/fetch boundaries | Installed-provider contract or every develop-branch revision |
| Imports bind exact reviewed candidates | `unit/media-release-safety.test.ts` and ARR/import safety regressions | Playback or durable replay prevention across restart |
| Queue/download absence needs complete evidence | ARR/SAB safety tests with duplicate and partial snapshots | Recovery of deleted production data |
| Aggregates preserve incomplete coverage | `unit/aggregate-completeness.test.ts`, dispatch safety tests | Whole-library health from a bounded page |
| Cancellation reaches adapter timers | `unit/removal-cancellation.test.ts`, real MCP EOF during accepted DELETE verification | Rollback of commands the upstream already accepted |
| Fresh release build excludes stale output | `unit/build-output.test.ts` | Sanitization of all public source/history or package contents |
| Ordinary CI cannot publish | `unit/release-policy.test.ts` | A remote workflow change being active before it is merged |

## Fixture provenance and review

The v3 fixtures are synthetic examples used by legacy tests; historical prose that
called all of them verified real responses was not a provenance record. V5 fixtures
identify the pinned Sonarr source in their test file. A DTO declaration or OpenAPI
schema is useful evidence but can disagree with runtime serialization or mappings.

When a bug is found, demonstrate that the new regression fails on the old behavior.
For safety and async changes include partial failure, duplicate/replay, cancellation,
wrong identity and stale data where relevant. Read the complete changed path and its
callers; do not infer coverage from a test name or percentage.

## Release checks beyond this map

Build/check/unit/wire gates, dependency audit, independent review, documentation
validation, public-tree/history sanitation, exact packed-file inspection and fresh
package installation are complementary. Tie all results to the final source and
artifact. A successful subset cannot establish release readiness. Live mutations
require separately authorized disposable targets, never an implicit production smoke.
