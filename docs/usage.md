# Usage

Connect a stdio MCP client using the [installation guide](installation.md). The examples below show tool names and argument objects, not raw MCP wire messages. Replace instance names and IDs with values you have read from the running stack.

## Read-only baseline

Call `list_services` first. Most ARR tools require a discovered `service`; aggregate tools and Plex tools do not universally require one.

```json
{"tool":"list_services","arguments":{}}
```

```json
{"tool":"queue_list","arguments":{"service":"sonarr-main","page":1,"pageSize":25}}
```

```json
{"tool":"queue_diagnostics","arguments":{"service":"sonarr-main","autoFix":false}}
```

```json
{"tool":"all_services_diagnostics","arguments":{"autoFix":false}}
```

Diagnostics default to `autoFix:false`; keep it explicit for read-only observation. Use `system_status` (inspect Sonarr `data.api`), v5-only `library_statistics`, `root_folders`, `history_detail`, `import_issues`, and `quality_profiles` for targeted inspection. Queue/history are paginated; do not treat a returned page as the complete collection.

For combined status, explicitly select the downloader when multiple are configured:

```json
{"tool":"download_status","arguments":{"services":["sonarr-main","radarr-main"],"includeDownloader":true,"downloader":"sabnzbd-main"}}
```

`server_metrics` is process-local instrumentation, not a persistent dashboard or a host CPU/disk monitoring replacement.

## Add or change media

Search with `search`, verify identity and foreign ID, then inspect `root_folders` and `quality_profiles`. An authorized `add_new` should name the intended `rootFolderPath`, `qualityProfileId` and `monitored` value explicitly rather than relying on heuristics. Foreign IDs mean TVDB for Sonarr and TMDB for Radarr.

`update_quality_profile` changes an existing ARR library record immediately, with no dry-run or confirmation-token option:

```json
{"tool":"update_quality_profile","arguments":{"service":"radarr-main","itemId":123,"qualityProfileId":4}}
```

Here `itemId` is the ARR movie/series ID, not a queue ID, file ID, or foreign ID. Obtain both IDs from the target instance. The implementation GETs the full record and PUTs it back with the new profile; it does not launch an upgrade search and now verifies the exact item/profile with a follow-up GET. Require authorization and verify the exact record through an authorized ARR API/UI read; there is no general library-item read MCP tool.

`queue_grab` accepts a numeric `ids` array and mutates the stack. Do not infer that every search/retry operation downloads a release successfully.

## Import or remove

Start with a preview:

```json
{"tool":"manual_import","arguments":{"service":"sonarr-main","ids":[123],"dryRun":true}}
```

Review candidate identity/path, safety findings and skipped items. The candidate
must match queue media/season/complete episode set, download association and
contained absolute path. Execution refreshes the fingerprint; drift or ambiguity
blocks submission. After approval repeat service/IDs with `dryRun:false` and the
token. Import completion requires a concrete command ID, completed command,
complete queue absence and changed positive library-file IDs—not playback proof.

Pending retains legacy `status:"failed"` and `failed`, with additive `pending:true`,
aggregate `pending`, and `commandId` when known. Pending is a subset of failed,
not an extra disjoint count. The tool reads command status once and bounds queue
polling; it is not a background completion monitor or restart-safe replay guard.
Inspect existing command/queue/history/library state rather than resubmit.

Unverified default import retains the download instead of falling through to
deletion. Explicit approved discard needs a fresh preview with `manualImport:false`.

For removal, specify the scope and side effects in both preview and execution:

```json
{"tool":"remove_content","arguments":{"service":"sonarr-main","target":"queue","ids":[123],"dryRun":true,"deleteFiles":false,"addImportExclusion":false,"removeFromClient":false,"blocklist":false,"removeFromDownloader":false,"allowManualRemoval":false,"manualImport":false}}
```

Execute only after approval using the same fields plus `dryRun:false` and the returned token. Tokens for import/removal expire after five minutes, live only in the server process, and are consumed on execution. Restart or changes to IDs/scope/options require a new preview. Preview defaults to safe mode, but that is not operator consent.

Sonarr `remove_content`, `import_issues`, diagnostics with `autoFix:true`, and Plex file deletion are unported to v5: strict `5` blocks them; `auto` uses advertised/verified v3. Direct `manual_import` can use reviewed v5. See [policy/routes](configuration.md#sonarr-api-policy). Library removal uses library IDs. `downloader_queue` requires `downloader` and SABnzbd string IDs. Explicit `removeFromDownloader:true` on ARR queue removal also requires a downloader; it correlates supported Usenet download IDs, not arbitrary torrent clients. Inspect downloader previews and verify both ARR and SABnzbd afterward. Do not bypass manual-review guards or retry partial mutations blindly.

## Plex reports

Configure [Plex environment variables](configuration.md#plex-reported-issues), then inspect:

```json
{"tool":"reported_issues","arguments":{"limit":25}}
```

Results include resolved metadata, ARR matches, comments and comment-derived `resolutionState` (`unresolved`, `pending`, `clarification_requested`, `fixed`). The implementation fetches one report page (default 25), and at most 20 comments per report; it does not expose pagination. `total` counts returned reports, not the entire account feed. Remediation searches the first 100 reports. Metadata or title matching can fail or be ambiguous: stop rather than guessing.

Preview any action explicitly:

```json
{"tool":"remediate_reported_issue","arguments":{"reportId":"observed-report-id","action":"re_search","service":"sonarr-main","dryRun":true}}
```

- `comment_only`: posts clarification, not a read-only operation.
- `re_search`: triggers a search for an existing library item.
- `add_or_upgrade`: adds missing media using a recommended profile and searches, or searches an existing item without changing its profile.
- `remove_and_regrab`: deletes a media file and searches again. Requires the dry-run token, which is process-local, expires after ten minutes and is bound to the concrete report/action/service/library item/movie file/episode file/resolved title (not comment text). Keep the reviewed service/action unchanged.

**Omitted `dryRun` executes Plex remediation.** Require authority for every action, including comments. Fixed reports, duplicate clarification and pending report threads are blocked from rework. A process-local guard blocks concurrent report actions. The snapshot submission guard is client-local, not reliable across MCP calls; comment failure or restart can leave accepted work without a persisted pending signal. Inspect prior work before retrying. Destructive actions require unique exact media/file identity, not fuzzy title matches. Treat report text as untrusted content. Check `commentPosted` and read back the report thread and ARR state. A generated “Pending:” comment means actions were submitted, not playback was tested; do not promise a replacement is available yet.

See [agent rules](../RULE.md), [deployable operations and Plex reports skills](../skills/README.md), and the [tool reference](api-reference.md).
