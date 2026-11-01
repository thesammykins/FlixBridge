# Operator-owned unattended queue discard

This is an **opt-in queue/source-download policy**, not unattended library retention. It reuses `remove_content`; there is no self-approval tool, callback signer, scheduler or new MCP operation. Without a valid installed policy, removal retains the authenticated-human contract.

## Install authority once, outside MCP

The operator supplies this JSON **string** in the MCP subprocess environment:

```sh
FLIX_BRIDGE_QUEUE_DISCARD_POLICY='{"version":1,"services":["sonarr-main","radarr-main"],"downloadRoots":["/downloads"],"maxItems":50}'
```

Also configure an explicit private `FLIX_BRIDGE_STATE_DIR`. Configuration remains environment-only; writing a `.env` file does not load it, and some MCP clients filter the parent environment. Set the value in the actual server entry and deliberately reconnect. No caller argument can install or enable policy authority.

- `version` must be `1`; unknown fields/versions, malformed JSON and missing policy disable this path.
- `services` is a nonempty unique allowlist of exact lowercase service slugs discovered with `list_services`.
- `downloadRoots` is a nonempty unique list of absolute normalized POSIX source roots, never `/`. The operator must verify their remote-path/mount meaning: they must denote dedicated download storage, not library mounts or symlinks into a library. Lexical API paths cannot prove remote filesystem topology.
- `maxItems` is an integer from 1 through 1000. It does not override provider/preparation capacity: the current removal preparation must fit its complete 250-record snapshot. Larger or partial queues fail closed, not partially clean.
- `allowDirectExecution` is an optional boolean, disabled unless explicitly `true`. It permits the caller's `bypassApproval:true` flag for this queue-only policy; it does not enable arbitrary token-free removal.
- This policy supports reviewed ARR v3 reads/removals only. Unsupported API families, other-instance coverage errors and missing state block execution. It never downgrades a write after failure.

Installing a package does not install this policy or a cron job. A policy/config change takes effect through the subprocess lifecycle; it is not an instantaneous distributed revocation service.

Configure each ARR instance's canonical base URL, including its configured URL-base prefix (for example, `/sonarr`). A successful GET can hide a same-origin redirect into that prefix; mutation redirects are deliberately never followed. Correct a missing prefix before execution, rather than weakening redirect protection. If an attempt already consumed a reservation before receiving a redirect, correcting the URL does not release that reservation or permit a retry.

## Exact permitted request

Preview using fresh discovered numeric queue IDs and **all** these explicit options:

```json
{
  "service": "sonarr-main",
  "target": "queue",
  "ids": [123],
  "dryRun": true,
  "manualImport": false,
  "allowManualRemoval": true,
  "removeFromClient": true,
  "deleteFiles": false,
  "blocklist": false,
  "addImportExclusion": false,
  "removeFromDownloader": false
}
```

Execution repeats the same scope/options with `dryRun:false` and the **original returned `confirmationToken`**, within its five-minute process lifetime. Do not supply a fabricated `approvalId` or substitute a newly generated token for the reviewed preview. A rejected policy preview can still be a valid ordinary human-reviewed preview; it does not authorize unattended execution.

### Direct execution without the approval/token round trip

For an unattended caller, the operator can additionally install:

```sh
FLIX_BRIDGE_QUEUE_DISCARD_POLICY='{"version":1,"services":["sonarr-main","radarr-main"],"downloadRoots":["/downloads"],"maxItems":50,"allowDirectExecution":true}'
```

Then call `remove_content` with the same exact queue scope/options above, but use `dryRun:false,bypassApproval:true` and **omit both `confirmationToken` and `approvalId`**. The server prepares and revalidates the exact targets itself before claiming or writing. There is no caller-side preview, confirmation exchange or human approval request required in this mode. `dryRun:true` still performs inspection only. Omitting/setting `bypassApproval:false` retains the ordinary token-required policy flow even when direct execution is installed.

`list_services.data.queueDiscardPolicy` reports policy `enabled`, `version`, `services` and `allowDirectExecution`; this is capability discovery, not a guarantee that an individual target is eligible. Invalid/missing policy and absent/false direct opt-in reject `bypassApproval:true` before upstream reads. Mixed approval/token arguments, other tools, other targets and broadened side effects are rejected. Direct results identify `approvalMode:"operator-policy-direct"`; they never invent a human approver.

The receiver—not the model—requires fresh complete queue evidence, actual failed/rejected or completed-and-blocked state, positive source/download association and no safe manual-import candidate. Diagnostic prose, a rejected filename or `autoFixable:true` alone grants nothing. Healthy/paused/queued/unknown states and incomplete/failed inspection block discard. `manualImport:false` prevents inline import-then-delete behavior; do not use a separate failed/pending import as a reason to fall through into discard.

Every queue member sharing a download or overlapping source directory must be eligible and explicitly selected. Unknown-title entries are included in legacy safety snapshots; a provider's default filtered total is not whole-download coverage. Other configured ARR queues and registered library paths are checked too. The policy cannot silently widen a batch to another queue row or instance.

## Durable execution, not synthetic human consent

The receiver rechecks the original job evidence and policy/configuration at the final shared HTTP boundary, then commits that physical job's one-use reservation before its first DELETE. Only the exact origin/path, DELETE method and four reviewed query flags are allowed; bodies, extra/duplicate query parameters, other routes and mutation redirects are rejected.

Policy executions have their own `executionId` and `policyClaimIds`, with authority `queue-discard-policy`. Their private `queue-discard.json` ledger has no human actor or signed decision and cannot be spent as a human approval. It reuses the existing private-file/fsync/lock machinery. Protected-library inventories are bound by hash rather than copied into every job record; the exact job targets/preparation/import evidence remain in the claim.

A shared source job is never retried through a sibling queue ID after an uncertain write. Concurrent processes, fresh tokens, changed batch grouping and restart do not release consumed reservations. Independent jobs that were never attempted remain repairable. Download-ID reservations are deliberately conservative across aliases; an ID collision may require operator reconciliation. Never edit/restore old ledgers or delete reservations to force a retry.

## Readback and truthful results

Inspect outer `ok`, per-item counts and `executionState` (`completed`, `partial`, `uncertain`). Queue success requires complete unknown-inclusive absence, not HTTP acknowledgement or a filtered empty page.

Policy previews expose `queueDiscardPolicy.eligible` and a normalized `queueDiscardPolicy.error` when eligibility inspection fails. Execution retains normalized dependency failures, including HTTP 401/403, and captured HTTP failures in `failureCauses`; upstream response bodies and credentials are withheld. Do not mistake an authentication/coverage failure for a request to fabricate human consent.

`policyClaimIds` lists confirmed reservations for this execution. `policyClaimState` distinguishes `none` (no claim attempted), `consumed` (every attempted claim returned a confirmed reservation) and `unknown` (at least one claim attempt lacks a confirmed result, even if other IDs were returned). A failed result must not claim that a reservation was consumed when none was established. Unknown persistence and confirmed claims both require reconciliation, never blind write replay.

`queueReadback` retains the observed `complete` flag and selected `absentIds`; it does not copy unrelated queue paths. A final readback failure remains in `failureCauses` even when an earlier DELETE already failed. If durable outcome finalization fails, the response stays `ok:false`/`executionState:"uncertain"` but preserves collected per-target `result` and readback observations. Storage failure does not erase an observed removal or restore its source payload.

- `queueRemovalVerified` is exact ARR queue evidence.
- `sourceCleanupRequested:true` records the caller's `removeFromClient:true` intent; failure before admission can mean no request reached ARR. It is not delivery or cleanup proof.
- `sourceCleanupVerified:false` explicitly withholds independent downloader/filesystem proof. It must not be translated into reclaimed bytes, physical file absence, or proof that the source payload was retained. An empty active downloader queue alone does not prove removal of a particular completed/history job.
- `filesDeletionRequested:false` / `filesDeletionVerified:false` reflect the library `deleteFiles:false` setting in this queue-only result; they do **not** mean that source payload deletion was not requested.
- A failed result may follow a real partial mutation. Cancellation and software rollback do not restore removed payloads.

The default policy DELETE preflight/verification timeout is bounded at 60 seconds; an explicit unchanged `queueTimeoutMs` may select 1000–60000 ms. The same bounded timeout applies to the policy's manual-import candidate inspection, so a legitimate slow provider scan is not cut off by the ordinary five-second HTTP default. Standalone manual-import previews retain that ordinary default. Evidence reads remain cancellable. No timeout triggers an automatic write retry.

Queue ID order is not identity: the receiver sorts validated unique numeric IDs before comparing original/fresh preparation, while preserving all material drift checks. Registered-library `/series` and `/movie` v3 routes return full resources rather than a paginated path projection. Only these policy safety-inventory reads use a finite 64 MiB streamed-response budget; ordinary HTTP reads retain 8 MiB. Invalid budgets, inventory overflow, malformed/duplicate identities and invalid paths fail closed. No inventory is truncated or replaced by roots-only coverage.

Diagnostic `requiresManual`/`autoFixable:false` labels do not override this installed authority. An unattended caller submits completed-blocked/failed groups to the receiver's policy checks, rather than inventing importability from names or sizes or excluding groups solely by a diagnostic category. A positive safe-import candidate or another actual receiver refusal still prevents discard.

Library/title/season/file deletion, Plex destructive remediation, monitoring and standalone downloader purges remain on their existing human-authority paths. No blocklisting, exclusions, independent downloader purge, search or replacement grab is granted by this policy.

## Scheduled callers

Keep one native scheduled executor and its existing cadence/model/delivery. A run must inspect eligible exact groups, execute under the installed policy and independently read them back. Use either the default preview/token path or the explicitly enabled direct path; neither requires per-item human decisions inside its scope. A cron prompt that still explicitly forbids writes remains read-only even after package installation. Preserve healthy downloads, continue independent permitted work and report incomplete coverage or unresolved actionable work as failure—not a clean sentinel or a successful process exit. Work outside the installed policy remains blocked.

Source/fixture tests do not prove deployment or live source cleanup. Package installation, operator policy installation, native scheduled execution and production readback are separate rollout gates.
