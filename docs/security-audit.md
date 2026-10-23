# Security boundaries and release evidence

This is a source-based limitations reference for the **1.1.0 candidate**, not a security
certification or release approval. Offline and authorized read-only checks do not
certify live mutation behavior, every provider endpoint or successful playback.

## Controls and remaining limits

| Boundary | Implemented control | Remaining limit / operator obligation |
| --- | --- | --- |
| Diagnostics | Read-only by default; incomplete snapshots fail; aggregates retain errors/partial data | `autoFix:true` needs authority and can cover more than selected IDs; strict Sonarr v5 does not support auto-fix |
| Import/removal | Import retains its five-minute process-local confirmation flow; every explicit removal additionally requires exact durable human `approvalId` and fresh evidence before one-use claim/HTTP permit | Tokens are not consent or atomic locks. A target can change after its final read; changed material evidence requires new reviewed authority |
| Human approval | Canonical full-plan hash, private durable ledger, fixed expiry, allowlisted actor, authenticated signed callback, nonce/replay checks and claim before removal | Trusted adapter must authenticate actual human identity and bind any yes/no reply to one exact request/hash. A button signature or webhook acknowledgement is not approval. Same-UID/host control can defeat this boundary; no MCP self-approve tool |
| Library cleanup | Explicit users, exact provider/episode/file joins, session/protection checks, verified unmonitoring before file deletion, exact absence readback | Reviewed v3 only; new mutations reject auto/strict v5. Season cleanup currently ended-series only. Separate writes can leave monitoring changed/partial deletion; no rollback or guaranteed recovered bytes |
| Watch/provider limits | Unknown/partial/errors block recommendations; source/scale/votes retained, review text non-executable | Jellyfin summaries are not event history. Plex requires per-user token bindings; unsupported favourites need explicit `allowUnsupportedFavourites:true`, default false. Current unwatched is not never-watched history; an unavailable read is not waivable unsupported capability |
| Rules/scheduling | Disabled-by-default immutable revisions, explicit evaluation times, deterministic bounds and durable due reservations | Opt-in external scheduling evaluates/requests only, never approves/deletes; evaluation time is not an upstream lock. No schedule/listener installed automatically. State is private local operational data, not credential storage |
| Manual import | Unique unrejected candidate bound to exact media/episode set, contained path and download ID; refreshed fingerprint before submission; completed command, complete queue absence and changed library-file IDs | Command status is read once, queue polling is bounded. Pending remains legacy failed with additive pending evidence. No durable replay journal/background completion monitor; retain downloads and inspect existing work after timeout/restart |
| Queue/library deletion | Complete queue or successful full-library absence readback, including DELETE 404; explicit false side-effect flags | A write may happen before readback fails. File deletion in composite Plex workflows has different verification semantics; inspect affected systems separately |
| SABnzbd removal | Affirmative acknowledgement and complete unique-ID queue readback; displayed and advertised-total slot mismatches fail | Status reads the nested queue contract; totals/rates use numeric `mb`/`mbleft`/`kbpersec`, not formatted display sizes or speed-limit percentages. Review delete-data and linked-cleanup scope separately; no blanket authority to discard |
| Combined status | ARR and named downloader failures and partial ARR pages surfaced as incomplete/partial results; observed item count and truncation retained | Partial status-category counts describe observed items only. Snapshots are not transactional across services. No configured downloader can yield null without an error |
| Plex remediation | Unique exact destructive target/file ownership, rederived concrete token plan (ten-minute expiry), retained configured-account clients with active/snapshot guards across tool calls; trusted safe partial-mutation guidance | Report/comment coverage is bounded; guards do not persist across restart/server reconstruction. Token rotation creates a distinct configured identity. Failed comments can follow accepted media actions. Read both systems separately; no playback proof |
| Profile changes/add/search | Profile GET/PUT/readback; v5 add validates exact TVDB lookup metadata before POST | No token gate. Full-object updates are nontransactional; add/search acceptance is not download completion. Partial mutations are not rolled back |
| Sonarr compatibility | Per-instance discovery/status verification for explicit policies, reviewed operation maps, frozen workflow families and URL prefixes | Omission intentionally does not discover. Status verification is not endpoint-wide certification. Removal/import issues/file deletion/auto-fix remain v3; strict v5 blocks them. No write replay on downgrade |
| HTTP/cancellation | Shared time/body limits, bounded same-origin GET/HEAD redirects, mutation redirects rejected before resend, cancellation through HTTP/body reads/delays and sibling-isolated Sonarr discovery/probes | Cancellation is not rollback. Cancelable cold probes trade in-flight deduplication for independent lifetimes. No blanket SSRF/DNS-rebinding protection. HTTP allowed; operator controls endpoint trust and network isolation |
| Inputs/outputs | Advertised required fields, unknown-argument rejection, bounded strings/arrays/safe integer IDs; normalized errors and matching structured/text envelopes | Redaction is not universal: paths, IDs, titles and personal report text can remain. Review debug logs and outputs before sharing |
| Publication | CI verifies only, Node 20/22/24; package version read from metadata | No automatic publication or release approval. npm membership does not sanitize the public Git tree/history |

## Durable state and recovery limits

`FLIX_BRIDGE_STATE_DIR` is explicitly selected private local storage for rule revisions/attempts and approval/decision/execution records. Source URLs/credentials remain environment-only; optional webhook signing secrets stay outside the agent/model surface. Approval ledger ownership/modes, symlinks, schema and hashes are checked; operators must also protect rule directories and backups. Local filesystem/UID/host trust is assumed, not a distributed or hostile same-UID security boundary.

A dead claimed executor becomes consumed `uncertain`; do not renew, edit, delete or restore old ledger records to repeat it. Inspect exact upstream state first. Notification failures remain pending and are not automatically retried; a returned `ok:true` request is not human consent. Material plan drift invalidates matching approval. Partial/uncertain results must not be flattened into success or automatic retry.

Software downgrade can restore weaker token-only removal; disable destructive callers/schedules first. Rollback cannot restore deleted files or undo searches, adds, comments or monitoring. See [approval protocol](approval-protocol.md), [provider contracts](library-provider-contracts.md), [rules/CLI](retention-rules.md), [policy options](retention-policy-options.md) and [migration](retention-migration.md).

## Compatibility evidence is bounded

MCP SDK 2.4.0 serves current `2026-07-28` and legacy stdio; a modern per-request guard
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
