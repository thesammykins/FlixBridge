# Architecture

FlixBridge is a Node.js ESM/TypeScript stdio MCP server with an optional separately invoked retention CLI. It uses the MCP SDK, Zod and native fetch. The MCP process installs no schedule, starts no callback listener and performs no automatic deletion. Explicit private local files persist rules, scheduler attempts and hash-bound human approval/execution state; the separate `bridge` CLI command starts the loopback approval HTTP listener. There is no dashboard or distributed operational database.

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
| `src/runtime-config.ts` | Shared environment-only startup configuration, including media-only reads |
| `src/library/` | Reviewed v3 ARR snapshots, media-server/user joins, watch/session evidence, optional TMDB reviews and exact library actions |
| `src/retention/`, `src/retention-requests.ts` | Pure bounded evaluation, durable immutable rule revisions/due reservations and proposal-to-removal arguments |
| `src/approval/`, `src/approval-tools.ts`, `src/approval-plans.ts` | Canonical plan hashing, private durable approval ledger, trusted signed bridge, fresh execution manifests |
| `src/removal-authority.ts` | Private request-local removal permits enforced at the shared HTTP boundary, including downloader query deletion |
| `src/cli.ts` | Opt-in bridge/evaluate/run-due/execute; no approval command or installed scheduler |

## Request flow

At startup, the environment loader merges fallback and slug-based ARR/SABnzbd configurations. The registry creates adapters; names containing `sonarr` or `radarr` select their type. Plex is loaded separately from its URL/token environment pair when its tools run, not registered as an ARR service.

SDK 2.4.0 `serveStdio` selects modern MCP `2026-07-28` or legacy serving. A modern per-request version guard rejects unsupported revisions. Dispatch checks the advertised tool fields/required inputs and Zod bounds, resolves the target adapter and returns matching structured/text `{ok,data?,error?}` envelopes. Failed envelopes set `isError:true`; unknown tools/methods and wire errors remain protocol errors. Aggregates and Plex results do not universally carry `service` or `mediaKind`.

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

`manual_import` and legacy removal preview mechanics retain five-minute process-local tokens; restart loses those tokens. Every explicit removal additionally requires authenticated durable human `approvalId`, with fresh preview regeneration and a one-use claim; a token cannot authorize it. Import execution retains its existing stored-scope/token checks. Imports refresh target/candidate fingerprints, bind exact media/download/path scope, submit `ManualImport` and require completed command, complete queue absence and changed library-file IDs. Pending remains legacy failed with additive pending/command evidence; no durable import journal or background completion monitor exists. Queue/library/downloader removals are different scopes, with distinct IDs and possible partial outcomes.

`update_quality_profile` GETs an ARR movie/series record and PUTs the full record with a changed profile ID. It has no preview/token gate, does not launch a search, and GETs the exact item back to verify persistence. Callers must authorize and read back the exact item.

Plex combines account reports from `community.plex.tv` with metadata from the configured PMS, then matches against ARR libraries. Resolution is inferred from a bounded comment history; it is not a playback test or a native report-close operation. Remediation actions can search, add, delete a file and post comments. `remove_and_regrab` requires durable human `approvalId` execution authority as well as its internally regenerated ten-minute preview-token mechanic; it binds the concrete report/action/service/library item/movie file/episode file/resolved title. All actions execute unless callers explicitly send `dryRun:true`.

Plex destruction rejects fuzzy/ambiguous media/file targets and rederives the destructive token plan. Pending comments block rework. Dispatch retains private clients per exact configured server/token identity; client-scoped active and snapshot guards therefore protect sequential and concurrent tool calls without one account blocking another. Accepted media work followed by comment failure returns safe local partial-mutation guidance. Guards do not survive server reconstruction/restart, and token rotation creates a distinct configured identity. Process-local maps, metrics and tokens are not durable audit records or cross-process locks. Async upstream commands and separate comment writes can produce partial outcomes; callers must inspect returned detail and read back affected systems before retries or success claims.

## Library, proposals and durable authority

The 32 registered tools retain the prior 20 names and add five library reads, four approval/monitoring tools and three retention tools. Plex/Jellyfin discovery adds credential-free `mediaServers` metadata; reachability remains unknown until an explicit read. Read-only ARR library intelligence/calendars accept reviewed v3 only, including adapter policy verification. New season/file/monitoring mutations reject `auto`/strict v5 rather than selecting a fallback. Existing Sonarr operations retain the separate route map above.

Exact external provider IDs and episode coordinates join ARR targets to explicit viewers; title matches never establish deletion identity. Ratings preserve source/scale/votes; optional TMDB review text is untrusted display data, not evaluator input. Jellyfin summaries are not event history. Plex summaries require explicit per-user tokens and report favourites/watchlist as unsupported, not false. Rule `allowUnsupportedFavourites` defaults false; explicit opt-in acknowledges only this unsupported protection. Current `watchState:"unwatched"` is not historical never-watched proof. Ended-series/episode/file evidence is required for season cleanup.

Pure evaluation uses explicit snapshots/rules/evaluation times, sorts by literal service/item/season identity and enforces count/byte bounds. Network readers can change between evaluations; deterministic logic does not freeze upstream state. New rules start disabled; immutable revisions use optimistic `expectedVersion`, and enabled due intervals are reserved before evaluation. Failed attempts consume their interval; unresolved reserved attempts block later due runs across revisions. Cadence follows the rule ID across versions; manual evaluation does not advance it. Rules are local configuration, not deletion authority.

`request_approval` re-reads the exact operation and stores a credential-free immutable manifest binding arguments, targets/evidence, configured-instance fingerprints and any rule context. Optional webhook notification carries signed yes/no references. A separate trusted adapter authenticates an allowlisted human and signs the raw decision callback bound to the full request hash/expiry and fresh nonce. MCP exposes request/status/cancel, never decide; neither a delivery acknowledgement nor a model-supplied yes grants approval.

Execution re-derives the manifest, rejects drift and durably claims approved authority before installing a private bounded removal permit. Shared HTTP blocks unauthorized removals (including SABnzbd GET query deletion), preventing internal diagnostics from inheriting deletion consent. Approved removal regenerates process-local preview tokens internally. Durable claim/outcome state survives restart; process-local import/report replay guards remain separate and weaker. Dead executors leave consumed uncertain work, not retryable pending work.

Monitoring/file cleanup verifies monitoring first, then checks exact files/protection and verifies file absence. Multiple writes are not a transaction: a file failure can leave monitoring changed or some files removed. File-size totals are logical estimates, not promised free space. Approved/claimed records and ledger backups must not be edited/restored to replay an action. State lives only under explicit `FLIX_BRIDGE_STATE_DIR`; source credentials remain in environment configuration.

See [provider contracts](library-provider-contracts.md), [approval protocol](approval-protocol.md), [rules and CLI](retention-rules.md), [policy options](retention-policy-options.md) and [migration](retention-migration.md).

## Development and packaging

`npm run dev` runs source through tsx. `npm run build` removes stale `dist/` output before compiling/typechecking; `prepack` rebuilds, and `npm start` runs that build. The published npm executable runs its packaged `dist/index.js`, not an arbitrary local checkout. The package allowlist currently includes dist, README and license, not repository scripts/docs/skills.

Use `npm run build && npm run check && npm test` for runtime changes. Tests use the custom unit runner and Node MCP wire/client/HTTP tests, not Jest/Vitest. Live scripts require a separately authorized stack: `npm run smoke` calls diagnostics with the read-only default in this source and enables debug output; it is not an offline CI gate. For prose-only changes, validate links/examples and compare claims with source; runtime changes still require the full gates.

Before extending the service/config/tool contracts, read the actual interfaces and schemas and obtain required approval under AGENTS.md. Do not copy speculative adapters: adding another media kind requires explicit contract, registry, config, dispatch and test changes.

See [configuration](configuration.md), [safe usage](usage.md), [tool reference](api-reference.md), and [deployable operations/Plex skills](../skills/README.md).
