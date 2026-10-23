# Human approval protocol

This engine stores proposals and human decisions; it never removes media or runs an ARR/downloader operation. No MCP tool may call `decide`, receive signing credentials, or turn a preview/confirmation token into consent. A trusted messaging adapter, not a model, authenticates the human.

## Configuration and process boundary

- `FLIX_BRIDGE_STATE_DIR`: explicit absolute, canonical (no symlink components) path. No default state location or file-based credential configuration. A constructor directory argument is the explicit programmatic equivalent.
- `FLIX_BRIDGE_APPROVAL_SECRET`: at least 32 bytes; generate a random 256-bit or stronger secret, inject from the operator's credential manager into the trusted bridge/adapter environment only. Do not print it, include it in plans, expose it through MCP, or give it to an LLM. `ApprovalStore` needs no signing secret to create, inspect, cancel, claim or finish requests.
- `FLIX_BRIDGE_APPROVAL_ACTORS`: explicit comma-separated authenticated actor identifiers, e.g. provider-scoped stable account IDs. No actor is implicitly trusted. Keep configuration consistent across the bridge and any trusted decision adapter.
- `FLIX_BRIDGE_APPROVAL_WEBHOOK_URL`: optional operator-configured notification receiver. HTTPS required except literal loopback HTTP. Userinfo, query and fragment are rejected; do not put credentials in the URL. Never accept this target from tool arguments.

Create the server only in a deliberate, separately supervised bridge process. It never listens automatically:

```js
import { ApprovalStore, createApprovalBridge } from './dist/approval/index.js';
const store = new ApprovalStore();
const server = createApprovalBridge(store);
server.listen(8787); // 127.0.0.1, not Node's wildcard default
```

`createApprovalBridge(store, {host: '::1'})` supports IPv6 loopback. Any other host, including `localhost`, requires explicit programmatic `unsafeAllowExternalBinding: true`; this is intentionally not an MCP input. The guard also applies to later `server.listen` calls. Supported listen forms are `(port[, host][, callback])` and `({port[, host]}[, callback])`; pipe/FD/socket-handle bindings are rejected. A non-loopback deployment needs a separately configured TLS/authenticated reverse proxy, firewall and resource limits. The unsafe option does not supply TLS.

## Public TypeScript API

`src/approval/index.ts` re-exports the store from `src/approval/store.ts`, the bridge/notification functions from `src/approval/bridge.ts`, and `hashPlan` from `src/approval/hash.ts`.

```ts
new ApprovalStore(directory?: string)
store.create(plan: unknown, opts?: {ttlMs?: number}): Promise<ApprovalRecord>
store.get(id: string): Promise<ApprovalRecord>
store.cancel(id: string): Promise<ApprovalRecord>
store.claim(id: string, plan: unknown): Promise<ApprovalRecord>
store.finish(id: string, status: 'completed'|'partial'|'uncertain'|'failed',
             result?: unknown): Promise<ApprovalRecord>

// TRUSTED BRIDGE ONLY. Authentication defaults FALSE, not true.
store.decide({requestId, planHash, actor, decision: 'yes'|'no', nonce},
             authenticated?: boolean): Promise<ApprovalRecord>

hashPlan(plan: unknown): string
createApprovalBridge(store, options?: {host?: string;
  unsafeAllowExternalBinding?: boolean}): import('node:http').Server
sendApprovalRequest(store: ApprovalStore, id: string): Promise<{sent: boolean}>
verifyApprovalSignature(rawBody: string, timestamp: string,
                        signature: string): boolean
```

`decide(input, true)` is a local **trust assertion**, not authentication by itself. Only the HMAC-verifying HTTP handler or another reviewed, authenticated human adapter may make that assertion. Arbitrary code running as the service UID can bypass local trust boundaries; never register this method as an MCP tool. The verification utility verifies callback authentication only: it does not check actors, expiry, nonce reuse or grant approval. Those checks happen atomically inside the store.

Records expose `id`, full `planHash`, credential-free `plan`, `state`, Unix-millisecond `createdAt`/`expiresAt`, plus optional `actor`, `decidedAt`, `claimedAt`, `finishedAt`, and sanitized `result`. Internal executor ownership is not returned. Returned objects are detached snapshots, not mutable database handles.

## Immutable hashing and secret handling

SHA-256 is lowercase 64-character hex over UTF-8 JSON with object keys sorted lexicographically by JavaScript UTF-16 code units at every level. Arrays keep order; strings and finite numbers use JSON serialization (`-0` is `0`). No whitespace or implicit field omission. The algorithm is intentionally described here rather than claiming an unimplemented RFC canonicalization scheme.

Reject undefined, functions, symbols (including keys), bigint, NaN/infinity, holes/extra array properties, non-enumerable/accessor properties, cycles, exotic prototypes and `Date`/custom `toJSON` objects. Limits: depth 64, 50,000 visited values, 256 KiB canonical UTF-8 plan/result JSON. Do not pass a normalized library model when the caller's actual removal manifest is different: hash the **entire** execution manifest, including service identity, arguments/options, exact targets and material preview evidence. The integrating removal gate owns re-reading targets and constructing an equal manifest; the approval engine cannot determine whether a caller omitted material evidence.

`create` snapshots before asynchronous I/O and rejects recognized credential keys, configured credential values (including keys), and HTTP(S) userinfo/query/fragment URLs rather than persisting a secret or silently changing the approved plan. Remove ephemeral preview/confirmation tokens *before* constructing the manifest; this engine does not normalize timestamps or strip fields for hashing. `finish` sanitizes result credentials before writing. All public records are defensively redacted again. This is defense in depth, not general secret discovery: callers must supply credential-free manifests and normalized errors, never raw provider/configuration dumps.

## Lifecycle and replay rules

- Default TTL is 30 minutes; explicit integer `ttlMs` is 1 millisecond through 24 hours. Stored absolute expiry is checked on every operation, across process reconstruction; there is no session timer. Pending/approved requests become `expired` at or after expiry. This assumes a correctly maintained host wall clock.
- `pending -> approved | rejected` only after a verified, allowlisted actor decision for the exact request/full hash and a globally unused nonce. A duplicate or conflicting decision is rejected, not overwritten. Nonces are stored as SHA-256 hashes in the same atomic ledger transaction.
- `pending | approved -> cancelled` is terminal for that request ID.
- `approved -> invalidated` if `claim` receives a different plan hash. The invalidation is persisted even though `claim` rejects.
- `approved -> claimed` is durably persisted **before the promise resolves**. Only after resolution may the caller install its private removal permit and mutate. A failed/rejected claim must never install a permit or write to a media service.
- `claimed -> completed | partial | uncertain | failed` exactly once, by the same `ApprovalStore` instance/process that claimed it. Keep that instance for the execution. `finish` reports evidence supplied by the executor; it does not verify media readback or claim rollback.
- A claimed request whose executor PID is definitely dead becomes terminal `uncertain` on the next store operation. Never automatically retry uncertain work. A live or PID-reused owner is considered alive and stays consumed; no lease or elapsed-time takeover is allowed.
- Equivalent active `pending`/`approved`/`claimed` plans deduplicate, retaining the original expiry. `rejected` plans deduplicate permanently, including after their former expiry. `uncertain` plans also remain blocked against automatic retry. There is no reset/renew/reapprove operation.
- A subsequent explicit `create` after `completed`, `partial`, `failed`, `cancelled`, `expired` or `invalidated` creates a **new pending request**, never inherits the prior actor or approval. A scheduler must not turn these into an automatic retry loop. Any intended repeat still requires a new human decision; rejected/uncertain equivalents cannot be renewed by `create`.

No network notification means no consent. Notification failures leave a pending request unchanged and are not automatically retried. `sendApprovalRequest` returns `{sent:false}` when the webhook is unconfigured; with a webhook, it requires a pending, unexpired plan whose public hash still matches, sends once and returns `{sent:true}`. It returns no URL, secret, signature or upstream response. Repeating this explicit notification call does not create/renew an approval.

## Signed callback

Only `POST /approvals/decision`, content type `application/json`, is accepted. No GET approval link, bare "yes" callback, query-based approval or unauthenticated route exists. Unknown routes/methods return 404/405. Callbacks are limited to 16 KiB; headers to 8 KiB; request/header timeouts are configured to 10 seconds. Unknown JSON fields are rejected.

Exact body shape:

```json
{"requestId":"00000000-0000-4000-8000-000000000000","planHash":"FULL_64_LOWERCASE_HEX_SHA256","actor":"provider:stable-human-id","decision":"yes","nonce":"fresh_random_base64url_nonce"}
```

The hash placeholder above is deliberately not a valid runnable hash. Nonce: 16–128 base64url characters; use at least 128 random bits. Request IDs are generated UUIDv4. Actor length is 1–128 characters and it must match the explicit allowlist exactly.

Headers:

- `X-FlixBridge-Timestamp`: decimal Unix milliseconds (13 digits), within +/- five minutes of bridge time.
- `X-FlixBridge-Signature`: `sha256=` followed by lowercase HMAC-SHA256 hex, constant-time compared.

Sign **exactly** these UTF-8 bytes, with literal newline separators and no trailing newline unless it is part of the transmitted body:

```text
flixbridge.approval.decision.v1\n<TIMESTAMP>\n<EXACT_RAW_JSON_BODY>
```

The timestamp HMAC protects freshness; the persisted request protects its fixed expiry; the body binds actor/request/full hash/decision/nonce. Sign and transmit the same body bytes; do not reserialize after signing. A valid HTTP callback returns `200 {"requestId":"...","state":"approved"}` or `rejected`. Authentication failure is 401; invalid schema 400; oversized body 413; wrong content type 415; nonexistent/mismatched/expired/replayed/nonallowlisted or storage-conflicted decisions return generic 409 without private details. Never interpret an ambiguous network timeout as authorization: inspect the store before execution, then claim once.

## Notification and button references

Outbound notifications POST through the shared `fetchJson` boundary with a five-second timeout and mutation redirects forbidden (no second request). Payload ceiling is 300 KiB, containing `event: 'approval.requested'`, `requestId`, full `planHash`, complete credential-free `plan`, `createdAt`, `expiresAt`, and `buttons` for yes/no. Review the **complete plan**, not only a truncated title or short hash.

Outbound headers use the same timestamp/signature names, but the signed domain is `flixbridge.approval.request.v1`; an outbound request signature can never authenticate a decision callback.

Each button contains `label`, a `reference` object `{requestId, planHash, expiresAt, decision}`, and a `signature`. Sign the reference using:

```text
flixbridge.approval.reference.v1\n<DECIMAL_EXPIRES_AT>\n<CANONICAL_JSON_REFERENCE>
```

Canonical reference key order is `decision`, `expiresAt`, `planHash`, `requestId`. These references are **not bearer approvals** and contain no actor. The trusted messaging adapter must verify the notification/reference and expiry, authenticate the actual interacting human through its messaging provider, reject unallowlisted identities, generate a fresh nonce, and sign the callback's actor/request/hash/decision using the callback domain. Never let an LLM supply the actor, map free-form "yes" to the latest request, or use the button/reference signature as the callback signature. Provider-specific messaging authentication and UI are intentionally outside this module.

## Durable storage and operations

Single-host, local POSIX filesystem only (tested on macOS). The explicit directory must be owned by the service UID, mode `0700`, with no symlink components. Its trusted parent directory must already exist; the store creates only the final private directory and fsyncs the parent entry before using it. Existing permissive paths/files are rejected, not silently chmodded. Ledger files must be regular single-link owned files mode `0600`, opened with `O_NOFOLLOW`. Store the directory under a trusted parent and protect backups equally; the service UID/root/operator is trusted.

One ledger `approvals.json` (16 MiB hard ceiling) holds records and nonce hashes. Each transaction takes a cross-process hard-link lock, reads and validates the ledger/hash, expires stale requests and marks dead claims uncertain, then writes a private exclusive temporary file, fsyncs it, atomically renames it and fsyncs the directory before returning. Rejected operations may still persist expiry/crash-recovery/drift state. No partial JSON file is published. The global lock/linear scan is deliberate for low-volume human approvals; use a reviewed transactional database before scaling, not lock leases or in-memory caches.

The hard link atomically publishes a fully written PID/hostname lock owner. Definitely dead same-host transaction owners can be recovered; live/unknown owners cannot be stolen. Acquisition times out after five seconds. A separate serialized stale-lock recovery guard prevents competing reclaimers from deleting a replacement live lock. A process killed while *reclaiming* that guard may require operator inspection: stop all bridge/executor/proposer processes, reconcile the ledger and actual media outcomes, then remove only demonstrably orphaned lock/recovery/temporary files. Never delete/reset `approvals.json` to unblock a rejection or consumed claim. Stale temporary owner/write files are private and not interpreted as records. Power-loss/filesystem durability guarantees depend on the filesystem honoring fsync/rename; no distributed/NFS/Windows or same-UID hostile-code guarantee is claimed.

## Verification

```sh
npm ci --include=dev --ignore-scripts
npm run build
node --test tests/approval-*.test.mjs
npm run check
npm test
```

Tests use real private temporary storage, separate Node processes and SIGKILL, plus loopback HTTP callbacks/receivers. They exercise strict hashing, permissions/symlinks/malformed state, expiry/rejection/drift, immutable snapshots, simultaneous dedup/claims, dead claim/lock recovery, forged/wrong-actor/cross-plan/stale/replayed callbacks, notification HMAC/button references, invalid UTF-8 rejection, secret redaction and redirect non-replay. No production service is contacted or mutated. The repository's existing `npm test` script does not automatically discover `approval-*.test.mjs`; run the explicit command until the parent integrates test discovery.
