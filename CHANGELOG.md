# Changelog

## [1.0.0] - 2026-10-15

### Added

- Per-instance Sonarr API policy: omit the setting for legacy v3 without discovery, pin `3` or `5` for verified strict routing, or select `auto` for reviewed per-operation routes. Authenticated discovery distinguishes the application version, advertised API families and status-verified families.
- Offline `list_services` policy metadata and `system_status.data.api` effective-operation metadata, so callers can see which family an operation will use rather than infer it from the installed Sonarr version.
- Read-only `library_statistics` for Sonarr API v5. This is the twentieth tool; the existing 19 names and required inputs remain intact. Unsupported legacy/Radarr statistics fails without scanning the library.
- Sonarr v5 adapters for plural queue episode/season identities, progress, nested release search/grab resources, endpoint-specific subresources, manual-import preview/reprocessing, history-since, quality-profile round trips, and lookup-derived language/season-type fields when adding series.
- Current MCP `2026-07-28` and legacy stdio serving through the split SDK 2.3.1 packages, with real-client and installed-command compatibility tests.

### Changed

- Node.js 20.0.0 is the runtime minimum; verification CI covers current Node 20.x, 22.x and 24.x. SDK declaration checks remain strict.
- Tool inputs reject unknown fields and validate literal IDs and bounds. Structured and text output share the same validated envelope; annotations distinguish read-only tools from possible mutations.
- MCP admission is bounded to four active requests and sixteen queued requests. Request cancellation reaches HTTP requests, response-body reads and adapter verification delays; EOF stops the server's pending work.
- Diagnostics remain read-only unless auto-fix is explicitly requested. Aggregate outputs retain successful slices, errors, observed counts and truncation instead of presenting incomplete coverage as a healthy empty stack.
- Manual imports require exact media/episode/download/contained-path scope, fresh candidate fingerprints, no manual-review warning, completed command status, complete queue absence and changed positive library-file identity before reporting verified success. Unverified/pending imports retain downloads; legacy failed status/counts remain alongside additive pending evidence.
- ARR queue and library removal refresh consequential identity, path and review state immediately before deletion, reject drift, and independently verify absence. A DELETE acknowledgement or 404 alone is not a successful removal.
- Downloader removal requires affirmative acknowledgement and a complete exact-ID readback. Linked cleanup follows only successfully removed associated ARR targets.
- Plex remediation requires unique exact destructive targets and rederived confirmation plans. Configured-account clients retain active/snapshot replay ownership across tool calls; submitted media work is labelled Pending, and media/comment outcomes are verified separately.

### Fixed

- Preserved reverse-proxy URL prefixes and Sonarr's scalar DELETE query flags, including explicit false values; Radarr keeps its own query encoding.
- Rejected mutation redirects before resend, including same-origin redirects into another API family. Frozen workflow routes never retry mutations across families.
- Isolated cancellable Sonarr discovery and family probes so cancelling one caller does not cancel its sibling; retained completed per-instance caching and signal-free deduplication.
- Blocked mapping remediation when fresh queue evidence requires manual investigation, including newly discovered sample warnings.
- Preserved safe locally constructed partial-mutation guidance through the actual tool-result serializer without exposing raw provider errors, and prevented unchanged Plex reports from replaying accepted work across tool calls/account switches.
- Preserved downloader failures and partial/truncated queue coverage in global download status.
- Read SABnzbd status from the documented nested queue response, MB totals from `mb`/`mbleft` and actual KB/s from `kbpersec`, rather than download counters, formatted display sizes or percentage limits. Reject advertised total-slot mismatches before status aggregation or destructive preflight/readback.
- Cleaned stale generated output before every build/package and fixed installed npm-bin startup. Stdio test children no longer inherit operator service configuration.

### Documentation and release process

- Updated installation, environment-only configuration, API, architecture, migration, safety, recovery and public operational skills against the implemented contracts. Added the pinned Sonarr v3/v5 contract comparison and feature rationale.
- Replaced stale verification attestations with executable test maps, removed obsolete dumps/debug demos and private operational scaffolding from the new public history, and retained sanitized examples and the upstream support link.
- Preserved all 23 historical changelog sections below byte-for-byte. CI now verifies only: automatic version bumps, npm publication, release creation and notifications are removed. A tagged GitHub release does not itself claim npm publication.

### Compatibility and operational limits

- Strict v5 rejects unported `importIssues`, `deleteFile`, `prepareRemoval`, `executeRemoval` and diagnostic auto-fix before writes. `auto` uses advertised/status-verified v3 for those operations. Read-only diagnostics and manual-import preview/execution have reviewed v5 routes.
- Confirmation/import/Plex replay state is process-local, not a durable journal. Restart, server reconstruction, multiple processes or token rotation can create a new lifetime; inspect accepted/pending work before any retry.
- Fresh reads are not atomic compare-and-delete locks. Cancellation/failure does not roll back accepted upstream work, and software rollback cannot restore deleted media.
- Queue/history/report observations are bounded and nontransactional. Discovery, read-only compatibility checks, accepted commands, queue disappearance and Pending comments do not prove every upstream endpoint or playback.
- Minimum Node 20.0.0 compiled-package compatibility is separate from the TypeScript development loader; installed-package checks do not establish a minimum-version source-unit run.

## [0.3.18] - 2026-05-11

- docs: solidify manual import and cron maintenance docs (#8)

## [0.3.17] - 2026-05-11

- Execute manual imports via ARR command

## [0.3.16] - 2026-05-11

- Verify manual import completion

## [0.3.15] - 2026-05-11

- Add guarded manual import remediation

## [0.3.14] - 2026-05-11

- Classify manual queue import blockers

## [0.3.13] - 2026-05-11

- Classify not-an-upgrade queue items as safe downgrades

## [0.3.11] - 2026-05-11

- Improve queue diagnostics detail
- fix: resolve npm audit findings
- fix: normalize nullable queue fields
- fix: type parsed queue diagnostics records
- Merge pull request #2 from thesammykins/fix/rich-queue-diagnostics

## [0.3.9] - 2026-05-04

## [0.3.7] - 2026-05-04

- fix(ci): use OIDC-ready npm publish flow

## [0.3.6] - 2026-05-04

- fix(ci): resolve lint and npm audit failures

## [0.3.4] - 2025-08-23

- Refactor the way we do environment variables to be slug-based and not rely on random config files, should be almost infinitely scalable now. Also added a RULE.md for providing to an LLM so it's got an understanding of how to call and use the tool

## [0.2.10] - 2025-08-23

- fix: support both flat and nested env mapping formats

## [0.2.9] - 2025-08-23

- fixing github actions AGAIN

## [0.2.8] - 2025-08-23

- fixing env vars not importing

## [0.2.7] - 2025-08-23

- fix: correct MCP server initialization and capabilities declaration
- fix: server now properly responds to initialize requests from MCP clients
- verify: both config.json and FLIX_BRIDGE_ENV_MAPPING configurations work correctly

## [0.2.6] - 2025-08-23

- docs: add global installation option and fix npx usage examples

## [0.2.5] - 2025-08-23

- fixing npm package lacking a  variable in it's json

## [0.2.4] - 2025-08-23

- docs: improve README with npm package links and usage examples

## [0.2.3] - 2025-08-23

- updating tool calls and documentation

## [0.2.2] - 2025-08-23

- Update README.md

## [0.2.1] - 2025-08-23

- Update README.md

## [0.2.0] - 2025-08-23

- feat: optimize npm package size and publish configuration

## [0.1.1] - 2025-08-23

- docs: Reorganize documentation and rebrand to Flix-Bridge
- Update files
- Update README and package.json, Setup Github Actions workflow to package automatically
- Fix smoke.ts failing when running tests in Actions

