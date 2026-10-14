# Troubleshooting

Begin with read-only MCP calls: `list_services`, then `system_status` and `queue_list` for the affected instance. For diagnostics explicitly pass `autoFix:false`. `npm run smoke` contacts configured services and enables debug output; its diagnostics inherit the read-only default in this source. Inspect live scripts and obtain authority before using them against a stack.

## Server will not start or tools are missing

- Confirm Node.js 20 or later and that the client can find `node`, `npx`, or `flixbridge`. GUI client PATH and environment may differ from your shell. Use absolute executable paths if needed.
- Supply a complete Sonarr or Radarr URL/key pair to the server process. SABnzbd or Plex alone does not satisfy startup requirements; incomplete pairs are ignored.
- No `config.json`, JSON mapping variable, or automatic `.env` loader exists. See [configuration](configuration.md).
- For a checkout, run `npm ci --include=dev --ignore-scripts` and `npm run build`, then point the client at its absolute `dist/index.js`. The npm package runs its own built release; local source changes do not affect `npx @thesammykins/flixbridge`.
- Restart/reconnect after configuration changes. A published release may lack tools present in source; check the deployed version and actual discovered schema.
- The server waits for MCP over stdio, not a web request. It closes when stdin ends. Keep stdout exclusively for MCP; send logs to stderr, never merge stderr into stdout.

## Service not found or wrong instance

Call `list_services` again and use exact returned names. Slugs become lowercase hyphenated names; `_NAME` can override them. ARR names must contain the correct `sonarr` or `radarr` keyword. Duplicate ARR slug names fail configuration; fallback-name collisions and downloader names can still overwrite. Check the URL and key for the intended instance without publishing credentials. Single-instance fallback and slug entries can both be configured.

## Authentication, network and timeout failures

Check connectivity from the server's runtime, including DNS, firewall, proxy, TLS trust, and upstream bind address. `localhost` refers to that runtime; it need not be the host running your browser. Use the service base URL, preserving its reverse-proxy prefix but without `/api/v3` or `/api/v5`. Use the full API key, not SABnzbd's NZB-only key.

HTTP 401/403 can mean wrong credentials or upstream policy. Do not repeatedly mutate while investigating. The shared HTTP timeout defaults to five seconds, with some operations overriding it; there is no supported timeout environment setting or automatic HTTP retry. Inspect the upstream health/logs. After an execution timeout, read back state before retrying: upstream work may already have happened.

## Sonarr API-family failures

Check the affected instance's configured `apiPolicy` and `system_status.data.api`;
a Sonarr application version does not select its HTTP API. Omission is legacy v3
without discovery, whereas explicit `3` requires discovery/verification. `auto`
intentionally reports v3 for unported workflows even on v5-current Sonarr.
Strict `5` rejects removal, import issues, auto-fix and file deletion before writes.
Do not solve auth/network/schema errors by silently downgrading or replaying writes.
Statistics is v5-only; no legacy/Radarr scan is available. Review
[policy/routes](configuration.md#sonarr-api-policy) before changing configuration.

## Stuck queue or import failure

Inspect `queue_list`, `history_detail`, `import_issues`, and `queue_diagnostics` with `autoFix:false`. Preserve manual-investigation cases; do not set `allowManualRemoval:true` simply to suppress a guard. Check upstream paths/permissions and candidate identity before previewing `manual_import` or `remove_content`.

An import command can be accepted while files are still pending or rejected later. Pending entries remain failed in the legacy counts, with additive `pending`/`commandId` evidence. The tool reads command status once; it does not resume pending imports automatically. Inspect the existing command, complete queue coverage and exact library files rather than resubmit; process-local replay guards do not survive restart. “Not an upgrade”, unknown media, pack mismatch, and missing-file findings are not blanket authority to delete a download.

## Confirmation failure or partial execution

Import/removal tokens are process-local and expire after five minutes. Plex remove-and-regrab tokens expire after ten minutes and bind to the concrete report/action/service/library item/movie file/episode file/resolved title. Restart, expiry or scope/options changes require a fresh preview and approval. Do not reuse a consumed token or blindly repeat an execution after a timeout/partial error. Inspect per-item results and independently read affected state first.

## Plex report failures

Set `PLEX_BASE_URL` (or fallback `PLEX_URL`) and `PLEX_TOKEN`. Plex is separate from `list_services`. The same token must authorize the cloud reported-issue feed at `community.plex.tv` and the configured PMS metadata. A reachable PMS alone does not prove feed access.

Missing/expired metadata, ambiguous ARR matches, or a report outside the first 100 fetched during remediation can make remediation unavailable. The report tool returns one bounded page and up to 20 comments per report; it is not a full feed audit. Fixed/pending threads and duplicate clarification are guarded. Destructive remediation rejects fuzzy or ambiguous targets; confirm the unique instance and media/file identity.

Plex remediation executes when `dryRun` is omitted; explicitly preview with `dryRun:true`. Comment-derived “fixed” is not playback proof. If report comment posting fails after accepted media actions, execution returns a partial failure; read back both systems rather than repeating actions. Generated `Pending:` comments mean submitted work, not fixed playback. See [usage](usage.md#plex-reports).

## Evidence to collect

Collect deployed package/source version, Node version, tool name and sanitized arguments, exact instance name, actual error and relevant upstream logs. Never attach raw environment dumps, API keys, Plex tokens or unnecessary reporter details.

For a source checkout, local checks are:

```bash
npm run build
npm run check
npm test
```

These do not verify live services. Enable `FLIX_BRIDGE_DEBUG=1` in the client-managed process only when needed and review/redact logs before sharing them. Inspect live diagnostic scripts and obtain mutation authority before running them.

See [installation](installation.md), [agent rules](../RULE.md), and [deployable playbooks](../skills/README.md).
