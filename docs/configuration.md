# Configuration

FlixBridge reads the process environment only. It does not load `config.json`, JSON-in-env mappings, or `.env` files. Supply variables through your MCP client's environment settings or an external launcher. Startup accepts an ARR integration or a configured Plex/Jellyfin media server. Media-only reads do not create ARR cleanup targets; SABnzbd-only is not a standalone MCP startup configuration. CLI `run-due` also permits empty configuration when there are no configured sources/rules to read. All entry points share environment-only source configuration; private rule/approval state is separate, not a second credential/config file.

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
| Existing queue/library removal, file deletion, diagnostics auto-fix | `prepareRemoval`, `executeRemoval`, `deleteFile`, `queueDiagnosticsAutoFix` remain v3 | `auto`: advertised/verified v3; strict `5`: unsupported |

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

## Library, watch and review providers

| Provider | Fallback configuration | Multiple instances |
| --- | --- | --- |
| Plex library/watch | `PLEX_URL` or `PLEX_BASE_URL`, `PLEX_TOKEN` | `PLEX_<SLUG>_URL` or `_BASE_URL`, `_TOKEN`, optional `_NAME` |
| Jellyfin | `JELLYFIN_URL` or `JELLYFIN_BASE_URL`, `JELLYFIN_API_KEY` (aliases `_TOKEN`, `_KEY`) | `JELLYFIN_<SLUG>_URL` or `_BASE_URL`, `_API_KEY` (aliases `_TOKEN`, `_KEY`), optional `_NAME` |
| Optional TMDB reviews | `TMDB_API_TOKEN` (alias `TMDB_TOKEN`) or `TMDB_API_KEY` | One optional provider; bearer token preferred |

The library media-server loader supports `FLIX_BRIDGE_` aliases, rejects conflicting aliases/duplicate names, and preserves reverse-proxy prefixes. A slug becomes a lowercase hyphenated name; use `list_services.data.mediaServers` rather than guessing. These aliases do not change the older Plex report integration's separate credential rules above. Keep all ARR/downloader/media names distinct. Remote discovery/status and per-operation permissions are separate from configured capability.

Plex watch summaries are per token-user, never implicitly the server owner. Bind each selected server-local account explicitly under its configured server prefix:

```text
PLEX_HOME_USER_ALICE_ID=<account ID observed on plex-home>
PLEX_HOME_USER_ALICE_TOKEN=<that account's securely injected token>
```

Alternatively `PLEX_HOME_USER_ID` binds the main `PLEX_HOME_TOKEN` to that one account. User discovery is `library_list` with `scope:"users"`. Bindings are operator assertions plus membership checks, not cryptographic proof of token ownership. Unbound users and conflicting tokens fail; the owner token is not a fallback. Global account/session/history reads use the main server token and require appropriate visibility. PMS playback history is bounded events, not proof of playback completion or lifetime coverage. Plex favourites/watchlist are unsupported; ratings are not favourites. Cleanup blocks by default unless explicit `allowUnsupportedFavourites:true` acknowledges this missing capability. Permission/transport/schema failures cannot be waived by that flag.

Use a Jellyfin administrative API key with visibility of selected users and all sessions; the reviewed elevated `/Auth/Providers` probe must succeed before session coverage is trusted. `Played`, position and last-played data are summaries. Jellyfin core playback-event history is unsupported here; an empty history array is not evidence of never watched.

### Exact file copies and mount mappings

Provider IDs alone do not distinguish physical HD/UHD or edition copies. Watch evidence requires matching Jellyfin `MediaSources.Path` or Plex `Media.Part.file` to the ARR files. Missing, mismatched, merged or ambiguous source paths remain unknown; active sessions are inspected globally, including playing metadata not visible in the selected user's library. Unresolved playing-copy identity cannot prove that cleanup is safe. Jellyfin favourite protection includes the root, relevant seasons and episodes; a known watch flag does not establish a last-played age when any relevant watched leaf lacks a timestamp.

When ARR and the media server see different mount roots, configure explicit pairs under the selected server's prefix:

```text
JELLYFIN_HOME_PATH_TV_ARR_ROOT=/arr/tv
JELLYFIN_HOME_PATH_TV_SERVER_ROOT=/library/tv
PLEX_HOME_PATH_MOVIES_ARR_ROOT=/arr/movies
PLEX_HOME_PATH_MOVIES_SERVER_ROOT=/library/movies
```

The contract is `<SERVER_PREFIX>_PATH_<NAME>_ARR_ROOT` plus `_SERVER_ROOT`, with an uppercase alphanumeric/underscore name. Use the same prefix as that instance's credentials, including `FLIX_BRIDGE_` when selected. No mapping means literal path equality. Matching uses canonical absolute path components, not title similarity, case-folding or symlink resolution; incomplete, overlapping or ambiguous pairs fail closed. UNC/noncanonical paths and multipart or merged editions remain unproven and blocked. These mappings do not change files or upstream mount configuration. Selected endpoint, actual server identity, credentials and user/path bindings are fingerprinted into approval authority without exposing secret values.

TMDB is contacted only when `media_detail` requests `includeReviews:true` and an exact TMDB ID exists. Review text/author/source links are untrusted display data, not executable retention conditions. ARR ratings separately retain their source, numeric scale and votes. See [provider contracts](library-provider-contracts.md).

New ARR library/detail/watch joins/calendars/retention snapshots require reviewed v3. Strict v5 and `auto` selecting v5 are unsupported. New season/file/monitoring mutations reject `auto` as well as strict v5 instead of silently downgrading; configure an intentionally reviewed v3 instance for them. Existing tools retain the route policy table above.

## Private state and human approval

| Variable | Contract |
| --- | --- |
| `FLIX_BRIDGE_STATE_DIR` | Explicit absolute private local state directory; no default. Stores `approvals.json` and `retention/rules.json` plus locks/temp files, never source credentials |
| `FLIX_BRIDGE_APPROVAL_SECRET` | At least 32 bytes; securely generated/injected HMAC secret for trusted bridge/adapter and optional outbound notifier, never MCP arguments or model context |
| `FLIX_BRIDGE_APPROVAL_ACTORS` | Explicit comma-separated stable authenticated actor IDs; no implicit trusted human |
| `FLIX_BRIDGE_APPROVAL_WEBHOOK_URL` | Optional notification receiver; HTTPS or literal loopback HTTP only, no userinfo/query/fragment |

Prepare a canonical, owned `0700` directory under a trusted existing parent; approval ledger files must be owned regular single-link `0600` files without symlink components. Protect rules, approvals and backups as private operational data. Rules are created disabled. State contains exact plans and outcomes, not permission to edit records into approved state. Do not remove consumed/rejected records to bypass authority or automatically restore old approval backups for replay. New retention subdirectories/files are created private; operators must protect existing paths too.

The ordinary MCP store needs no signing credential to create/read/cancel/claim records. Keep callback credentials in a separately supervised trusted bridge/adapter; if optional outbound notifications run in the MCP process, it also needs the signing secret but must not expose it to the model/tool surface. The host/UID controlling that environment and adapter is trusted. Optional webhook failure leaves the request pending and is not automatically retried; delivery acknowledgement is not approval.

`flixbridge-retention bridge --port 8787` explicitly starts a loopback callback listener at `127.0.0.1`; MCP startup does not. A trusted messaging adapter must authenticate the human clicking signed approve/reject references or replying yes/no to one uniquely bound request/full hash. It sends a signed `POST /approvals/decision` with exact actor/request/hash/decision and fresh nonce. There is no bare yes/no HTTP endpoint and no MCP approval tool. See the [approval protocol](approval-protocol.md) for HMAC domains, raw-byte signing, expiry and replay checks, [rules/CLI](retention-rules.md) for opt-in scheduling examples, and [migration](retention-migration.md) before changing callers.

## Debugging and changes

`FLIX_BRIDGE_DEBUG=1` enables stderr debug logging. Restart the client-managed server after changing environment variables; configured instance discovery occurs at startup; opted-in Sonarr API-family discovery is lazy and cached for five minutes. There is no supported timeout/retry environment setting or built-in automatic HTTP retry. Review and redact debug output before sharing it.

Next: [installation](installation.md) · [usage](usage.md) · [troubleshooting](troubleshooting.md).

## URL and HTTP security

ARR/SABnzbd configuration accepts HTTP(S) URLs only, without userinfo, query or fragment; invalid complete pairs fail configuration rather than being silently repaired. ARR reverse-proxy base paths are preserved: `https://media.example/sonarr` discovers `/sonarr/api` and calls `/sonarr/api/v3/...` or `/sonarr/api/v5/...`. Plex validates its configuration separately; inspect the deployed implementation before assuming identical restrictions.

Read-only GET/HEAD requests follow only same-origin redirects, at most five hops; userinfo/cross-origin redirects are rejected before forwarding credentials. Destructive SABnzbd GETs and other mutating HTTP methods reject redirects before resend, including same-origin redirects between API families; a redirect is not permission to replay a mutation. The default five-second timeout covers response-body reads as well as fetch/redirects. Bodies are capped at 8 MiB. Some operations override timeout (queue DELETE accepts `queueTimeoutMs` 1000–60000); there is no general timeout/size environment knob.

HTTP is still allowed for trusted local deployments; HTTPS and network isolation remain operator responsibilities. Same-origin redirects are not a hostname allowlist, DNS-rebinding defense or general SSRF prevention. Keep credentialed URLs under operator control. See [security evidence and remaining limitations](security-audit.md).
