# Contributing to FlixBridge

## Work on the intended artifact

- Keep service-owned checkouts and unrelated changes intact; use an isolated worktree.
- Node.js 20+ is required. Verify CI tests Node 20, 22 and 24 without publishing.
  Separately authorized manual Release npm dispatches on main bind an exact commit,
  version and approved tarball hash; see `.github/SETUP.md`. Only humans merge.
- Install with `npm ci --include=dev --ignore-scripts`. Runtime gates are
  `npm run build`, `npm run check`, and `npm test` (unit runner plus every top-level
  `tests/*.test.mjs` integration suite, including real MCP/CLI/approval storage flows).
- Rebuild and reconnect deliberately: editing source does not refresh an existing
  process or npm installation. Server version comes from `package.json`.
- Live scripts contact configured services. Inspect them and obtain separate authority;
  never prove a development change with production mutations.

## Preserve the operational contract

- `src/index.ts` owns schemas, dispatch, envelopes and confirmations. Preserve tool
  names and required inputs; document additions and changed semantics.
- `src/config.ts` owns environment-only configuration; `src/services/registry.ts`
  separates ARR instances from SABnzbd. Do not add file configuration implicitly.
- Shared ARR behavior lives in `src/services/shared.ts`; adapters own reviewed
  differences. HTTP goes through `src/core.ts` for limits, cancellation and errors.
- Sonarr policy is per instance: omission stays legacy-v3, explicit pins verify,
  and `auto` follows reviewed maps in `src/services/arr/sonarr.ts`. Freeze workflow
  family, preserve URL prefixes, and never replay writes across families after failure.
  Strict v5 rejects unported workflows before mutation. Statistics must not scan v3.
- Keep stdout MCP-only and stderr for logs. Preserve SDK `serveStdio` legacy serving
  and the current-version guard until SDK wire tests make that guard redundant.
  Propagate cancellation through HTTP/body reads and verification delays.
- Align schemas and validation: unknown-field rejection, literal IDs, bounds,
  conservative mutation annotations and matching structured/text output.

## Mutations need evidence

- Diagnostics stay read-only by default. Single-use expiring tokens bind scope/options/
  plans; they are not consent, locks or durable replay prevention.
- Every removal path requires a durable authenticated human decision outside MCP.
  Pass the exact claimed preparation into execution; do not substitute a newly
  prepared plan after claiming. State and callback credentials are opt-in; no
  background scheduler or listener starts with stdio MCP.
- Refresh imports before submission and prove media/path/download identity. Retain
  downloads when commands or end-state verification are pending or incomplete.
- Keep legacy failed counts/status alongside additive pending evidence. Accepted work,
  queue disappearance and `Pending:` comments do not prove playback success.
- Preserve partial aggregate data/errors. Empty pages with positive totals, ambiguous
  IDs and missing readbacks cannot prove absence or a clean stack.
- Plex destruction needs a unique exact media/file target and rederived token plan.
  Read media and comment outcomes separately. Retained account/client ownership
  protects replay across tool calls, but process-local guards die on restart or
  server reconstruction; token rotation creates a distinct configured identity.
- See [safe usage](docs/usage.md) and [security limits](docs/security-audit.md).

## Verification and public changes

- Reuse helpers/native APIs. No speculative layers, invented LOC budgets or broad churn.
- Check happy/failure paths at the changed boundary; mocks replacing it cannot prove
  routing, cancellation or persistence. Reconcile docs after runtime integration.
- Check tool inventory, JSON examples, local/repository links and unchanged historical
  changelog sections. Keep credentials, private hosts/paths and operational dumps out.
- Review Git tree and packed npm artifact separately. Publication, pushes with external
  effects, live writes and history rewriting need their own authority; local gates
  are not release approval.
- Biome 2 checks the existing JavaScript/TypeScript/JSON scope explicitly; do not
  auto-format historical changelog/Markdown or workflow YAML as dependency-migration churn.
- Dependency freshness means latest stable direct packages and latest compatible
  upstream transitive ranges; document held ranges instead of forcing incompatible majors.
