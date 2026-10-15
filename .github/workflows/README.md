# Verify CI

[`build-and-publish.yml`](build-and-publish.yml) now defines **Verify** only; the filename is historical. It runs on pushes to `main`, pull requests targeting `main` and manual dispatch. None of these triggers publish.

## Checks

- Test matrix: Node.js **20.x, 22.x, 24.x** on Ubuntu.
- Locked development dependencies: `npm ci --include=dev --ignore-scripts`.
- `npm run check`, `npm run build`, `npm test`.
- Separate security job on Node.js 24.x: the same dependency install, then `npm audit --audit-level=moderate`.

Tests use offline fixtures/mocks, not configured production services. Live smoke/debug scripts are not CI gates. A successful audit is not a vulnerability-free guarantee, and successful mocked checks are not live API/playback verification.

The workflow uses `contents: read`, checkout without persisted credentials and cancellation of superseded verification runs. It does not need npm tokens, Plex tokens or media-service API keys.

## Release status

There is no publishing job or separate release workflow in this tree. CI does not change the package version/changelog, push commits/tags, create GitHub releases, notify a webhook or publish to npm. Conventional Commit messages do not trigger a version bump.

Final publication requires separate maintainer approval and a reviewed release mechanism tied to an exact artifact/version. No protected release environment or required reviewer configuration is established by this file. See [setup and release boundary](../SETUP.md).
