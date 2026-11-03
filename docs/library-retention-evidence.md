# FlixBridge 1.1.0 candidate evidence

## Verdict and scope

Local verification: **PASS WITH RESIDUAL RISK** after the authorized dependency refresh. Zod 4.6.7 replaces affected 3.25.76; the fresh public-registry audit reports zero vulnerabilities. The oversized monitoring-scope regression went RED with element-level error accumulation on Zod 3 and GREEN with top-level rejection on Zod 4.6.7. The audit gate has not been waived or weakened. See the [complete dependency snapshot and upstream constraints](dependency-refresh.md).

The exact package has also replaced the local default-profile MCP and passed bounded read-only acceptance through a fresh native Hermes session. This is not a published release or whole-stack compatibility certification. Human review/merge, exact-head hosted checks and final publication remain separate gates. Older tarballs and audit snapshots are superseded, not evidence for this candidate.

The implementation exposes 32 MCP tools: 20 preserved names and 12 library/watch, approval and retention additions. Only the authorized local MCP deployment/settings changed; production media, credential values and host schedules were not changed. No tag, GitHub merge or package publication was performed.

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
| `npm run check` | Pass; 101 code/JSON files checked, no fixes or warnings |
| Clean locked install | `npm ci --include=dev --ignore-scripts` passed |
| Fresh public-registry audit | Pass; zero production/development vulnerabilities |
| Current direct dependency metadata | All seven installed versions match registry `latest`; no outdated production dependencies |
| Hosted functional/security matrix | Inspect PR checks for the exact refreshed head; previous Zod 3 security failure is historical, not a waived check |
| `npm test`, Node 24.22.1 and 26.7.0 | 251 unit + 175 integration tests passed on each; zero failures/skips |
| Built JavaScript integration suite, Node 20.20.2 | 175 passed; zero failures/skips |
| Installed exact tarball, Node 20.20.2, 24.22.1 and 26.7.0 | 43 critical regressions plus 3 installed-client modes passed on each runtime |
| Installed MCP client consumption | Default legacy, automatic modern and pinned modern; child binaries use the selected runtime's PATH |
| Installed retention bin | `--help` succeeded with an empty credential environment and Node 20 |
| Clean-output regression | A synthetic obsolete generated module was removed by the normal build and absent from the tarball |
| Package contents/integrity | 81 allowed files; npm SHA-512 integrity independently matched actual bytes |
| Historical dependency-refresh documentation gate | 29 JSON examples parsed; 144 local/repository link targets resolved before the local-acceptance follow-up |
| Whitespace | `git diff --check` passed |

The installed tests retain the original assertions and synthetic provider fixtures. Adaptations change only product import/executable locations and test-only SDK client import locations; no development dependency is added to the production installation. The product is not bundled or patched to obtain a pass. Exact runtime executables, private consumer paths, fixture hashes and logs are retained in the local evidence bundle, outside the public tree.

## Exact packaged artifact

- Package: `@thesammykins/flixbridge@1.1.0`
- File: `thesammykins-flixbridge-1.1.0.tgz`
- SHA-256: `45c91d4fa31f622cfa01862e222863dabe9a740017fe808f764724eec75ae123`
- Contents: generated `dist` modules/declarations, README, LICENSE and package metadata only.

Earlier packages were superseded after independent review reproduced a whole-title post-claim substitution defect, after the Zod audit blocked the pre-refresh candidate, and after native acceptance exposed missing Trakt ratings, an incorrect Plex history route and missing downloader-status dispatch. The three live-contract regressions were demonstrated RED, corrected and rerun. Earlier passing checks are not evidence for this artifact. They were not published; use the exact corrected digest above.

## Native acceptance and release gates

A fresh native Hermes session made 19 read-only MCP calls against the installed corrected candidate. Configured ARR/Plex/SAB status, bounded ARR calendars, exact Sonarr/Radarr detail and ratings, Plex account discovery and bounded playback history succeeded. Rule listing returned no configured rules. No HTTP/authorization failure was converted into an empty healthy result, and no provider mutation was requested. This acceptance used the actual tool registry, not a direct-HTTP replacement harness.

Watch status correctly remained unknown with incomplete evidence when the selected account lacked an explicit Plex token binding. Optional TMDB reviews remained unconfigured. These are visible setup gaps, not successful watched-state or review-content verification. Jellyfin, production-scale scans, live removal and a real messaging approval adapter were not exercised; positive authenticated removal/retention lifecycles remain isolated-fixture evidence.

The separate release dispatch binds a clean reviewed main commit, matching package/lock identity and an approved exact tarball hash, repeats the gates and consumes the actual artifact before publication. Independent readback checks registry metadata, downloaded SHA-256/SHA-512, SRI and latest tag even after an ambiguous publish-command failure. A bounded independent release review found npm's internal write-retry gap; the publish command now sets `--fetch-retries=0`. A loopback transport probe using the exact pinned npm 12.2.1/Node 24.22.1 observed three PUT attempts with the default retry policy and one with retries disabled. No real registry write was made. Actionlint and a regression also cover runner-local path setup rather than the unsupported job-level `runner` context.

Hosted byte-for-byte reproduction, live npm credential permissions and actual publication/provenance remain unverified until the human merge and authorized release dispatch. Earlier invalid-workflow and pre-fix live failures remain historical failed evidence, not passes.

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

- Live acceptance covered bounded reads against configured ARR/Plex/SAB services only; it was not a production-scale benchmark or Jellyfin/messaging-adapter validation. Fixtures remain source-derived synthetic DTOs. Conservative full-library scans may be expensive on large libraries.
- There is no provider-side atomic conditional DELETE. Another administrator or background task can change data after the final evidence read. Pause competing mutations for consequential batches; cancellation cannot retract an already-submitted write.
- New library/retention workflows use reviewed v3 contracts. Season cleanup requires ended-series evidence; unsupported v5/auto mutation modes do not downgrade silently.
- Plex per-user token ownership is an explicitly documented operator assertion plus account-membership checking. Favourites/watchlist are unsupported and block by default unless their capability waiver is explicitly reviewed.
- Jellyfin watch data is summary state, not playback-event history. Explicit currently-unwatched flags do not prove lifetime never-watched status.
- Merged/multipart/hidden or unresolvable file identities, UNC/noncanonical paths, incomplete favourite/session coverage and ambiguous mappings remain blocked.
- State is local-filesystem/private-owner scoped, not a distributed transaction or a proof of physical power-loss durability. Callback actor authentication remains the trusted adapter's responsibility.
- Do not restore old approvals, remove consumed records or automatically retry uncertain work. See the [approval protocol](approval-protocol.md), [rules](retention-rules.md), [provider contracts](library-provider-contracts.md) and [migration](retention-migration.md).
