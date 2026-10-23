# Deterministic retention recommendations

This module **proposes only**. It never changes monitoring, deletes files, approves a
request, or contacts a service except through the two injected library readers.
`src/index.ts` registration, the approval/execution engine, pending/rejected proposal
deduplication, and a scheduler CLI belong to the caller. No background timer or host
schedule is installed.

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
  "users": [{ "server": "plex", "userId": "alice" }],
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
| `watchedPolicy` | Defaults to `all-selected`. `any-selected` requires at least one selected viewer to have watched the entire selected scope, not different viewers watching different episodes. Unknown/partial/missing/ambiguous selected-viewer evidence still blocks. |
| `target` | `movie`, whole `show`, or `completed-season`. |
| `action` | `unmonitor-delete-files` (in that order), or `remove-title` with files. Removing an entire title is forbidden for a season rule. |
| `minSizeBytes` | Inclusive minimum sum of exact selected files, in bytes. Safe nonnegative integers only. |
| `minAddedAgeDays` | Inclusive minimum age since ARR `addedAt`. A day is exactly 86,400,000 milliseconds, not a local calendar day. |
| `watchGraceDays` | Inclusive minimum elapsed days after the last watch, for every selected viewer. |
| `minInactiveDays` | Inclusive minimum days without later recorded viewing. The shared model exposes `lastWatchedAt`, not general user/service activity; this is **viewing inactivity**, not download/login activity. Both grace and inactivity must pass, equivalently their maximum. |
| `rating` | Optional. Exact provider `source` and numeric `scale`, score at or below `maxValue`, votes at or above `minVotes`. No rescaling, provider substitution or invented votes/reviews. Missing or ambiguous matching ratings block when configured. |
| `protectedTags` | Required explicit array; any exact matching tag blocks. Empty array means no tag protection. Favourites always block, independently of tags. |
| `includeSpecials` | Defaults false. Specials (season 0) require explicit opt-in. Whole-show removal cannot silently omit special episodes. |
| `maxCount`, `maxBytes` | Required inclusive limits across recommendations for one evaluation, not across all historical runs/rules. Count means movie/show/season scopes, not individual files. No file is split to meet a budget. |
| `intervalHours` | Optional positive elapsed hours; only rules with an interval can be due. One hour is 3,600,000 milliseconds. |

Days are bounded to 36,500, interval hours to 87,600, count to 10,000, byte values
to safe JavaScript integers. A zero threshold does not excuse missing timestamps.
Missing history never establishes that a user has never watched a title. Missing,
invalid or future timestamps, incomplete snapshots/items, active or unknown
sessions, true or unknown favourites, protected tags, missing provider/file
identity and upstream watch blockers all refuse eligibility.

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

For a read-only CLI preview, `evaluate` can call
`cleanupCandidates({ rule, evaluationTime: context.evaluationTime }, dependencies)`.
For a scheduled run, the caller should persist/deduplicate pending/rejected
proposals **inside** this callback. Callback code is trusted: supplying a function
that executes removal would violate the proposal-only API contract. This module
has no deletion/approval dependency and cannot police arbitrary caller code.

`runDueRules` reserves only current enabled interval-bearing revisions. A new
version has its own schedule; first evaluation is immediately due at/after its
creation time. Later due checks are inclusive at `lastAttempt + intervalHours`.
Backward evaluation times are not due. Results are sorted by rule ID and contain
`{ ruleId, version, evaluationTime, status: "completed", result }` or a secret-free
`status: "failed"` result. Reservations are durable **before** callback invocation;
concurrent processes cannot reserve the same due interval. Reserved/failed
attempts consume that interval; there is no automatic uncertain-outcome retry.
Manual evaluation does not reserve/advance an interval.

Writes serialize with a local-filesystem directory lock, validate state, fsync a
private temporary file, atomically rename, then fsync the directory. Readers see
old or new complete state. Lock waits are bounded (about five seconds); locks
are never stolen on a guessed timeout. After a writer crash, stop/inspect all
writers before manually removing `retention/.lock`. A crash after reservation may
leave no delivered proposal; inspect the caller's proposal store rather than
blindly replaying. The next interval remains eligible. The state file has a
16 MiB ceiling; archive/migrate offline before exceeding it. Network filesystems,
untrusted writable parent directories and hostile local state editors are not
supported coordination/security boundaries. Rules are immutable through this API,
not cryptographically protected against the state-directory owner.

## Verification

```sh
npm ci --include=dev --ignore-scripts
npm run build
node --test tests/retention-*.test.mjs
npm run check
npm test
```

The retention test command is separate because package/index edits are owned by
the integrator. Tests use real private temporary state, real child-process writer
contention, and pure snapshots/watch evidence; no configured live services.
Implementation followed observed RED → GREEN slices: missing evaluator module;
unknown/protected and inclusive thresholds; missing season support and bounds;
missing durable rules module; missing tool module; exact identifier/file safety;
pre-revision evaluation time; missing per-user episode evidence; truthful
`any-selected` explanations; inconsistent aggregate footprints and invalid calendar dates. Each failure was exercised before its implementation.

Observed local results: strict TypeScript build passed; 18 retention tests passed on
Node 24.22.0 and on the SHA-256-verified official Node 20.20.2 binary; scoped Biome
checks passed. Existing `npm test` passed (225 unit tests and 26 MCP tests).
Repository-wide `npm run check` is blocked only by pre-existing formatting in
`src/library/model.ts` (the multiline ratings type), which is outside this module's
ownership. No live service writes, deletion, approval, publication or push was run.
