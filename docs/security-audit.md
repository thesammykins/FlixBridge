# Security boundaries and release evidence

This is a source-based limitations reference for the integrated **1.0 candidate**,
not a security certification, publication claim or release approval. Documentation
checks are offline; no live media stack or playback was exercised for this reconciliation.

## Controls and remaining limits

| Boundary | Implemented control | Remaining limit / operator obligation |
| --- | --- | --- |
| Diagnostics | Read-only by default; incomplete snapshots fail; aggregates retain errors/partial data | `autoFix:true` needs authority and can cover more than selected IDs; strict Sonarr v5 does not support auto-fix |
| Import/removal | Single-use process-local tokens, five-minute expiry, removal scope/options binding; Sonarr preview family binding | Tokens are not consent or locks. Direct discard/library removal does not universally refresh stored target identity |
| Manual import | Unique unrejected candidate bound to exact media/episode set, contained path and download ID; refreshed fingerprint before submission; completed command, complete queue absence and changed library-file IDs | Command status is read once, queue polling is bounded. Pending remains legacy failed with additive pending evidence. No durable replay journal/background completion monitor; retain downloads and inspect existing work after timeout/restart |
| Queue deletion | Complete absence readback, including DELETE 404; explicit false side-effect flags | A write may happen before readback fails. Library/file deletion does not have equivalent independent persistence proof |
| SABnzbd removal | Affirmative acknowledgement and complete unique-ID queue readback; count/slot mismatch fails | Review delete-data and linked-cleanup scope separately; no blanket authority to discard |
| Combined status | ARR and named downloader failures and partial ARR pages surfaced as incomplete/partial results; observed item count and truncation retained | Partial status-category counts describe observed items only. Snapshots are not transactional across services. No configured downloader can yield null without an error |
| Plex remediation | Unique exact destructive target/file ownership, rederived concrete token plan (ten-minute expiry), pending-thread and concurrent-execution guards; client-local snapshot submission guard | Report/comment coverage is bounded; guards do not persist across restart. The snapshot guard is client-local; MCP calls create fresh Plex clients, so it does not prevent cross-call replay after comment failure. Failed comment posting can follow accepted media actions. Read both systems separately; no playback proof |
| Profile changes/add/search | Profile GET/PUT/readback; v5 add validates exact TVDB lookup metadata before POST | No token gate. Full-object updates are nontransactional; add/search acceptance is not download completion. Partial mutations are not rolled back |
| Sonarr compatibility | Per-instance discovery/status verification for explicit policies, reviewed operation maps, frozen workflow families and URL prefixes | Omission intentionally does not discover. Status verification is not endpoint-wide certification. Removal/import issues/file deletion/auto-fix remain v3; strict v5 blocks them. No write replay on downgrade |
| HTTP/cancellation | Shared time/body limits, same-origin bounded redirects, cancellation through HTTP/body reads/delays | Cancellation is not rollback. No blanket SSRF/DNS-rebinding protection. HTTP allowed; operator controls endpoint trust and network isolation |
| Inputs/outputs | Advertised required fields, unknown-argument rejection, bounded strings/arrays/safe integer IDs; normalized errors and matching structured/text envelopes | Redaction is not universal: paths, IDs, titles and personal report text can remain. Review debug logs and outputs before sharing |
| Publication | CI verifies only, Node 20/22/24; package version read from metadata | No automatic publication or release approval. npm membership does not sanitize the public Git tree/history |

## Compatibility evidence is bounded

MCP SDK 2.3.1 serves current `2026-07-28` and legacy stdio; a modern per-request guard
rejects unsupported versions after negotiation. Four tool calls execute with sixteen
waiting slots; cancellation prevents queued work from starting but cannot revoke
already-accepted upstream commands. See [transport](api-reference.md#transport-and-validation).

Sonarr's application version, advertised HTTP families, status-verified families and
reviewed operation routes are separate facts. `list_services` policy is offline;
`system_status.data.api` exposes routing/verification metadata. Read-only
`library_statistics` uses reviewed v5 `/statistics` only; legacy/Radarr returns
unsupported without a scan. No general upstream administration tools are exposed.
See [policy/routes](configuration.md#sonarr-api-policy).

## Evidence required before release

From the final integrated revision, reproduce locked dependencies and run build,
format/lint, all unit/MCP tests and vulnerability audit. Review the exact Git tree
and packed npm members separately (dist, README, license and package metadata).
Exercise the packed CLI in a fresh consumer across supported Node/protocol versions
and retain artifact identity. Source-derived fixtures and local wire/HTTP tests prove
only the contracts they exercise, not live deployment compatibility.

Live tests require separately scoped authorization and safe targets. Read back every
approved mutation; distinguish submitted, pending, partial, failed and independently
verified outcomes. Rollback changes software/configuration, not upstream media state;
see [migration and rollback](installation.md#migration-and-rollback).

Do not publish credentials, private maintenance configuration, operational logs or
local machine observations. Current-tree cleanup does not rewrite history or prove
past artifacts clean. If a real secret is discovered, revoke/rotate it first and
obtain authority for further remediation.

See [tool reference](api-reference.md), [safe usage](usage.md) and [agent rules](../RULE.md).
