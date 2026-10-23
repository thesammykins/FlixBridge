# Library intelligence and human-approved retention

## Authorised scope

Implement the approved tool draft: Plex/Jellyfin library and per-user watch intelligence; ARR metadata, ratings and calendar; explainable cleanup recommendations; deterministic, versioned retention rules; durable hash-bound human approval; season/file/whole-title removal and monitoring; optional callback bridge and scheduler CLI. No production media/configuration changes, no new host schedules, no merge or publication. Existing service-owned checkout is untouched. Baseline: upstream main 67d5638 (1.0 release); unrelated dirty checkout is not the base.

## Release and merge contract

Target release: **1.1.0**, as directed by the maintainer. Preserve PR #10 (`fix/plex-read-errors`, observed head `b2265039d23505a092d1c30817f19fd17b887ee6`): normalized Plex report-read failures, regression tests and distribution documentation. Integrate its commits locally without approving/merging its GitHub PR. Reconcile its candidate version to 1.1.0 only in this feature branch, keep its historical changelog entry, and verify the combined runtime/tests. Re-fetch the PR head before final handoff and check merge compatibility again. Existing tool names remain; stronger removal consent is an explicit security tightening documented for 1.1, not an accidental version bump.

## Invariants and acceptance criteria

- All removal paths (ARR queue/library, downloader, remediation, new season/file cleanup and internal diagnostics) require authenticated human approval of an exact immutable canonical SHA-256 plan. A preview token is not consent. No MCP tool may approve itself.
- Human decisions bind request, plan hash, authenticated actor, expiry and a single execution. Reject forged/expired/replayed/cross-plan decisions; persist claims before writes and do not automatically retry uncertain outcomes.
- Re-read exact targets before execution; plan/identity/material evidence drift invalidates approval. Retain truthful partial/uncertain outcomes; verify readback and never claim rollback.
- Selected users/servers are explicit. Default retention requires all selected users watched; unavailable/partial/ambiguous evidence blocks eligibility. No history is not never watched. In-progress seasons, specials, active playback, favourites, protected tags and multi-episode files are handled conservatively.
- Joins use provider IDs, exact episode coordinates and file identity, never title-only destruction. Multiple copies stay distinct. Ratings retain provider/scale/votes; review support must be explicit, not fabricated.
- Rules are structured, versioned, disabled initially. Equal snapshot/rule/evaluation time gives equal results. Intervals propose only, with pending/rejected deduplication and explicit bounds. Schedule execution is outside MCP process lifetime.
- Optional durable state and approval bridge are explicit configuration. Credentials remain env-only; no new dependencies without approval. Callback routes fail closed, are bounded/authenticated/replay-protected and do not expose approval secrets through MCP.
- Existing tool names remain. Changed destructive contract is documented as a breaking update. Source, package and MCP wire behavior must agree.

## Slices and evidence

1. Read models/adapters/tools: real HTTP boundary fixture tests, paging, schema/auth failure and per-user cases.
2. Deterministic recommendations/rules: boundary conditions, protected/unknown cases, reproducibility.
3. Approval and removal: durable lifecycle, spoof/replay/concurrency/drift tests; loopback-only providers and webhook receiver, no real media writes.
4. CLI, documentation, final build/check/unit/MCP tests, packed fresh-consumer smoke and independent security review. Publish/merge remain human gates.

## Handoff

Record actual commands/results and limitations in docs/library-retention-evidence.md. No completion claim for unsupported acceptance criteria. Final artifact must be runnable without conversation state.
