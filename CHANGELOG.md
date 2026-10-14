# Changelog

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

## [Unreleased]

### 1.0 candidate — not a publication claim
- Serve current MCP `2026-07-28` and legacy stdio through SDK 2.3.1, with a modern version guard, matching structured/text envelopes, strict tool arguments, conservative mutation annotations, bounded admission and request cancellation.
- Select Sonarr API policy per instance: omitted legacy v3, verified explicit `3`/`5`, or reviewed `auto` routes. Preserve reverse-proxy prefixes and freeze workflow family; never replay writes across families.
- Add read-only `library_statistics` for Sonarr API v5. Retain the existing 19 tool names/required inputs; unsupported legacy/Radarr statistics performs no library scan.
- Expose offline configured Sonarr policy in `list_services` and advertised/verified/effective-operation metadata in `system_status`. Removal, import issues, file deletion and auto-fix remain v3; strict v5 blocks them before writes.
- Bind manual imports to exact media/download/path scope, refresh fingerprints before submission and require completed command, complete queue absence and changed library-file IDs. Retain legacy failed status/counts with additive pending evidence; guards are process-local, not restart-safe journals.
- Keep diagnostics read-only by default. Preserve aggregate errors, observed counts and truncated coverage; reject incomplete/ambiguous snapshots. Refresh ARR deletion targets, reject consequential drift and require queue/library absence readback, including DELETE 404. Fresh manual-review warnings block import admission.
- Require unique exact Plex destructive targets and rederived token plans; label submitted work Pending. Retained configured-account clients preserve active/snapshot guards across tool calls and safe partial-mutation diagnostics across serialization. Restart/token-rotation limits remain; media and comment outcomes are separate.
- Reject mutation redirects before resend, isolate cancelled Sonarr discovery/probes from siblings, clean stale build output before packaging and isolate stdio test processes from operator configuration.
- Reconcile public configuration, transport, safety, migration and rollback docs; replace stale contribution scaffolding with operational constraints. Keep sanitized examples and upstream support link.
- Keep CI verification-only on Node 20/22/24 (engine minimum 20.0.0). Final artifact review, live authorization and publication approval remain separate; local/offline checks do not prove playback or production compatibility.

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

