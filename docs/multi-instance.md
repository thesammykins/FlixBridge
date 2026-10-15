# Multiple instances

Each ARR instance is a distinct mutation boundary: its IDs, root folders, profiles and queues are not interchangeable. Configure instances by slug; no JSON mappings or config files are supported.

```bash
export SONARR_MAIN_URL="http://localhost:8989"
export SONARR_MAIN_API_KEY="replace-with-main-sonarr-key"
export SONARR_4K_URL="http://localhost:8990"
export SONARR_4K_API_KEY="replace-with-4k-sonarr-key"
export RADARR_MAIN_URL="http://localhost:7878"
export RADARR_MAIN_API_KEY="replace-with-radarr-key"
export SABNZBD_MAIN_URL="http://localhost:8080"
export SABNZBD_MAIN_API_KEY="replace-with-sabnzbd-key"
```

These names become `sonarr-main`, `sonarr-4k`, `radarr-main`, and `sabnzbd-main`. Slugs allow uppercase letters, digits and underscores; underscores become hyphens. Optional `_NAME` overrides the registry name. ARR names must contain the correct service keyword; avoid both keywords in one name. Assign unique names: duplicate ARR slug names fail; fallback collisions and downloader names can still overwrite. See [configuration](configuration.md) for aliases and fallback merge behavior.

Sonarr API policy is independent for each instance. For example,
`SONARR_MAIN_API_VERSION=auto` does not change `sonarr-4k`; omission there keeps
legacy v3 without discovery. Explicit `3` opts into discovery/verification; strict
`5` rejects unported removal/import-issue/auto-fix/file-delete workflows. See
[policy and reviewed routes](configuration.md#sonarr-api-policy).

## Route deliberately

1. Restart the server after configuration changes, then call `list_services`.
2. Verify each instance using `system_status` (inspect advertised/verified/effective API metadata), `root_folders` and `quality_profiles`. Offline `list_services.data.services[].apiPolicy` is configured intent, not a probe.
3. Select the intended instance from operator policy, not a guessed title/category or an ID from another instance.
4. Use read-only diagnostics explicitly:

```json
{"tool":"all_services_diagnostics","arguments":{"autoFix":false}}
```

```json
{"tool":"download_status","arguments":{"services":["sonarr-main","sonarr-4k","radarr-main"],"includeDownloader":true,"downloader":"sabnzbd-main"}}
```

Combined download status reports a selected downloader; it is not a guaranteed inventory of every download client. Configuring SABnzbd in FlixBridge does not configure ARR download clients, categories, or storage mappings. Keep those settings correct in the upstream services.

Names can influence heuristic profile recommendations, but they are not an enforced quality policy. Read the target instance's profiles and choose an explicit `qualityProfileId`. For existing media, authorized `update_quality_profile` takes that instance's library `itemId`; it has no dry-run/token gate and does not trigger a search.

Plex configuration is a single independent URL/token pair, not slug-discovered. Plex report matching examines registered ARR services; if multiple instances match, explicitly review and select the intended service before remediation.

Separate deployments can have the same ports on different hosts; uniqueness is needed only where bindings conflict. FlixBridge does not create instances, isolate their databases, migrate media, or back up the stack. Those remain upstream/operator responsibilities.

## Check wrong-instance problems

Confirm exact discovered name, URL host/port, key and intended root folders. Do not dump the process environment into shared logs. After changes, take a new baseline with `autoFix:false` and recreate stale previews/tokens. For any mutation, verify the exact target instance and any affected downloader independently.

See [safe usage](usage.md), [troubleshooting](troubleshooting.md), and [deployable skills](../skills/README.md).
