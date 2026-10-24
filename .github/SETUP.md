# Repository verification setup

The workflow is named **Verify**; its historical filename remains `workflows/build-and-publish.yml`. Pushes and pull requests targeting `main`, plus manual dispatch, run verification only. See the [workflow reference](workflows/README.md).

No npm publishing credential or service API key is needed for these offline checks. Do not add release tokens merely to make Verify pass. Repository/branch protection settings have not been established by this document; maintainers must review them separately.

## Publication is separate

Manual dispatch of Verify does **not** publish. The separate **Release npm** workflow (`workflows/release.yml`) accepts manual dispatch **only** on `thesammykins/FlixBridge` main. A human must merge reviewed changes first; publication needs separate authorization. There is no merge-to-publish, commit-derived version bump, tag push or notification.

Supply all three reviewed inputs: `expected_commit` (full lowercase 40-hex main SHA), `package_version` (exact committed stable version), and `expected_sha256` (lowercase 64-hex SHA-256 of the reviewed npm tarball). Obtain the hash from the **final integrated candidate after all product fixes and validation**, not an earlier baseline artifact; there is deliberately no default hash. The workflow checks dispatch SHA, checkout HEAD and current public remote main twice. Main advancing or a dirty tracked/untracked tree blocks publication; dispatch again only after reviewing the new revision. Node 24.22.1 and npm 12.2.1 are pinned. A local tarball hash is approval evidence, **not** proof that hosted CI reproduces it: a different hosted hash blocks release and must be investigated, never bypassed.

The existing repository secret **NPM_TOKEN** is consumed only by the single final publish step. Its validity, npm package permissions, expiry, 2FA policy and provenance compatibility must be checked by the human operator; implementation does not verify them. `id-token: write` is job-scoped solely for npm provenance on a GitHub-hosted runner; repository contents remain read-only. No secret value belongs in inputs, logs or source.

Before dispatch, review the workflow and exact artifact, confirm the version is unpublished and arrange operator follow-up. The unauthenticated public registry check permits only a valid HTTP 200 packument with the exact version absent. Auth errors, 404s, rate limits, transport/JSON failures and existing versions all block publication. The workflow publishes once, never retries publication, and reads back exact metadata, SHA-512 integrity, downloaded SHA-256/SHA-512 and the latest tag with three bounded read attempts even if the publish command fails. A failed command may have published: inspect the readback before taking any further action. Existing versions remain blocked; do not blindly rerun a failed release. No protected environment/reviewer gate is established by this workflow.

Before any publication, maintainers must approve a dedicated release procedure, the deliberate version/changelog update and the exact clean built artifact. That review must cover dependency reproduction/audit, Git and npm membership sanitization, packaged stdio/tool compatibility checks and provenance. Any future protected release environment and its required reviewers must be explicitly configured and verified; they are not configured or guaranteed by this documentation.

Local implementation or cleanup approval does not authorize a push, merge, tag, npm publication or live media mutation.

See [contributing](CONTRIBUTING.md) for local checks and [security limitations](../docs/security-audit.md) for the distinction between source checks and operational proof.
