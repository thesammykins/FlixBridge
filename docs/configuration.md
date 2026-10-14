# Configuration

FlixBridge reads the process environment only. It does not load `config.json`, JSON-in-env mappings, or `.env` files. Supply variables through your MCP client's environment settings or an external launcher. At least one complete Sonarr or Radarr URL/key pair is required; SABnzbd-only and Plex-only setups cannot start the server.

## Single instance

| Kind | URL | Credential | Discovered name |
| --- | --- | --- | --- |
| Sonarr | `SONARR_URL` | `SONARR_API_KEY` | `sonarr` |
| Radarr | `RADARR_URL` | `RADARR_API_KEY` | `radarr` |
| SABnzbd (optional) | `SABNZBD_URL` | `SABNZBD_API_KEY` | `sabnzbd` |

`_KEY` is an alias for `_API_KEY`. `FLIX_BRIDGE_` prefixed aliases are supported for these three kinds. Single-instance fallback precedence is unprefixed URL before prefixed URL; credentials are unprefixed `_API_KEY`, unprefixed `_KEY`, prefixed `_API_KEY`, then prefixed `_KEY`. Avoid defining competing aliases.

```bash
export SONARR_URL="http://localhost:8989"
export SONARR_API_KEY="replace-with-sonarr-api-key"
export RADARR_URL="http://localhost:7878"
export RADARR_API_KEY="replace-with-radarr-api-key"
```

Use URLs reachable from the server process, not necessarily from your browser. Do not append `/api/v3` or `/api/v5`; retain any configured reverse-proxy base path. ARR API keys are available in Settings → General; SABnzbd uses its full API key from Config → General, not the NZB-only key. Do not commit credentials.

## Multiple instances

Use `<KIND>_<SLUG>_URL`, `<KIND>_<SLUG>_API_KEY` (or `_KEY`), and optional `<KIND>_<SLUG>_NAME`, where kind is `SONARR`, `RADARR`, or `SABNZBD`. Slugs match uppercase letters, digits and underscores. The optional `FLIX_BRIDGE_` prefix is accepted.

Names default to lowercase `<kind>-<slug>`, with underscores converted to hyphens. ARR custom names must contain their correct `sonarr` or `radarr` keyword; avoid including both. A SABnzbd slug `_NAME` changes the registry name, not just a label. Single-instance `SABNZBD_NAME` changes its display label but leaves its registry name `sabnzbd`.

Fallback and slug entries are merged; slug entries overwrite matching fallback names. Duplicate names within the ARR slug map and wrong-kind/ambiguous ARR names fail configuration. Fallback-name collisions still merge by overwrite, and SABnzbd names can overwrite: assign unique names. URL/key slug alias conflicts depend on environment iteration order, not a guaranteed alias priority. Incomplete pairs are ignored. See [multi-instance setup](multi-instance.md).

## Sonarr API policy

For the pinned upstream contract comparison and follow-on feature proposals, see
[Sonarr v3 → v5 changes](sonarr-api-changes.md).

Set `SONARR_API_VERSION` for the fallback instance, or `SONARR_<SLUG>_API_VERSION`
for one slug. `FLIX_BRIDGE_SONARR_API_VERSION` and
`FLIX_BRIDGE_SONARR_<SLUG>_API_VERSION` are aliases. Values are exactly `3`, `5`,
or `auto`: no whitespace, empty value, `v5`, or application-version number.
Conflicting policy aliases fail startup; equal aliases are accepted. The fallback
policy does not implicitly apply to other slugs. `API_VERSION` on Radarr or SABnzbd
is rejected; Plex has no such selector.

| Policy | Behavior |
| --- | --- |
| Omitted | Legacy v3, no `/api` discovery; keeps existing deployment routing |
| `3` | Authenticated `/api` discovery plus advertised-v3/status verification; not the same as omission |
| `5` | Discovery plus advertised-v5/status verification; unported workflows fail before writes |
| `auto` | Uses v5 for reviewed workflows only when current is `v5`; otherwise uses advertised v3 where reviewed. No speculative future-family routing |

Discovery validates `current`/`deprecated`; a family is verified with its read-only
`/system/status` response (`appName: Sonarr`, nonempty version). Authentication,
network, schema or route failures are errors, not permission to downgrade. The
five-minute cache is per instance. A workflow's reads/writes/readback use one family;
previewed imports/removals retain that family through execution. No failed write is
replayed on a different family.

### Reviewed routes and limits

| Workflow | v5 route/contract | `auto` / strict `5` |
| --- | --- | --- |
| Status, queue, root folders, history | `/system/status`, `/queue`, `/rootfolder`, `/history` or `/history/since?date=...` | Reviewed v5 |
| Read-only diagnostics | `/queue`, reviewed v5 evidence fields | Reviewed v5; `autoFix:true` is separate |
| Search, profiles and library/file lookup | `/series/lookup`, `/qualityprofile`, `/series`, `/episode` and file reads | Reviewed v5 |
| Add and profile update | `/series` POST, full-object GET/PUT/readback; add requires one exact TVDB lookup with validated language/seasonType | Reviewed v5; invalid metadata fails before POST |
| Queue grab and search command | `/queue/grab/{id}` or `/queue/grab/bulk`, `/command` | Reviewed v5; acceptance is not completion |
| Manual import | `/manualimport` with plural `downloadIds`, v5 rejection `message`/`type`; POST `/command` with `ManualImport` | Reviewed v5; reprocessing is not execution |
| Library statistics | GET `/statistics` | v5 only; unsupported on omitted/`3` or v3-only `auto`, no library scan |
| `import_issues` | `/wanted/missing` workflow remains v3 | `auto`: advertised/verified v3; strict `5`: unsupported |
| Queue/library removal, file deletion, diagnostics auto-fix | `prepareRemoval`, `executeRemoval`, `deleteFile`, `queueDiagnosticsAutoFix` remain v3 | `auto`: advertised/verified v3; strict `5`: unsupported |

Thus a v5-current instance with advertised v3 may intentionally use both families
across **different** operations, never within a frozen workflow. `remove_content`
remains v3 even if it attempts an import internally; direct `manual_import` can use
v5. Plex `remove_and_regrab` depends on unported file deletion and is not supported
under strict v5; search/add actions use reviewed routes but still require authority.
Radarr stays v3; SABnzbd and Plex keep their own APIs. No general administration tools
are added. Application version, advertised API, verified family and operation support
are distinct facts.

`list_services.data.services[].apiPolicy` reports configured Sonarr policy offline; it does not probe upstream.
`system_status.data.api` reports `configuredPolicy` (`legacy`, `3`, `5`, or `auto`),
advertised `current`/`deprecated`, `verifiedFamilies` and `effectiveOperations`
(`3`, `5` or `unsupported`). Omitted policy has no advertised current family. The map
expresses routing policy, not proof every endpoint was exercised.

```bash
export SONARR_MAIN_API_VERSION="auto"
export SONARR_4K_API_VERSION="3"
```

Use `auto` only after reviewing these limits for that instance; do not add a policy
merely to copy an example. See [migration and rollback](installation.md#migration-and-rollback).

## Plex reported issues

```bash
export PLEX_BASE_URL="http://localhost:32400"
export PLEX_TOKEN="replace-with-plex-account-token"
```

`PLEX_URL` is a fallback alias for `PLEX_BASE_URL`. `PLEX_TOKEN` has no `_API_KEY`, slug, or `FLIX_BRIDGE_` alias. Plex is configured separately from the ARR/SABnzbd registry; `list_services` does not enumerate it.

The token must authorize both the reported-issue account feed at `https://community.plex.tv/api` and the configured Plex Media Server's metadata. The same token is used for both. Network access to the cloud feed and PMS is required. This is the user Report Issue feed, not PMS server error logs. Keep the token secret and do not put it in example URLs.

## Debugging and changes

`FLIX_BRIDGE_DEBUG=1` enables stderr debug logging. Restart the client-managed server after changing environment variables; configured instance discovery occurs at startup; opted-in Sonarr API-family discovery is lazy and cached for five minutes. There is no supported timeout/retry environment setting or built-in automatic HTTP retry. Review and redact debug output before sharing it.

Next: [installation](installation.md) · [usage](usage.md) · [troubleshooting](troubleshooting.md).

## URL and HTTP security

ARR/SABnzbd configuration accepts HTTP(S) URLs only, without userinfo, query or fragment; invalid complete pairs fail configuration rather than being silently repaired. ARR reverse-proxy base paths are preserved: `https://media.example/sonarr` discovers `/sonarr/api` and calls `/sonarr/api/v3/...` or `/sonarr/api/v5/...`. Plex validates its configuration separately; inspect the deployed implementation before assuming identical restrictions.

Shared HTTP requests follow only same-origin redirects, at most five hops; userinfo/cross-origin redirects are rejected before forwarding credentials. The default five-second timeout covers response-body reads as well as fetch/redirects. Bodies are capped at 8 MiB. Some operations override timeout (queue DELETE accepts `queueTimeoutMs` 1000–60000); there is no general timeout/size environment knob. Redirect method semantics may turn POST into GET for 301/302/303.

HTTP is still allowed for trusted local deployments; HTTPS and network isolation remain operator responsibilities. Same-origin redirects are not a hostname allowlist, DNS-rebinding defense or general SSRF prevention. Keep credentialed URLs under operator control. See [security evidence and remaining limitations](security-audit.md).
