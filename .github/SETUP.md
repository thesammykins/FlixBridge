# Repository verification setup

The workflow is named **Verify**; its historical filename remains `workflows/build-and-publish.yml`. Pushes and pull requests targeting `main`, plus manual dispatch, run verification only. See the [workflow reference](workflows/README.md).

No npm publishing credential or service API key is needed for these offline checks. Do not add release tokens merely to make Verify pass. Repository/branch protection settings have not been established by this document; maintainers must review them separately.

## Publication is separate

There is no release workflow in this tree. Manual dispatch of Verify does **not** publish. The former merge-to-publish, commit-derived version bump, tag push and notification instructions are obsolete.

Before any publication, maintainers must approve a dedicated release procedure, the deliberate version/changelog update and the exact clean built artifact. That review must cover dependency reproduction/audit, Git and npm membership sanitization, packaged stdio/tool compatibility checks and provenance. Any future protected release environment and its required reviewers must be explicitly configured and verified; they are not configured or guaranteed by this documentation.

Local implementation or cleanup approval does not authorize a push, merge, tag, npm publication or live media mutation.

See [contributing](CONTRIBUTING.md) for local checks and [security limitations](../docs/security-audit.md) for the distinction between source checks and operational proof.
