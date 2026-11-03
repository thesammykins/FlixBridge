# Dependency refresh for 1.1.0

Registry snapshot: `2026-10-23T22:52:47.986908+00:00`. All seven direct packages are exact-pinned to the npm `latest` stable release, not prereleases. Install/lock refresh uses `--include=dev --ignore-scripts`. Runtime support stays Node 20+.

| Direct dependency | Current stable version |
| --- | --- |
| `@modelcontextprotocol/server` | `2.4.0` |
| `zod` | `4.6.7` |
| `@biomejs/biome` | `2.6.2` |
| `@modelcontextprotocol/client` | `2.4.0` |
| `@types/node` | `26.6.5` |
| `tsx` | `4.23.15` |
| `typescript` | `7.0.2` |

CI action dependencies are also current stable releases, pinned to resolved commits: `actions/checkout` v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`) and `actions/setup-node` v7.1.0 (`949feb2413d6458794dcd2491c4babbbce0c15c1`). The workflow still verifies only; it has read-only contents permission and cannot publish.

## Migration and regression evidence

- Zod 4 uses explicit string-keyed records; strictness, field bounds and human authority remain enforced. The oversized monitoring-scope regression accumulated 1,001 element errors plus the size issue with Zod 3; it rejects with only the top-level size issue on 4.6.7. This is a bounded fault-detection probe, not an unbounded out-of-memory exploit.
- Queue schemas retain v3/v5 field checks and duplicate-ID rejection. A common typed output contract makes the Zod 4 refinement callable without casts or relaxed validation.
- TypeScript 7 requires explicit Node types and relative `paths` targets instead of removed `baseUrl`. Node declarations are current; Node 20 runtime checks remain necessary because declarations alone cannot establish runtime compatibility.
- Biome 2 configuration was migrated and its new import/format rules applied. The explicit JS/TS/JSON scope preserves the old check domain rather than reformatting historical Markdown or workflow YAML. No lint rule, test assertion or security-audit threshold was disabled.
- Clean install, build, all 246 unit/169 integration tests, all 169 integration tests on Node 20, and fresh registry audit passed locally. Exact installed-package and hosted-CI evidence is tracked separately; do not reuse the superseded Zod 3 package.

## Transitive constraints, not hidden stale direct packages

`npm update --include=dev --ignore-scripts` refreshed the lockfile. Every installed transitive package matches npm's upstream-compatible `wanted` version. The production dependency tree has no outdated entries. The following eight **development-only** transitives have newer releases outside their parent's published range:

| Package | Latest compatible installed | Newest published |
| --- | --- | --- |
| `eventsource` | `3.0.7` | `5.1.3` |
| `eventsource-parser` | `3.1.1` | `4.1.2` |
| `isexe` | `2.0.0` | `4.0.0` |
| `path-key` | `3.1.1` | `4.0.0` |
| `pkce-challenge` | `5.0.1` | `6.0.0` |
| `shebang-regex` | `3.0.0` | `4.0.0` |
| `undici-types` | `8.9.0` | `8.12.3` |
| `which` | `2.0.2` | `7.0.0` |

These belong to the current MCP test client, its subprocess/OAuth dependencies, or current Node type declarations. No forced major overrides were added: that would bypass upstream CommonJS/ESM, API and runtime contracts instead of making the latest SDK safe. Other-platform optional binaries are locked to their parent's current releases but correctly not installed on this host. Current audit reports zero vulnerabilities in both production and development dependencies.

Re-query npm and action releases before a later release; advisory and publication metadata can change without any source edit. Keep the normal audit gate blocking and retain previous failed/zero-audit snapshots as history, not enduring approval.
