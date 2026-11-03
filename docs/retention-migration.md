# Migration: human-approved library retention

This is a development candidate, not an installed or published release. Do not replace a production process or enable a schedule until the final evidence and explicit rollout approval are available.

## Destructive behavior changes

The existing tool names remain, but removal authority changes incompatibly: a returned `confirmationToken` no longer authorises queue, downloader, file or library deletion. `remove_and_regrab` is included. Internal diagnostics cannot bypass this boundary. Imports, adds, searches, profile changes and comments remain mutations requiring operator authority even though they are not removals.

The implemented caller flow is:

1. Inspect exact services and media. Supply explicit deletion options and, for library file cleanup, explicit media-server/user scopes.
2. Call `request_approval` with the intended tool and arguments. The server re-reads the target and creates a durable plan; the caller cannot supply a fabricated approved manifest.
3. A trusted messaging adapter presents the immutable plan, full plan hash, expiry, effects and approve/reject controls to a human. The adapter authenticates the actual human sender and signs the callback. A webhook delivery acknowledgement is not approval.
4. Read `approval_status`. Only an authenticated decision on the exact hash may authorise execution.
5. Call the original operation with the unchanged scope, `dryRun:false` and its `approvalId`. Execution refreshes evidence, claims the approval before mutation and consumes it once. Process-local preview tokens are regenerated internally, so a human need not reply within their shorter lifetime.
6. Inspect operation and durable execution results. Partial/uncertain operations are not automatically retried. Read the exact upstream state before considering a new request.

There is deliberately no MCP approval tool. An LLM possessing the callback signing credential or control of the trusted approval adapter can defeat human-in-the-loop guarantees; isolate those credentials and the adapter from the agent. Callback authentication attests to the trusted adapter's claim about a human decision, not a magical proof of human presence.

## Scheduling and recovery

A schedule evaluates structured rule versions and requests approval; it never grants approval. Rules start disabled. The optional CLI is run by an external scheduler, not an assistant connection. Scheduling is opt-in; installing this package does not install launchd/cron jobs or start listeners.

Use an explicitly configured private state directory. Back it up while no writers are active; approval/execution records are security-relevant. Do not edit or restore old approved records to repeat actions. A claimed execution left by a crash is uncertain, not pending/retryable. Reconcile provider state first.

Monitoring and file deletion are separate upstream writes, not a distributed transaction. Cleanup verifies unmonitoring before deletion. If deletion fails, monitoring may already be disabled; do not report rollback. An upstream library scan, ARR import list or another administrator may later re-add media; deletion alone does not change their independent configuration.

Rolling back the software does not restore deleted media. Rolling back to an older package can also restore its weaker confirmation contract; disable destructive callers/schedules before rollback.

## Deliberate conservative limits

- New season/file mutations use reviewed ARR v3 contracts only. Strict v5 and `auto` are rejected rather than silently downgraded for these new mutations; existing operations retain their documented adapter policies.
- Season cleanup currently requires an ended series. A lack of known future air dates is not proof a continuing season is complete.
- Media-server watched data is per user. No records, inaccessible users and truncated results remain unknown. Plex summaries require explicitly bound per-user tokens; favourites/watchlist are unsupported and require explicit `allowUnsupportedFavourites:true` to waive that capability only (default false). Jellyfin event history is unsupported; summary state is not a complete playback history. `watchState:"unwatched"` means current explicit flag, not lifetime never-watched status. Other unknown/partial/protected evidence still blocks.
- File-size estimates are logical removable bytes, not guaranteed filesystem free space. Hardlinks, snapshots and shared storage can differ.
- A new target/file, changed monitoring or material watch/protection evidence requires a fresh reviewed plan. Freshness checks cannot provide an atomic lock against another administrator or upstream process.

See [provider contracts](library-provider-contracts.md), [approval protocol](approval-protocol.md), [retention rules/CLI](retention-rules.md) and [policy options](retention-policy-options.md) for exact schemas and supported data sources. Final release evidence must state which contracts were verified with synthetic local providers versus an authorised live deployment.
