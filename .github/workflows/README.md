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

[`release.yml`](release.yml) defines **Release npm**, separate from Verify. It runs only on manual dispatch in the canonical repository at `refs/heads/main`, with explicit full expected commit, stable package version and approved tarball SHA-256 inputs. It never changes package/version/changelog, pushes commits/tags, creates GitHub releases or notifies webhooks. Conventional Commits do not trigger releases.

Release pins Node 24.22.1/npm 12.2.1, verifies clean commit/package/lock identity against public remote main before dependency installation and immediately before publication, runs locked install/check/build/full tests/audit, and packs exactly once with lifecycle scripts disabled. It validates the manifest, regular tar member allowlist, packed package identity and approved hash. A fresh omit-dev consumer installs that exact tarball, exercises installed stdio MCP with sanitized offline fixtures and checks retention CLI help. It never runs live smoke/debug scripts.

Only after those gates and fail-closed unauthenticated registry absence checking does the final step receive `NPM_TOKEN` and publish the exact tarball with public access, latest tag and provenance. The publish command explicitly disables npm's internal write retries with `--fetch-retries=0`. Independent readback runs even on publish command failure, with bounded read-only retries and no publish retry. See the [operator setup](../SETUP.md) for ambiguous failure recovery and remaining credential/hosted-reproduction checks. No extra artifact-upload action is used; verified hashes are printed and the pack manifest is checked, but failed hosted artifacts are not retained.

Final publication requires separate maintainer approval and a reviewed release mechanism tied to an exact artifact/version. No protected release environment or required reviewer configuration is established by this file. See [setup and release boundary](../SETUP.md).
