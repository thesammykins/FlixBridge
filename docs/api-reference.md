# API reference

This reference describes the working source in `src/index.ts`, `src/services/shared.ts`, `src/services/downloaders/sabnzbd.ts` and `src/services/plex/`. Installed releases may differ: discover their actual schemas. Call `list_services` first and use exact returned names. Examples are illustrative inputs, not results from a live stack.

This reference describes the 1.1.0 source candidate: 32 tools, retaining all 20 existing names and adding 12. Removal execution now requires authenticated human `approvalId` authority; preserving names does not preserve the older token-only execution contract. GitHub release assets, npm registry versions and live-provider compatibility are separate concerns. See [Sonarr per-instance policy and reviewed routes](configuration.md#sonarr-api-policy); no general upstream administration tools are exposed.

## Transport and validation

MCP `tools/call` returns the same `{ok,data?,error?}` envelope in `structuredContent` and JSON `content[].text`; outer `ok:false` sets `isError:true`. Known-tool argument validation errors use a failed envelope; unknown tools/methods and malformed wire requests can be protocol errors. Unexpected internal failures return a generic MCP error. Aggregates can return `ok:false` **with useful partial data**. Per-item operations may have outer `ok:true` despite `failed`/`skipped` entries; inspect details, not transport success. Neither `service` nor `mediaKind` is universal. Errors may be service errors (`service`, `status`, `message`, optional `code`) or internal errors (`kind:"internal"`, `message`). Do not depend on an invented universal error-code enum.

The MCP boundary enforces advertised required fields, rejects unknown arguments and uses bounded Zod validation:

- Numeric IDs, `page`, `foreignId`, `itemId`, `qualityProfileId` are positive safe integers. ARR string IDs accepted by `remove_content` must match `^[1-9]\d*$`; use numeric IDs for advertised ARR inputs. No fractions, zero, negative values, whitespace or repaired identifiers.
- `ids`: nonempty, at most 1000 entries; string entries are 1–256 characters. `pageSize` and `limit`: positive integers, at most 1000. `services`: at most 100 names of 1–256 characters.
- Other input strings are nonempty and at most 4096 characters. `queueTimeoutMs`: integer 1000–60000.
- Only the tool’s advertised fields are accepted at the MCP boundary. Additional scope/confirmation checks apply at dispatch. Send documented fields rather than internal option names.

The runtime uses SDK `@modelcontextprotocol/server` 2.4.0 `serveStdio` with legacy
serving enabled. Current MCP `2026-07-28` uses modern discovery/per-request protocol
metadata, without requiring legacy `initialize`; a version guard rejects unsupported
modern versions even after a supported request. Legacy initialization supports
`2024-10-07`, `2024-11-05`, `2025-03-26`, `2025-06-18` and `2025-11-25`.
No MCP HTTP transport or streaming/task workflow is exposed. The optional approval callback bridge is a separate loopback HTTP process, not an MCP transport.

At most four tool calls execute concurrently, with sixteen waiting slots. Queue
saturation fails rather than starting more work. Cancellation removes waiting work
and propagates to active HTTP/body reads and verification delays; it does not undo
an accepted upstream write. Inspect exact state before retrying cancelled work.
Tool annotations are conservative for conditional mutations: diagnostics/import/
removal remain write-capable even when preview/read-only flags are used.

Optional means omission is permitted, **not** that the tool is read-only. All mutations require operator authority; tokens do not grant consent.

## Tool inventory

The following inventory is counted from the registered source definitions: **32 tools** (20 existing, 12 additions).

| Tool | Contract |
| --- | --- |
| `list_services` | Discover ARR, downloader and media-server identities/capabilities |
| `system_status` | Read one ARR or media-server status |
| `queue_list` | Read ARR queue |
| `queue_grab` | Submit authorized retry/grab |
| `remove_content` | Preview or human-approved queue/title/downloader/season/file removal |
| `manual_import` | Preview or confirmation-token import |
| `root_folders` | Read ARR root folders |
| `history_detail` | Read ARR download/import history (not playback) |
| `search` | Read media lookup |
| `add_new` | Add authorized ARR media |
| `import_issues` | Read bounded import issue summary |
| `quality_profiles` | Read profiles and usage |
| `queue_diagnostics` | Inspect; optional authorized non-removal auto-fix |
| `all_services_diagnostics` | Aggregate diagnostics; optional authorized non-removal auto-fix |
| `download_status` | Read combined download status/coverage |
| `server_metrics` | Read process-local metrics |
| `reported_issues` | Read Plex account reports/comments |
| `remediate_reported_issue` | Preview or authorized remediation; removal requires approvalId |
| `update_quality_profile` | Authorized profile update/readback |
| `library_statistics` | Read Sonarr v5 statistics only |
| `library_list` | Read ARR/media libraries or media users |
| `media_detail` | Read exact ARR detail/ratings; optional TMDB reviews |
| `watch_status` | Read explicit per-viewer summary/session/protection evidence |
| `watch_history` | Read Plex playback events; Jellyfin explicitly unsupported |
| `upcoming_media` | Read bounded ARR calendar |
| `request_approval` | Create/deduplicate exact durable human-decision request |
| `approval_status` | Read approval/execution state; never grants approval |
| `cancel_approval` | Cancel pending/approved request |
| `update_monitoring` | Preview or human-approved monitoring change |
| `cleanup_candidates` | Read deterministic bounded cleanup proposals |
| `retention_rules` | List/get/create/revise local rule state |
| `retention_evaluate` | Evaluate an exact stored rule revision; proposes only |


### list_services

Input `{}`. Read-only. Output `data.services:[{name,type,apiPolicy?}]`, with `type` from adapter identity and Sonarr-only offline `apiPolicy:"legacy"|3|5|"auto"` (no upstream discovery), `downloaders:[{name,type:"sabnzbd"}]`, `summary:{totalServices,totalDownloaders}`. `data.mediaServers` additionally lists Plex/Jellyfin names, types, configured state, unknown reachability and capabilities without credentials. Offline discovery is not a successful remote read.

### system_status

Required `service:string`. ARR output `{service,name,version,isHealthy}`. Media-server names route to their status reader, exposing configuration/reachability separately; a failed or malformed response is not an offline/healthy assertion. `isHealthy:true` means a valid status response, not a comprehensive upstream health audit. The current mapper does not return `startTime`. Sonarr adds `api:{configuredPolicy,current?,deprecated,verifiedFamilies,effectiveOperations}`. Advertised families, status-verified families and effective per-operation routes are distinct; this is not a full capability audit.

### library_statistics

Required `service:string`. Read-only, Sonarr API v5 only: GET `/api/v5/statistics`
(with configured base path), using explicit `5` or reviewed v5 `auto` routing.
Output `{service,apiFamily:5,statistics}`. The validated statistics object includes
series/season/episode/file counts, `sizeOnDisk`, and `qualityProfileStatistics`,
`qualityStatistics`, `tagStatistics` arrays. Counts must be nonnegative safe integers;
malformed/null responses fail, never synthesize zero totals.

Unsupported on Radarr, omitted/explicit `3`, or a v3-only `auto` instance. There is
no legacy library scan/fallback and no statistics mutation. Discovery/status probes
may precede the read for opted-in Sonarr policies; statistics is not playback proof.

```json
{"service":"sonarr-main"}
```

### queue_list

Required `service:string`; optional `page:number`, `pageSize:number`. Omitted pagination is delegated to ARR; FlixBridge does not apply a universal 25-item default.

Output `{service,mediaKind,total,items,truncated}`. Items contain `id,title,status,mediaKind` and optional `progressPct,protocol,estimatedCompletionTime,downloadId,outputPath,downloadClient,trackedDownloadState,trackedDownloadStatus,statusMessages,errorMessage`. Status messages retain upstream title/message/messages fields. `total` uses upstream `totalRecords` when supplied. `truncated:true` includes missing totals, a returned-record count different from total, or a page other than 1. Paginate and deduplicate for complete coverage; a page cannot prove absence elsewhere.

```json
{"service":"sonarr-main","page":1,"pageSize":100}
```

### queue_grab

Required `service:string`, `ids:number[]`. Immediate mutation with no preview/token. Uses single or bulk ARR queue grab. Output `{service,mediaKind,grabbed,ids}` counts submitted IDs, not completed downloads. Verify exact queue/history state before retrying.

### remove_content

Advertised required field: `ids:(number|string)[]`. Runtime scope requires `service` for ARR or `downloader` for `downloader_queue`.

| Input | Default / meaning |
| --- | --- |
| `service:string` | Required for ARR queue/library scopes |
| `downloader:string` | Required for downloader scope or linked cleanup |
| `target:string` | `queue`; inferred `downloader_queue` when downloader supplied without service; enum `queue`, `library`, `downloader_queue`, `season`, `files` |
| `ids:(number|string)[]` | Required; ARR positive integers, SABnzbd exact string IDs |
| `dryRun:boolean` | `true` |
| `confirmationToken:string` | Legacy preview mechanic; regenerated internally during approved removal, not human authority |
| `approvalId:string` | UUID required for every `dryRun:false` removal, including queue/downloader scopes |
| `itemId:number` | Exact ARR title required for `files`; `ids` are then file IDs |
| `seasonNumbers:number[]` | Nonnegative exact seasons for `season`; `ids:[seriesId]` identifies one series |
| `users:{server,userId}[]` | Explicit unique viewers for season/file cleanup and whole-title removal with `deleteFiles:true` |
| `allowUnsupportedFavourites:boolean` | Default false; explicit unsupported-capability opt-in, not an unavailable-data override |
| `watchedPolicy:string` | `all-selected` (default) or `any-selected`; used for season watch requirements |
| `retentionRuleId:string`, `retentionRuleVersion:number` | Together bind a still-enabled current rule revision; eligibility and bounds are re-evaluated before approval/execution |
| `deleteFiles:boolean` | `false`; library files or SABnzbd data for downloader cleanup |
| `addImportExclusion:boolean` | `false`; library scope |
| `removeFromClient:boolean` | `true`; ARR queue scope |
| `blocklist:boolean` | `false`; ARR queue scope |
| `removeFromDownloader:boolean` | `false`; linked SABnzbd cleanup for ARR queue |
| `allowManualRemoval:boolean` | `false`; explicit manual-review override |
| `manualImport:boolean` | `true`; attempt safe import before queue removal |
| `queueTimeoutMs:number` | Omitted uses 5000 ms for queue DELETE; valid range 1000–60000 |

ARR preview output includes `mode:"dry_run",service,target,options,preview,confirmationToken,nextAction` and optional `notes,downloader,downloadIds,downloaderPreview`; `removeFromDownloader` is explicit. `preview` contains `service,mediaKind,kind,requestedIds,missingIds,targets,notes?`. Targets include identity, title, source, status/path/download association and manual-review evidence as applicable. Returned `options.attemptManualImport` corresponds to input `manualImport`; it is not an additional input field.

ARR execute output includes `mode:"execute",service,target,result,removeFromDownloader` plus optional downloader/result/preview/notes. `result` contains `service,mediaKind,kind,removed,failed,skipped,missingIds,details,notes?`; detail statuses are `removed` or `failed`. Missing preview IDs are skipped. Outer `ok:false` can accompany per-item results or linked cleanup failure.

Downloader preview output: `mode:"dry_run",scope:"downloader",downloader,deleteData,preview,confirmationToken`. Downloader execute: `mode:"execute",scope:"downloader",downloader,deleteData,result`. Downloader preview contains `downloader,requestedIds,missingIds,items`; items use `nzoId,title,status,progressPct,sizeMB,sizeLeftMB,eta` as mapped. Execute result contains `downloader,removed,failed,missingIds,details`; details use `id,title,status:"removed"|"failed"|"skipped",message?`. Inspect result counts and read back SABnzbd independently.

Import/removal tokens expire after five minutes, are process-local and consumed on execution. ARR removal binds service, target, normalized ID set, all normalized removal options (including timeout), linked downloader name/flag and delete-data flag. Downloader removal binds downloader, normalized IDs and delete-data. Sonarr previews additionally retain the selected API family. Before each ARR deletion, execution refreshes consequential target identity, path/download association and review classification, rejecting drift or unavailable evidence. These checks are not an atomic upstream compare-and-delete lock; scope can still change after the final read.

Failed/unverified default import retains the download rather than falling through to discard. Explicit approved discard requires a fresh preview with `manualImport:false`. Fresh manual-review warnings also block common import admission. Queue deletion success, including DELETE 404, requires absence in a complete readback snapshot; library deletion requires a successful full-library absence readback. A later approved queue ID already absent from a complete snapshot can be counted without another DELETE in explicit-discard mode. Linked cleanup only proceeds for download IDs whose associated ARR targets succeeded; partial results still require inspection.

```json
{"service":"sonarr-main","target":"queue","ids":[123],"dryRun":true,"removeFromClient":false,"blocklist":false,"manualImport":false,"deleteFiles":false,"addImportExclusion":false,"removeFromDownloader":false,"allowManualRemoval":false}
```

For any removal, call `request_approval` with `{tool:"remove_content",arguments:{...exactScopeAndOptions}}`. After a trusted human decision, repeat the unchanged scope/options with `dryRun:false,approvalId:<requestId>`. The server regenerates preview tokens internally, re-reads material evidence and claims the matching durable plan once. A preview token alone fails; do not copy placeholder credentials/tokens.

New `season`/`files` cleanup unmonitors the selected scope, verifies monitoring, deletes exact files and verifies absence; it does not remove the ARR title. `season` requires `deleteFiles:true`, ended-series status and exact selected-episode watched coverage. Use `files` with explicit `deleteFiles:true` to delete files; false/omitted only changes monitoring. Shared files containing out-of-scope episodes are rejected. These operations and `update_monitoring` require reviewed v3; `auto`/strict v5 mutations are blocked, not downgraded. Failure after unmonitoring can leave it changed. Logical removed bytes are not guaranteed recovered disk space. See [migration](retention-migration.md).

### manual_import

Required `service:string`, `ids:number[]`; optional `dryRun:boolean` (default `true`), `confirmationToken:string` (required for execution). There is **no `queueId` input**.

Preview output `{mode:"dry_run",service,preview,confirmationToken,nextAction}`. `preview` contains `service,mediaKind,requestedIds,missingIds,items,summary:{total,safe,unsafe}`. Each item has `id,title,status,downloadId?,path?,candidates,selectedCandidate?,safeToImport,reason`. Candidate previews contain `id,path,seriesId?,movieId?,seasonNumber?,episodeIds,rejectionReasons,request` as applicable. Exactly one unrejected candidate is required, bound to the queue download ID, absolute contained path and exact movie or series/season/complete episode set. Missing scope, traversal, mismatched media/download identity or ambiguous candidates block execution. Previews include a target/candidate fingerprint; unsafe items stay untouched. A safe classification is still not operator consent.

Execute output `{mode:"execute",service,result}` with `result:{service,mediaKind,requestedIds,imported,failed,pending,skipped,results}`; entries have `id,title,status:"imported"|"failed"|"skipped",message?` and additive `pending?,commandId?` when available. Pending entries retain legacy `status:"failed"` and are included in `failed`; `pending` is a subset, not an additional disjoint count. Inspect these counts even if outer `ok:true`.

Tokens bind service and normalized ID set to the stored preview for five minutes. Execution rederives and compares the target/candidate fingerprint before POST `/command` (`ManualImport`, `importMode:auto`); it requires a concrete command ID, completed command readback, complete queue absence and new positive library-file IDs for the mapped movie/episodes. The command is read once; queue-clearance polling is bounded. Accepted/running/unknown outcomes remain failed/unverified with pending evidence and the download retained. A process-local per-download submission guard prevents repeat submission in that adapter; it is not durable across restart and does not poll an existing pending command to completion. Inspect command/queue/library/history rather than resubmit. File identity proof is not playback proof.

```json
{"service":"sonarr-main","ids":[123],"dryRun":true}
```

### root_folders

Required `service:string`. Output `{service,mediaKind,total,folders:[{id,path,freeSpaceBytes}],defaultId}`. The current mapper omits `accessible`; `defaultId` is the first folder ID or fallback 1, not proof a folder exists or is writable.

### history_detail

Required `service:string`; optional `page:number,pageSize:number,since:string`. Pagination defaults are delegated to ARR. `since` is a string, not validated as an ISO date by dispatch. Sonarr v5 uses `/history/since` with `date`, then locally pages the returned array; legacy v3 forwards `since` to `/history`.

Output `{service,mediaKind,total,items,truncated}`; each item includes `id,title,quality,date,eventType,mediaKind`. Provider pages are retained without an extra local 20-item clip; v5 since arrays use the requested local page. `truncated:true` includes non-first pages, missing totals or a declared-total/returned-count mismatch. Positive totals with empty pages never prove no history. History is bounded provider evidence, not a guaranteed complete audit trail or playback history. See [read coverage](read-coverage.md).

### search

Required `service:string,query:string`; optional `limit:number` (default 10). Read-only lookup. Output `{service,mediaKind,total,results,truncated}`; results contain `id,foreignId,title,year?,overview?,mediaKind,imdbId?`. IDs are TVDB for Sonarr, TMDB for Radarr. `total` is the fetched lookup array length; results are clipped to limit.

### add_new

Required `service:string,title:string,foreignId:number`; optional `rootFolderPath:string,qualityProfileId:number,monitored:boolean` (default `true`). Immediate mutation, no preview/token. If omitted, profile is selected by existing library usage then heuristics; root folder is first nonempty configured path. Review those defaults before adding. The add payload disables automatic missing-episode/movie search.

Output `{service,mediaKind,added:true,id?,title,existing:false}`. No `qualityProfile` object is returned, and `existing:false` is not a duplicate-detection guarantee. A POST result is not independent persistence or download verification.

### import_issues

Required `service:string`. Read-only wanted/missing endpoint summary, not a comprehensive failed-import detector. Output `{service,mediaKind,issues,summary:{total,stuckPending,failedImport}}`; issue fields `id,title,reason,ageMinutes`. Exposes at most 10 fetched records; `ageMinutes` and `failedImport` are currently zero placeholders. Do not interpret those zeros as verified health.

### quality_profiles

Required `service:string`. Output `{service,mediaKind,total,profiles,recommended?,recommendedName?,usage,totalLibraryItems}`; profiles contain `id,name,upgradeAllowed?,cutoff?`, usage entries `id,name,count,pct`. Recommendation prefers library usage before naming heuristics and is not enforced policy. Under omitted legacy policy, failed library usage lookup can fall back to heuristics; explicit Sonarr policies fail instead. Choose explicit IDs for authorized changes.

### update_quality_profile

Required `service:string,itemId:number,qualityProfileId:number`. Immediate mutation; no `dryRun` or token. `itemId` is a library movie/series ID. GETs the full object, PUTs the new profile, then GETs exact ID/profile to verify. Output `{service,mediaKind,itemId,qualityProfileId,updated:true}`. Does not search for an upgrade. Readback failure means the write may already have happened.

### queue_diagnostics

Required `service:string`; optional `autoFix:boolean` (default **false**). Read-only unless explicitly enabled; active fixes can retry/import beyond a targeted batch. Not-an-upgrade, ambiguous sample/episode-pack and manual-investigation cases require manual review, not automatic deletion.

Output `{service,mediaKind,totalQueueItems,issuesFound,issuesAnalyzed,fixesAttempted,summary:{fixed,failed,requiresManual}}`. Analyses include identity/status, category `{type,severity,autoFixable}`, message/suggestedAction and normalized upstream evidence. Fixes contain `id,action,reason,attempted,success,error?`.

Uses one queue snapshot requesting 250 entries; missing/mismatched `totalRecords` fails rather than claiming complete diagnostics. Increasing queue size is not automatic pagination. `autoFixable` is a technical classification, never authorization; retry success is command submission, not completed download.

### all_services_diagnostics

Optional `autoFix:boolean` (default **false**). Output `{totalServices,servicesScanned,overallSummary,serviceResults,incomplete,errors}`. Summary includes `totalQueueItems,totalIssuesFound,totalFixed,totalFailed,totalRequiresManual`. `serviceResults` contains successful per-service diagnostic data. `servicesScanned` lists attempted services, not only successes. Failed/thrown reads produce `ok:false,incomplete:true,errors:[{service,error}]` while preserving successful subtotals. No zero/partial clean claim.

```json
{"autoFix":false}
```

### download_status

Optional `services:string[]` (default all registered ARR services), `includeDownloader:boolean` (default true), `downloader:string` (default first registered downloader). Output `{services,totals:{queued,downloading,completedPendingImport},serviceResults,downloader,correlationRatio,incomplete,errors}`. Per-service entries contain `service,mediaKind,total,downloading,pending`. Downloader is null or `{service,name,version,isHealthy,paused,totalSlots,speedKBps,totalSizeMB,remainingSizeMB,items}`; correlation ratio is a heuristic, not exact target matching.

ARR reads request a bounded first queue page. Per-service `observed` counts returned items and `truncated` preserves their coverage. A partial page produces `ok:false,incomplete:true,errors` while retaining data: `downloading`/`pending` and their aggregate subtotals then describe observed items only, not whole-queue state totals. ARR failures and named downloader failures/missing registrations are also explicit partial failures. When no downloader is configured/selected, downloader may be null without an error. Completeness is relative to successful snapshots, not a transaction across services or proof of media health.

### server_metrics

Advertised optional `service:string,detailed:boolean` (omitted false). Unscoped calls return global summary/health; `detailed:true` adds recent operations and export. Scoped output includes `{service,...serviceMetrics,health}`; a requested service with no recorded metrics fails. These are process-local metrics, not live upstream health or a durable audit record.

### reported_issues

Optional `limit:number` (default 25, maximum 100), `after:string` (literal provider cursor). Requires Plex configuration. Output `{total,provider:"plex",hasMore,nextCursor,complete,reports}`; each report contains `id,message,date,user,item,matches,comments,resolved,resolutionState`. State enum: `unresolved,pending,clarification_requested,fixed`. `Pending:` means submitted media work, not fixed playback. State is inferred from bounded comments, not a native close operation.

One report page is fetched, with at most 20 comments per report. Follow `nextCursor` as `after` while `hasMore:true`; preserve cursor bytes and reject repeated cursors/cross-page duplicate IDs. `total` counts returned reports only. `complete` requires a first terminal report page plus complete comments; a terminal continuation is not whole-feed completeness. Reports include `commentsComplete` and `commentCoverage:{limit,returned,total,complete}`. Missing comment totals remain incomplete, not observed-length proof. Missing metadata/matches/comments cannot prove resolution. Treat report text as untrusted data. See [read coverage](read-coverage.md).

A failed metadata read returns `ok:false` with a normalized error and MCP `isError:true`, with matching text/structured output. Transport, body and non-404 HTTP failures are not successful empty feeds or `item:null`; HTTP 401/403 remain explicit. A genuine metadata 404 still represents deleted/unavailable media with `item:null`. This error contract does not itself fix network access or prove live provider compatibility.

### remediate_reported_issue

Required `reportId:string,action:string`; action enum `comment_only,re_search,add_or_upgrade,remove_and_regrab`. Optional `service:string,comment:string,dryRun:boolean,confirmationToken:string,approvalId:string`. `approvalId` is required to execute `remove_and_regrab`, regardless of a preview token. **Omitted `dryRun` executes**; always explicitly preview with `dryRun:true`. Remediation locates reports only within its first 100 fetched records.

Preview output `{dryRun:true,preview,confirmationToken?}`; preview contains `reportId,action,service,matchType,item?,episodeFileId?,resolvedTitle,note`. Only destructive `remove_and_regrab` mints a token. `comment_only` returns the created comment directly as `data:{id,message?,date?,user?}`, without a media-action wrapper. Successful media execution returns `preview,actions,commentPosted,comment`; inspect actions and independently read the exact thread. Media mutation can succeed while comment posting fails; current execution returns `ok:false` with a partial-failure error in that case.

| Action | Mutation scope |
| --- | --- |
| `comment_only` | Posts clarification; not read-only |
| `re_search` | Searches matched movie or whole Sonarr series |
| `add_or_upgrade` | Searches existing media (no profile change); missing media uses lookup/recommended profile/root-folder defaults, adds then searches |
| `remove_and_regrab` | Deletes concrete movie/episode file, then searches; exact durable human `approvalId` required, token refreshed internally |

Destructive tokens are process-local, single-use, ten-minute, bound exactly to report ID/action/service/library item ID/movie file ID/episode file ID/resolved title. Execution rederives that plan; drift fails validation. Comment text is not bound. Destruction requires unique exact movie identity or validated series/episode coordinates and an owned file; fuzzy/ambiguous targets are blocked. Fixed threads, duplicate clarification and pending threads have guards. A process-local execution guard blocks concurrent report actions. MCP dispatch retains a private client per exact configured server/token identity, so snapshot submission and account-scoped active guards apply across tool calls, including accepted media work followed by comment failure. Safe local partial-mutation guidance survives tool-result serialization; provider details are withheld. Token rotation or a new server object creates a distinct identity/lifetime. These supplemental report/import guards are not durable across restart; the new removal approval/claim ledger is durable and independently required. Preserve exact human approval and verify progress before further mutation.

Generated media comments start `Pending:`, not `Fixed:`. Neither a submitted search nor comment-derived state proves playback. Matching/add defaults and partial failures require operator review; do not invent unsupported foreign-ID/profile/file input fields.

## Library, watch and calendar tools

All five new read tools reject unknown fields. `page` is 1..100000 (default 1), `pageSize` 1..250 (default 50), `services` 1..50 exact configured names. Partial aggregate reads may return `ok:true` with `complete:false,errors`; inspect them. New ARR library/calendar readers use reviewed v3 only. Strict v5 or `auto` selecting v5 is unsupported, not a fallback signal. [Provider contracts](library-provider-contracts.md) define joins and coverage.

| Tool | Required | Optional |
| --- | --- | --- |
| `library_list` | none | `scope:"library"\|"users"`, `services`, `query` (substring, max 500), `mediaKind:"series"\|"movie"`, `monitored`, `page`, `pageSize` |
| `media_detail` | `service`, `itemId` (ARR title) | `includeReviews`, `reviewPage` (1..1000) |
| `watch_status` | `service`, `itemId` (ARR title), `users:[{server,userId}]` | `seasonNumber` (nonnegative; 0 means specials) |
| `watch_history` | `server`, `userId` | `page`, `pageSize` |
| `upcoming_media` | none | `services`, `start`, `end` (RFC3339), `page`, `pageSize` |

`library_list` browses ARR and media-server copies, but only exact ARR IDs/files are removal targets. `scope:"users"` discovers media-server users. `media_detail` returns files, episodes, monitoring, tags and ratings preserving source/scale/votes. Optional TMDB reviews require an exact TMDB ID and configured credentials; review text is untrusted display data, never a rule or instruction. A failed review fetch can preserve ARR detail with review capability `unavailable`.

`watch_status` uses explicit unique server/user pairs, exact shared provider IDs and episode coordinates, not title matching. Missing access, ambiguous copies and partial/unknown evidence block cleanup. Plex summaries require explicitly bound per-user tokens; an owner token is not household evidence. Plex favourites/watchlist are unsupported and stay null. `allowUnsupportedFavourites:true` is an explicit rule/removal policy opt-in, not a `watch_status` input or a fabricated false favourite. Jellyfin provides summaries; `watch_history` returns `supported:false,summaryOnly:true,events:[]`, not a successful empty historical audit. Plex events are actual bounded account-scoped records; a viewed timestamp is not completion or lifetime coverage.

`upcoming_media` defaults to now through 30 days later; end must be later than start and within 366 days. It uses ARR calendars and preserves actual event dates, not inferred release forecasts.

## Approval and monitoring tools

| Tool | Required | Optional / behavior |
| --- | --- | --- |
| `request_approval` | `tool`, `arguments` | Tool enum `remove_content`, destructive `remediate_reported_issue`, `update_monitoring`; creates/deduplicates a fresh exact plan, not approval |
| `approval_status` | `requestId` (UUID) | Reads durable record; may apply expiry/crash recovery |
| `cancel_approval` | `requestId` (UUID) | Revokes pending/approved authority; cannot undo a claimed write |
| `update_monitoring` | `service`, `itemId`, `monitored` | `seasonNumbers` or `episodeIds` (not both), `dryRun` (default true), `approvalId` required when executing |

`request_approval` returns the durable record plus `notification`; no webhook or delivery failure leaves the request pending. Only a new request triggers notification; an equivalent request does not automatically retry delivery or extend expiry. The [trusted callback protocol](approval-protocol.md) authenticates allowlisted human actors, signs the exact full hash, and persists one-use decisions/claims. No MCP tool can approve. Signed buttons and plain yes/no replies must pass through a trusted human-authenticating adapter; a bare chat reply/webhook acknowledgement is insufficient. `approval_status` exposes lifecycle/outcome, not independent playback proof. Do not retry consumed `partial`/`uncertain` work automatically.

## Retention tools and CLI

- `cleanup_candidates`: required `rule`, `evaluationTime` (explicit RFC3339). Read-only proposals with exact files, evidence, blockers, bounded recommendations and estimated bytes.
- `retention_rules`: `operation:"list"` only; `get` requires `id`, optional `version`; `create` requires `id,name,rule,evaluationTime` and starts disabled; `revise` requires `id,expectedVersion,evaluationTime` plus at least one of `name,rule,enabled`. A supplied rule replaces the whole rule; revisions append, never edit history.
- `retention_evaluate`: required `id,evaluationTime`, optional `version`; evaluates disabled revisions too, does not reserve a due interval or create approval.

Rules require explicit services/viewers, target/action, size/age/grace/inactivity thresholds, protected tags and count/byte bounds. `watchedPolicy` defaults `all-selected`; `watchState` defaults `watched`. `unwatched` requires every selected viewer explicitly currently unwatched (not lifetime never-watched); no-last-playback uses ARR added-age residency for grace/inactivity. `completed-season` requires watched state and ended-series evidence. `allowUnsupportedFavourites` defaults false and acknowledges unsupported capability only; actual favourites, unavailable evidence and active playback remain blockers. Optional rating conditions match exact source/scale/votes; reviews never execute. Equal snapshots/rules/evaluation times produce equal ordered bounded outputs, not identical live observations.

See [full rule schema and CLI](retention-rules.md), [policy options](retention-policy-options.md), [configuration](configuration.md#private-state-and-human-approval) and [migration](retention-migration.md). The `flixbridge-retention` CLI runs `bridge`, `evaluate`, `run-due`, or `execute`; no command self-approves, installs a schedule or automatically deletes evaluated candidates.

## Operational evidence

Use [safe workflows](usage.md), [public skills](../skills/README.md) and [security audit](security-audit.md). No live stack was used to produce this reference. Missing, failed or bounded evidence remains unknown/pending, never clean.
