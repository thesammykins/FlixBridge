# FlixBridge

A stdio MCP server for operating Sonarr, Radarr, and SABnzbd, with optional Plex reported-issue triage. Supports multiple ARR instances through environment variables. Requires Node.js 20 or later and at least one configured Sonarr or Radarr instance.

## Connect an MCP client

Use this server entry in a client that supports `mcpServers` (for example Claude Desktop). Replace the placeholders with your service URL and API key; keep credentials private.

```json
{
  "mcpServers": {
    "flixbridge": {
      "command": "npx",
      "args": ["-y", "@thesammykins/flixbridge"],
      "env": {
        "SONARR_URL": "http://localhost:8989",
        "SONARR_API_KEY": "replace-with-sonarr-api-key"
      }
    }
  }
}
```

This runs the npm release, not a local checkout. For reproducible deployments, select and pin a published package version. For source changes, build the checkout and configure the client to run `node /absolute/path/to/FlixBridge/dist/index.js`; see [installation](https://github.com/thesammykins/FlixBridge/blob/main/docs/installation.md).

## Operations and safety

Call `list_services` first and use the returned names. Tools cover queue/status monitoring, search/add, quality profiles, history, imports, removal, diagnostics, and Plex reports. There is no web dashboard or background polling service.

- Diagnostics default to read-only (`autoFix:false`); keep it explicit for inspection. Opting into `autoFix:true` requires authorization.
- `manual_import` and `remove_content` require a dry run and a returned confirmation token before execution.
- Add, retry/search, profile changes, and Plex comments also mutate state. Require operator authority even when a tool has no token gate.
- Read back the exact affected records after every mutation. An accepted command or a report marked “fixed” does not establish successful playback.

Optional configuration: `RADARR_URL` / `RADARR_API_KEY`, `SABNZBD_URL` / `SABNZBD_API_KEY`, and `PLEX_BASE_URL` / `PLEX_TOKEN`. Multi-instance variables use `SONARR_<SLUG>_URL` / `SONARR_<SLUG>_API_KEY` (also Radarr and SABnzbd). Configuration is environment-only; `.env` files are not loaded automatically.

## Documentation

- [Installation](https://github.com/thesammykins/FlixBridge/blob/main/docs/installation.md) · [Configuration](https://github.com/thesammykins/FlixBridge/blob/main/docs/configuration.md) · [Multi-instance setup](https://github.com/thesammykins/FlixBridge/blob/main/docs/multi-instance.md)
- [Usage and safe workflows](https://github.com/thesammykins/FlixBridge/blob/main/docs/usage.md) · [Tool reference](https://github.com/thesammykins/FlixBridge/blob/main/docs/api-reference.md) · [Agent rules](https://github.com/thesammykins/FlixBridge/blob/main/RULE.md)
- [Deployable operations and Plex reports skills](https://github.com/thesammykins/FlixBridge/blob/main/skills/README.md)
- [Troubleshooting](https://github.com/thesammykins/FlixBridge/blob/main/docs/troubleshooting.md) · [Architecture](https://github.com/thesammykins/FlixBridge/blob/main/docs/architecture.md) · [Security audit and remaining evidence](https://github.com/thesammykins/FlixBridge/blob/main/docs/security-audit.md)
- [Sonarr v3 → v5 contract changes and feature roadmap](https://github.com/thesammykins/FlixBridge/blob/main/docs/sonarr-api-changes.md)

## Source status and compatibility

This documentation describes the **1.0.0 source and tagged release**. Its 20 tools retain the existing 19 names/required inputs and add read-only `library_statistics` for Sonarr API v5 (no legacy library scan). GitHub release assets and npm registry versions are separate; an unpinned npm command may select an older release. See [tagged-release installation](https://github.com/thesammykins/FlixBridge/blob/main/docs/installation.md#tagged-github-release).

Sonarr API policy is per instance: omission preserves v3 without discovery; explicit `3` or `5` discovers and verifies that family; `auto` uses v5 only for reviewed workflows and retains v3 for unported operations when advertised. Strict v5 rejects those operations before writes. A Sonarr application version is not its HTTP API family. See [configuration and route limits](https://github.com/thesammykins/FlixBridge/blob/main/docs/configuration.md#sonarr-api-policy).

The SDK serves current MCP `2026-07-28` and legacy stdio clients, with bounded dispatch and request cancellation. Cancellation is not rollback: accepted upstream work may continue. Pending imports remain in legacy failed counts with additive pending evidence; do not resubmit blindly. See [transport and validation](https://github.com/thesammykins/FlixBridge/blob/main/docs/api-reference.md#transport-and-validation), [migration and rollback](https://github.com/thesammykins/FlixBridge/blob/main/docs/installation.md#migration-and-rollback), and [security boundaries](https://github.com/thesammykins/FlixBridge/blob/main/docs/security-audit.md).

CI verifies only; publishing an exact reviewed artifact/version requires separate final maintainer approval.

## Development

```bash
git clone https://github.com/thesammykins/FlixBridge.git
cd FlixBridge
npm ci --include=dev --ignore-scripts
npm run build
npm run check
npm test
```

Read [AGENTS.md](https://github.com/thesammykins/FlixBridge/blob/main/AGENTS.md) before contributing. Unit tests use mocks; MCP tests exercise local stdio/client/HTTP boundaries without a live media stack. Live scripts are separate. `npm run smoke` uses read-only diagnostics by default in this source, but contacts configured services and enables debug logs; inspect it and obtain authority before live use.

## Support

If Flixbridge is useful to you, you can support its development.

<a href="https://ko-fi.com/sammykins/tip"><img src="https://cdn.prod.website-files.com/5c14e387dab576fe667689cf/670f5a01c01ea9191809398c_support_me_on_kofi_blue.avif" alt="Support Flixbridge on Ko-fi" height="32"></a>

[MIT license](https://github.com/thesammykins/FlixBridge/blob/main/LICENSE).
