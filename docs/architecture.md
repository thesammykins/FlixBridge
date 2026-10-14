# Architecture

FlixBridge is a Node.js ESM/TypeScript stdio MCP server. The runtime uses the MCP SDK, Zod and native fetch; there is no HTTP listener, dashboard, scheduler or persistent operational database.

## Source boundaries

| File | Responsibility |
| --- | --- |
| `src/index.ts` | MCP bootstrap, tool schemas/dispatch, aggregate operations and confirmation handling |
| `src/config.ts` | Environment-only ARR/SABnzbd discovery and naming |
| `src/core.ts` | Shared fetch/timeout, URL building and error helpers |
| `src/services/base.ts` | Service contracts and result types |
| `src/services/shared.ts` | Shared ARR operations, diagnostics, imports, removal and profile updates |
| `src/services/registry.ts` | Separate named ARR and SABnzbd maps; ARR adapter detection by name |
| `src/services/arr/sonarr.ts`, `radarr.ts` | Series/movie adapters and service-specific behavior |
| `src/services/downloaders/sabnzbd.ts` | SABnzbd queue, status and removal integration |
| `src/services/plex/reports.ts` | Plex cloud report/comment GraphQL and PMS metadata reads |
| `src/services/plex/remediation.ts` | Report matching, comment-derived resolution state and remediation |
| `src/mcp-version.ts`, `src/request-context.ts` | Modern version guard, bounded tool admission and request-scoped cancellation |
| `src/debug.ts`, `src/metrics.ts` | Stderr logging and process-local instrumentation |

## Request flow

At startup, the environment loader merges fallback and slug-based ARR/SABnzbd configurations. The registry creates adapters; names containing `sonarr` or `radarr` select their type. Plex is loaded separately from its URL/token environment pair when its tools run, not registered as an ARR service.

SDK 2.3.1 `serveStdio` selects modern MCP `2026-07-28` or legacy serving. A modern per-request version guard rejects unsupported revisions. Dispatch checks the advertised tool fields/required inputs and Zod bounds, resolves the target adapter and returns matching structured/text `{ok,data?,error?}` envelopes. Failed envelopes set `isError:true`; unknown tools/methods and wire errors remain protocol errors. Aggregates and Plex results do not universally carry `service` or `mediaKind`.

All external HTTP calls use `fetchJson`. It supplies JSON acceptance, a default five-second abort timeout, response parsing, error normalization and debug timing. Adapters supply authentication (ARR API keys, SABnzbd parameters, Plex headers); the helper does not universally inject credentials. It has no automatic retry. Some operations choose longer timeouts. Four tool calls can execute and sixteen can wait; cancellation removes queued work and aborts active HTTP/body reads and verification delays. It cannot roll back an accepted upstream mutation.

## Sonarr route selection

`SonarrService` owns per-instance discovery and reviewed operation maps; the shared
ARR service uses the request-local API family. Omission stays v3 without discovery;
explicit `3`/`5` verifies the advertised family, while `auto` selects v5 only for
reviewed workflows when current is v5. Discovery/status verification is cached for
five minutes. URL base paths are preserved. A workflow and its preview/execution
retain one family; failed writes are never replayed on another family.

Cold discovery/status probes with request cancellation run independently so one
caller's cancellation cannot fail a sibling. Completed per-instance results are
cached; signal-free callers also deduplicate in-flight probes. There are no detached
background discovery tasks or discovery timers.

Removal, import issues, file deletion and diagnostics auto-fix intentionally remain
v3; strict v5 rejects them before writes. Direct imports, read diagnostics, profiles,
add/search/queue grab/search commands and read-only statistics have reviewed v5
routes. Statistics is unsupported on legacy/Radarr without a scan fallback.
`list_services` exposes configured Sonarr policy offline; `system_status` exposes
advertised/verified/effective-operation metadata. See [route details](configuration.md#sonarr-api-policy).

## Mutation boundaries

Diagnostics default to read-only (`autoFix:false`). Clients should keep the flag explicit for observation. Technical validation and safety classification do not substitute for operator authority.

`manual_import` and `remove_content` retain previews in process memory with five-minute, single-use confirmation tokens. Execution checks the stored scope/IDs and, for removal, options. Restart loses tokens. Imports refresh target/candidate fingerprints, bind exact media/download/path scope, submit `ManualImport` and require completed command, complete queue absence and changed library-file IDs. Pending remains legacy failed with additive pending/command evidence; no durable import journal or background completion monitor exists. Queue/library/downloader removals are different scopes, with distinct IDs and possible partial outcomes.

`update_quality_profile` GETs an ARR movie/series record and PUTs the full record with a changed profile ID. It has no preview/token gate, does not launch a search, and GETs the exact item back to verify persistence. Callers must authorize and read back the exact item.

Plex combines account reports from `community.plex.tv` with metadata from the configured PMS, then matches against ARR libraries. Resolution is inferred from a bounded comment history; it is not a playback test or a native report-close operation. Remediation actions can search, add, delete a file and post comments. Only `remove_and_regrab` has a ten-minute concrete-plan-bound token; it binds the concrete report/action/service/library item/movie file/episode file/resolved title. All actions execute unless callers explicitly send `dryRun:true`.

Plex destruction rejects fuzzy/ambiguous media/file targets and rederives the destructive token plan. Pending comments block rework. Dispatch retains private clients per exact configured server/token identity; client-scoped active and snapshot guards therefore protect sequential and concurrent tool calls without one account blocking another. Accepted media work followed by comment failure returns safe local partial-mutation guidance. Guards do not survive server reconstruction/restart, and token rotation creates a distinct configured identity. Process-local maps, metrics and tokens are not durable audit records or cross-process locks. Async upstream commands and separate comment writes can produce partial outcomes; callers must inspect returned detail and read back affected systems before retries or success claims.

## Development and packaging

`npm run dev` runs source through tsx. `npm run build` removes stale `dist/` output before compiling/typechecking; `prepack` rebuilds, and `npm start` runs that build. The published npm executable runs its packaged `dist/index.js`, not an arbitrary local checkout. The package allowlist currently includes dist, README and license, not repository scripts/docs/skills.

Use `npm run build && npm run check && npm test` for runtime changes. Tests use the custom unit runner and Node MCP wire/client/HTTP tests, not Jest/Vitest. Live scripts require a separately authorized stack: `npm run smoke` calls diagnostics with the read-only default in this source and enables debug output; it is not an offline CI gate. For prose-only changes, validate links/examples and compare claims with source; runtime changes still require the full gates.

Before extending the service/config/tool contracts, read the actual interfaces and schemas and obtain required approval under AGENTS.md. Do not copy speculative adapters: adding another media kind requires explicit contract, registry, config, dispatch and test changes.

See [configuration](configuration.md), [safe usage](usage.md), [tool reference](api-reference.md), and [deployable operations/Plex skills](../skills/README.md).
