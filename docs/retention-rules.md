# Deterministic retention recommendations

This module **proposes only**. It never changes monitoring, deletes files, approves a
request, or contacts a service except through the two injected library readers.
`src/index.ts` registers the tools and integrates the separate approval/execution engine. `src/cli.ts` supplies opt-in evaluation/proposal commands and durable approval deduplication. Evaluation never grants consent; no background timer or host schedule is installed.

## Tool integration

Import `retentionTools` and `runRetentionTool` from `src/retention/tools.ts` (compiled
path `dist/retention/tools.js`). The individual descriptor exports are
`cleanup_candidates`, `retention_rules`, and `retention_evaluate`.

```ts
const dependencies = { loadLibrarySnapshot, getWatchEvidence };
const result = await runRetentionTool(name, args, dependencies);
```

The fixed `RetentionDependencies` interface is:

```ts
{
  loadLibrarySnapshot(services?: string[]): Promise<LibrarySnapshot>;
  getWatchEvidence(
    item: LibraryItem, users: ViewerScope[], seasonNumber?: number
  ): Promise<WatchEvidence>;
}
```

There is deliberately no runtime import of `library/intelligence.ts`. The caller
supplies those exports. Results are data, not MCP content/envelopes; the caller
wraps them using its normal envelope and error handling. Schemas reject unknown
fields, duplicate service/user selections, empty scopes and invalid bounds.

- `cleanup_candidates({ rule, evaluationTime })`: read the explicitly selected
  services once, obtain watch evidence for each exact item/season, evaluate, return
  `{ evaluationTime, candidates, recommendations }`. Reader failures for individual
  watch scopes produce blocked candidates, never inferred unwatched status.
- `retention_rules({ operation: "list" })`: latest revision of each rule, sorted by ID.
- `retention_rules({ operation: "get", id, version? })`: one immutable revision;
  omitted version means latest.
- `retention_rules({ operation: "create", id, name, rule, evaluationTime })`: create
  version 1, always disabled. Supplying `enabled` here is rejected.
- `retention_rules({ operation: "revise", id, expectedVersion, evaluationTime,
  name?, rule?, enabled? })`: append a revision; at least one changed field must be
  supplied. A supplied `rule` replaces the whole configuration. The latest version
  must match `expectedVersion`. Existing revisions cannot be edited or deleted.
- `retention_evaluate({ id, version?, evaluationTime })`: preview the stored revision,
  including disabled revisions, returning `{ ruleId, version, evaluationTime,
  result }`. This does not advance the scheduler or create a durable approval.

IDs are literal `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`. Names are display labels. All
`evaluationTime` values are explicit RFC3339 timestamps with timezone. Revision
and evaluation times cannot precede the revision they extend/evaluate.

## Rule configuration and units

Example configuration (service/server/user identifiers must match the configured
library readers; these are illustrative identifiers, not discovered live data):

```json
{
  "services": ["radarr"],
  "users": [{ "server": "jellyfin-home", "userId": "observed-user-id" }],
  "watchState": "watched",
  "allowUnsupportedFavourites": false,
  "watchedPolicy": "all-selected",
  "target": "movie",
  "action": "unmonitor-delete-files",
  "minSizeBytes": 1073741824,
  "minAddedAgeDays": 90,
  "watchGraceDays": 14,
  "minInactiveDays": 30,
  "rating": { "source": "imdb", "scale": 10, "maxValue": 6, "minVotes": 1000 },
  "protectedTags": ["keep"],
  "includeSpecials": false,
  "maxCount": 10,
  "maxBytes": 53687091200,
  "intervalHours": 24
}
```

| Field | Meaning |
| --- | --- |
| `services`, `users` | Required, nonempty, explicit scopes. Exact IDs; no title-only join. |
| `watchState` | Defaults to `watched`; `unwatched` requires every selected user explicitly currently unwatched, including every episode for shows. This is not historical never-watched proof. Completed-season rules require watched state. |
| `allowUnsupportedFavourites` | Defaults false. Explicit true acknowledges only positively marked unsupported favourite capability (such as Plex), never actual favourites or unavailable/missing evidence. |
| `watchedPolicy` | Applies to watched rules only; unwatched always requires all selected users. Defaults to `all-selected`. `any-selected` requires at least one selected viewer to have watched the entire selected scope, not different viewers watching different episodes. Unknown/partial/missing/ambiguous selected-viewer evidence still blocks. |
| `target` | `movie`, whole `show`, or `completed-season`. |
| `action` | `unmonitor-delete-files` (in that order), or `remove-title` with files. Removing an entire title is forbidden for a season rule. |
| `minSizeBytes` | Inclusive minimum sum of exact selected files, in bytes. Safe nonnegative integers only. |
| `minAddedAgeDays` | Inclusive minimum age since ARR `addedAt`. A day is exactly 86,400,000 milliseconds, not a local calendar day. |
| `watchGraceDays` | Inclusive minimum elapsed days after the last watch, for every selected viewer. For explicitly unwatched viewers with no last-played timestamp, use known ARR added-age residency instead, never invented playback history. |
| `minInactiveDays` | Inclusive days since last recorded viewing, not download/login activity. Both grace and inactivity must pass (their maximum). Explicitly unwatched viewers with no last-played date instead need added-age residency of at least `max(minAddedAgeDays,watchGraceDays,minInactiveDays)`; watched users without timestamps still block. |
| `rating` | Optional. Exact provider `source` and numeric `scale`, score at or below `maxValue`, votes at or above `minVotes`. No rescaling, provider substitution or invented votes/reviews. Missing or ambiguous matching ratings block when configured. |
| `protectedTags` | Required explicit array; any exact matching tag blocks. Empty array means no tag protection. Favourites always block, independently of tags. |
| `includeSpecials` | Defaults false. Specials (season 0) require explicit opt-in. Whole-show removal cannot silently omit special episodes. |
| `maxCount`, `maxBytes` | Required inclusive limits across recommendations for one evaluation, not across all historical runs/rules. Count means movie/show/season scopes, not individual files. No file is split to meet a budget. |
| `intervalHours` | Optional positive elapsed hours; only rules with an interval can be due. One hour is 3,600,000 milliseconds. |

Days are bounded to 36,500, interval hours to 87,600, count to 10,000, byte values
to safe JavaScript integers. A zero threshold does not excuse missing timestamps.
Missing history never establishes that a user has never watched a title. Unknown watch flags, invalid/future timestamps, incomplete snapshots/items, active/unknown sessions, actual favourites, unwaived unsupported favourite capability, unavailable protection, protected tags and missing provider/file identity block eligibility. An absent last-played timestamp is permitted only for explicit current unwatched state with added-age residency as described above. Snapshot `observedAt` has a deterministic five-minute observation tolerance after evaluation time because reads finish later; it does not relax added/air/playback timestamps. See [policy options](retention-policy-options.md).

### Season completion and file safety

The shared model has no authoritative per-season completion flag. Consequently,
**continuing/unknown-status series are refused**, even when the currently known
episodes are watched. An ended series must still have a nonempty inventory for
each selected season, all selected episodes released by evaluation time, every
episode backed by an exact file, and exact per-viewer episode-coordinate evidence.
A title-level watched flag cannot establish season completion or episode viewing.
This deliberately loses candidates rather than guessing the last episode or a
future air date. More continuing-series eligibility needs explicit authoritative
season-completion evidence in the shared model first.

Multi-episode files are allowed only when every included episode belongs to the
selected scope, maps back to that file, and passes viewing conditions. A file
shared with an unselected season/episode, unknown episode, or another snapshot
item is blocked. Duplicate file IDs/paths and duplicate episode IDs/coordinates
are blocked. Files and distinct copies stay separate; titles never identify a
file or merge copies. Absolute POSIX and Windows file paths are supported without
rewriting their identities.

Recommendations contain the exact sorted file set (`id`, `path`, `sizeBytes`,
`episodeIds`), identity-bound `plan`, canonical rule and watch evidence, reasons,
and blockers. Blocked candidates have `plan: null`. `estimatedReclaimedBytes` is
a file-size estimate, **not guaranteed free disk space**: hardlinks, filesystem
snapshots, service errors and failed deletions can change actual reclamation.
`reclaimedBytesGuaranteed` is always false. There is no review fabrication or
forecast deletion date. Plans require the caller's fresh identity/evidence
readback and exact hash-bound human approval before execution.

## Pure evaluation API

`src/retention/evaluator.ts` exports:

```ts
evidenceKey(item: Pick<LibraryItem, "service" | "id">, seasonNumber?: number): string;
evaluateCandidate({ snapshot, item, rule, watchEvidence?, evaluationTime, seasonNumber? });
evaluateSnapshot({ snapshot, rule, watchEvidence, evaluationTime });
```

Snapshot evidence is a readonly record keyed with `evidenceKey(item, season?)`;
whole-title and season keys are intentionally different. `item` must have exactly
one matching service/ID identity in `snapshot`. Both functions are pure: no
wall clock, random IDs, network, persistent state or input mutation. Equal inputs
produce equal outputs. Snapshot evaluation filters explicit service/media scopes,
sorts by literal service ID then numeric item ID then season, and greedily accepts
eligible scopes within both bounds. An oversized scope is skipped; a later scope
may still fit. Bounds-excluded candidates retain evidence and an explicit blocker.

## Durable state and scheduler API

Persistence requires an explicit absolute `FLIX_BRIDGE_STATE_DIR`. Library callers
can instead pass `{ stateDir: absolutePath }` as the final options argument.
No home-directory fallback or implicit service configuration is used. The module
owns only `<stateDir>/retention/rules.json` and its lock/temporary files. State
schema version is 1. New directories are private (0700), rules files private
(0600). Reads validate the strict schema and reject symlinked rules/subdirectories;
corrupt state is never replaced with an empty successful result.

`src/retention/rules.ts` exports `createRule`, `reviseRule`, `listRules`, `getRule`,
`evaluateRule`, and `runDueRules`:

```ts
// Injected evaluator; its return type is retained in the result.
const evaluate = async (rule: RetentionRule, context: {
  ruleId: string; version: number; evaluationTime: string;
}) => cleanupCandidates({ rule, evaluationTime: context.evaluationTime }, dependencies);

await evaluateRule({ id, version, evaluationTime }, evaluate, options);
await runDueRules({ evaluationTime }, evaluate, options);
```

The integrated CLI uses the same library readers for evaluation. Optional `--request-approval` converts eligible recommendations into exact requests bound to the enabled current rule revision; it never decides or executes them. Trusted custom callbacks must preserve this proposal-only contract.

`runDueRules` reserves only current enabled interval-bearing revisions. A rule without prior attempts is first due at/after revision creation. Cadence uses the latest attempt for the rule ID **across revisions**; revising or re-enabling does not reset it. Due checks are inclusive at `lastAttempt + current intervalHours`. An unresolved `reserved` attempt blocks later due evaluation for that rule, including new revisions, until operator reconciliation; a crash is not a timed lease. Backward evaluation times are not due. Results are sorted by rule ID and contain
`{ ruleId, version, evaluationTime, status: "completed", result }` or a secret-free
`status: "failed"` result. Reservations are durable **before** callback invocation;
concurrent processes cannot reserve the same due interval. Reserved/failed
attempts consume that interval; there is no automatic uncertain-outcome retry.
Manual evaluation does not reserve/advance an interval.

An unresolved reservation still active at a later due interval produces an actionable outstanding-evaluation error rather than an apparently idle success. Inspect/reconcile the original attempt; do not remove approval evidence or replay destructive work to clear it. Failed evaluations consume the attempted interval and expose a failure result. A rule revision does not reset logical-rule cadence.

Writes serialize with a local-filesystem directory lock, validate state, fsync a
private temporary file, atomically rename, then fsync the directory. Readers see
old or new complete state. Lock waits are bounded (about five seconds); locks
are never stolen on a guessed timeout. After a writer crash, stop/inspect all
writers before manually removing `retention/.lock`. A crash after reservation may
leave no delivered proposal; inspect the caller's proposal store rather than
blindly replaying. An unresolved reservation remains blocking, not automatically retryable at the next interval. Reconcile it without inventing consent or deleting approval evidence. The state file has a
16 MiB ceiling; archive/migrate offline before exceeding it. Network filesystems,
untrusted writable parent directories and hostile local state editors are not
supported coordination/security boundaries. Rules are immutable through this API,
not cryptographically protected against the state-directory owner.

## CLI and opt-in scheduling

The `flixbridge-retention` bin uses the same environment-only ARR/media configuration and explicit `FLIX_BRIDGE_STATE_DIR` as MCP. Source builds can use `node /absolute/path/to/FlixBridge/dist/cli.js` in place of the bin. Rules are managed through `retention_rules`; the CLI has no rule-import file or credential file.

| Command | Required options | Optional options | Effect |
| --- | --- | --- | --- |
| `bridge` | `--port <1..65535>` | none | Explicit foreground callback listener on `127.0.0.1`; never an MCP listener |
| `evaluate` | `--rule <id>` | `--version <positive integer>`, `--at <RFC3339>`, `--request-approval` | Evaluate one stored revision, including disabled previews |
| `run-due` | none | `--at <RFC3339>`, `--request-approval` | Reserve/evaluate current enabled due rules once, then exit |
| `execute` | `--request <uuid>` | none | Explicitly execute one already human-approved exact plan; fresh validation/claim still required |

`--help`/`-h` prints usage. Unknown commands/options and options for another command fail. `--at` defaults to the CLI invocation's current wall clock; MCP evaluation requires explicit time. Pin the same snapshot/rule/time for reproducible pure evaluation; live reads and later approval revalidation are not frozen by `--at`. A requested time before the rule revision fails. `--request-approval` is valid only for evaluate/run-due; it requests decisions, not consent. Requests require a still-enabled current revision and fresh matching eligibility/bounds; disabled/old revisions remain previewable but cannot authorize a rule-bound deletion.

Illustrative invocations (choose observed rule IDs/versions and a time at/after revision creation):

```bash
flixbridge-retention evaluate --rule reviewed-movies --version 1 --at 2026-10-01T00:00:00Z
flixbridge-retention run-due --at 2026-10-02T00:00:00Z --request-approval
flixbridge-retention bridge --port 8787
```

The bridge requires the trusted secret/actor environment and a separately configured human-authenticating adapter. Once that adapter has persisted an exact approved decision, an operator may explicitly run `flixbridge-retention execute --request <approved-request-uuid>`. No command grants approval. Rules, notification delivery, model responses and signed button references are not approval.

Optional external scheduling example only — **not installed or enabled by this documentation**:

```cron
# Reviewed launcher injects environment privately; does not execute approved removals.
0 4 * * * /absolute/path/to/reviewed-env-launcher /absolute/path/to/flixbridge-retention run-due --request-approval
```

Choose one authorized external scheduler, enabled rule revisions and bounded cadence. Do not schedule `execute` as an implicit evaluation phase. Installing the package, connecting MCP or enabling a rule does not install cron/launchd jobs or start the bridge. New/equivalent pending, approved, claimed, rejected and uncertain plan deduplication follows the [approval protocol](approval-protocol.md); equivalent requests do not renew expiry or automatically re-notify. Reserved/failed due intervals stay consumed; inspect missed delivery/uncertain work rather than inventing retries. Per-run evaluation completion is not proof of complete provider coverage or eligible candidates: inspect blockers/errors and each request/result, including CLI JSON `ok:true` envelopes.

## Verification

```sh
npm ci --include=dev --ignore-scripts
npm run build
node --test tests/retention-*.test.mjs
npm run check
npm test
```

These are verification instructions, not final-candidate pass counts, live-provider proof or publication evidence. The integrated top-level test glob includes retention/CLI tests; local fixtures do not certify upstream permissions or every DTO/version. See [provider contracts](library-provider-contracts.md), [approval protocol](approval-protocol.md) and [migration](retention-migration.md).
