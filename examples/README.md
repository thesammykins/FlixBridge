# Configuration examples

- [Multi-instance MCP configuration](claude-mcp-config.json)
- [Single-instance MCP configuration](claude-mcp-config-simple.json)

These JSON files are client configuration examples, not FlixBridge server-side config. The `npx` arguments resolve the published npm package, not an unreleased v1 checkout; choose and pin a reviewed published version for reproducibility. Reserved `.example` hosts in the multi-instance file are illustrative and must be replaced privately. Replace placeholder URLs/keys privately and consult your MCP client's configuration location. Do not commit credentials.

FlixBridge reads process environment only; copying a `.env` file does not load it automatically. Use the client `env` object or an external launcher. At least one complete ARR pair is needed. Single-instance names are `sonarr`, `radarr`, `sabnzbd`; slug pairs such as `SONARR_MAIN_URL` and `SONARR_MAIN_API_KEY` produce `sonarr-main`. Always discover actual names with `list_services`.

See [configuration](../docs/configuration.md) for aliases, precedence, custom names, Plex settings and URL restrictions, and [installation](../docs/installation.md) for npm versus source-checkout execution. Sonarr policy is optional and per instance: omission retains legacy v3 without discovery; explicit `3` verifies v3, `5` rejects unported workflows, and `auto` uses only reviewed routes. Policy aliases accept exactly `3`, `5`, `auto`; see [policy/routes](../docs/configuration.md#sonarr-api-policy) before opting in. Public skills are installed separately through [skills/README.md](../skills/README.md).

After connection use read-only status/queue calls; diagnostics default to `autoFix:false`, but keep that flag explicit. Do not run live smoke scripts as an unreviewed production health check. Mutations require approval, exact targeting and readback; see [usage](../docs/usage.md).
