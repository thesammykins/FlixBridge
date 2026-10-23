# FlixBridge 1.1.0 candidate evidence

## Verdict and scope

Local verification: **PASS WITH RESIDUAL RISK** after the authorized dependency refresh. Zod 4.6.7 replaces affected 3.25.76; the fresh public-registry audit reports zero vulnerabilities. The oversized monitoring-scope regression went RED with element-level error accumulation on Zod 3 and GREEN with top-level rejection on Zod 4.6.7. The audit gate has not been waived or weakened. See the [complete dependency snapshot and upstream constraints](dependency-refresh.md).

This is a source/package candidate, not a published release or a live-provider compatibility certification. Human review/merge, exact-head hosted checks and final publication approval remain separate gates. Older tarballs and audit snapshots are superseded, not evidence for the refreshed candidate.

The implementation exposes 32 MCP tools: 20 preserved names and 12 library/watch, approval and retention additions. The running deployment, production media, credentials and host schedules were not changed. No tag, GitHub merge or package publication was performed.

## Merge compatibility

- Upstream baseline: `67d5638`.
- PR #10 head re-fetched and included as an ancestor: `b2265039d23505a092d1c30817f19fd17b887ee6`.
- Normalized Plex read failures, regression assertions and the upstream Support section were preserved.
- Changelog history from the `1.0.1` heading onward is byte-identical to PR #10. Only the new 1.1 candidate section precedes it.
- Root package/lock version is `1.1.0`. All seven direct dependencies are now exact-pinned current stable versions; compatible transitives were refreshed. The additional CLI bin is intentional. CI actions are current stable releases pinned by commit.

Re-fetch main and PR #10 again before an eventual push if either has moved.

## Executed checks

| Check | Observed result |
| --- | --- |
| `npm run build` | Pass; TypeScript compiled after deleting `dist` |
| `npm run check` | Pass; 100 code/JSON files checked, no fixes or warnings |
| Clean locked install | `npm ci --include=dev --ignore-scripts` passed |
| Fresh public-registry audit | Pass; zero production/development vulnerabilities |
| Current direct dependency metadata | All seven installed versions match registry `latest`; no outdated production dependencies |
| Hosted functional/security matrix | Inspect PR checks for the exact refreshed head; previous Zod 3 security failure is historical, not a waived check |
| `npm test`, Node 24.22.1 | 246 unit + 169 integration tests passed; zero failures/skips |
| Built JavaScript integration suite, Node 20.20.2 | 169 passed; zero failures/skips |
| Installed exact tarball, Node 20.20.2 and 24.22.1 | 22 critical tests passed on each runtime |
| Installed MCP client consumption, Node 20.20.2 | 3 SDK-client modes passed: default legacy, automatic modern, pinned modern |
| Installed retention bin | `--help` succeeded with an empty credential environment and Node 20 |
| Clean-output regression | A synthetic obsolete generated module was removed by the normal build and absent from the tarball |
| Package contents/integrity | 81 allowed files; npm SHA-512 integrity independently matched actual bytes |
| Documentation | 29 JSON examples parsed; 144 local/repository link targets resolved |
| Whitespace | `git diff --check` passed |

The installed tests retain the original assertions and synthetic provider fixtures. Adaptations change only product import locations and stdio/CLI executable paths to the installed package; the product is not bundled or patched to obtain a pass. Exact runtime executables, private consumer paths, fixture hashes and logs are retained in the local evidence bundle, outside the public tree.

## Exact packaged artifact

- Package: `@thesammykins/flixbridge@1.1.0`
- File: `thesammykins-flixbridge-1.1.0.tgz`
- SHA-256: `0e370f59ddf5e322cfe745dbcbd6d7192bf1a2d5bb35909719752a5f6418252c`
- Contents: generated `dist` modules/declarations, README, LICENSE and package metadata only.

Earlier packages were superseded after independent review reproduced a whole-title post-claim substitution defect, then after the Zod audit blocked the pre-refresh candidate. Their passing earlier checks are not evidence for this artifact. They were not published; use the exact refreshed digest above.

## Security and correctness evidence

- Durable real-process create/claim serialization, authenticated full-hash decisions, replay denial, expiry, cancellation, SIGKILL/uncertain recovery and private storage checks.
- Real stdio MCP → immutable request → authenticated loopback callback → exact deletion → durable readback.
- Exact file-target and whole-title post-claim substitutions stop before deletion. Whole-title checks compare original file IDs, paths, episode mappings and watch evidence before every title DELETE at the shared HTTP boundary.
- A separate copied-build sabotage restored post-claim plan adoption: the regression failed. Restoring the actual candidate passed; the primary candidate was never sabotaged.
- Root/season/episode favourites, hidden or unresolved sessions, physical-copy/path mismatches, incomplete played-leaf timestamps and unsupported capabilities fail closed.
- Season-scoped approval/execution preserves protected sibling seasons; actual Jellyfin loopback coverage verifies that a favourite sibling does not silently broaden the selected scope.
- Protected-tag drift after claim and during a multi-file batch went RED before the fix, then GREEN. Retention-relevant metadata is bound and refreshed; only intended monitoring changes and verified prior file removals are excluded from comparison.
- Movie-file cleanup proves unmonitoring before deletion. Monitoring readback failure consumes authority without deleting a file. Shared files crossing approved episode/season scope are rejected.
- Actual interval CLI runs deduplicate pending/rejected human requests; rejected execution is denied. Rule revisions do not reset cadence; outstanding reservations prevent overlap and surface overdue failures.
- Accepted Plex replacement searches remain pending/partial, not verified completed replacements. Unknown deletion absence is uncertain. Failed removal keeps per-target evidence and returns `ok:false`.

Independent review found and drove fixes for both stale-plan routes and the season-scope mismatch. A bounded re-review reported no remaining finding in the whole-title/shared-HTTP fix, including nested-read cancellation and every-target guard execution. That re-review did not certify the whole project or exercise a full multi-title provider batch; the multi-target guard was exercised at the shared HTTP boundary.

## Residual limitations and operational gates

- No live ARR/Plex/Jellyfin stack, production-scale benchmark or real messaging-provider adapter was exercised. Fixtures are source-derived synthetic DTOs, not captured deployment proof. Conservative full-library scans may be expensive on large libraries.
- There is no provider-side atomic conditional DELETE. Another administrator or background task can change data after the final evidence read. Pause competing mutations for consequential batches; cancellation cannot retract an already-submitted write.
- New library/retention workflows use reviewed v3 contracts. Season cleanup requires ended-series evidence; unsupported v5/auto mutation modes do not downgrade silently.
- Plex per-user token ownership is an explicitly documented operator assertion plus account-membership checking. Favourites/watchlist are unsupported and block by default unless their capability waiver is explicitly reviewed.
- Jellyfin watch data is summary state, not playback-event history. Explicit currently-unwatched flags do not prove lifetime never-watched status.
- Merged/multipart/hidden or unresolvable file identities, UNC/noncanonical paths, incomplete favourite/session coverage and ambiguous mappings remain blocked.
- State is local-filesystem/private-owner scoped, not a distributed transaction or a proof of physical power-loss durability. Callback actor authentication remains the trusted adapter's responsibility.
- Do not restore old approvals, remove consumed records or automatically retry uncertain work. See the [approval protocol](approval-protocol.md), [rules](retention-rules.md), [provider contracts](library-provider-contracts.md) and [migration](retention-migration.md).
