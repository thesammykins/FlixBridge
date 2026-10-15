# Contributing to FlixBridge

Read [AGENTS.md](../AGENTS.md), then inspect the affected source, callers and tests. Prefer small changes using the existing HTTP, service and dispatch boundaries. Use TypeScript, Zod and Biome as configured in the repository; do not introduce a parallel ESLint or test stack.

## Local development

Requires Node.js 20 or later and npm. From a checkout:

```bash
npm ci --include=dev --ignore-scripts
npm run check
npm run build
npm test
```

These checks need no live media-service credentials. Tests use the repository's custom runner and synthetic/mock responses; they do not establish live API or playback compatibility. Do not put credentials in tests or committed examples. The server reads process environment only; see [configuration](../docs/configuration.md).

`npm run smoke` and other diagnostic scripts are separate live helpers, not required CI gates. The current smoke script inherits read-only diagnostics and enables debug output. Review every script before use and obtain separate authorization for the target stack and any mutations. Never run against production merely to make a contribution look verified.

## Change and review contract

- Keep scope explicit; add a regression check for behavior changes and update the affected public docs.
- Discover actual tool names and schemas; do not advertise planned features or assume every successful response proves persistence.
- Keep exact targets/options, readback and partial-failure behavior intact. A token is not user consent.
- Use explicit file staging. Exclude private maintenance/profile notes, local configuration, logs, generated output and external API dumps.
- In the review summary include revision, commands/results, affected contracts, assumptions and remaining uncertainty. For docs-only edits validate links, examples and source claims rather than claiming a runtime test.
- Conventional Commit prefixes (`fix:`, `docs:`, `feat:`) are useful labels, not automatic version instructions.

## Release boundary

[Verify CI](workflows/README.md) checks changes only. It does not bump versions, create tags/releases, push commits or publish to npm. No release workflow is currently configured in this tree. Final publication needs a separate reviewed release procedure and explicit maintainer approval of the exact artifact/version. Branch protections, npm credentials and protected release environments must not be assumed to exist.

Report security concerns privately to the maintainer without posting secrets or private operational data. Deleting a file from the current tree does not remove historical exposure.
