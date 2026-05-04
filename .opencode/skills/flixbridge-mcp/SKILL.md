---
name: flixbridge-mcp
description: Use when operating, validating, or troubleshooting the FlixBridge Arr MCP server, especially Sonarr/Radarr/SABnzbd queue, import, downloader, diagnostics, safe production mutation, and agent-browser UI validation workflows.
---

# FlixBridge MCP

## Required Order

- Call `list_services` first and use only returned service/downloader names.
- Treat all other tool calls as scoped to one returned `service` unless the tool explicitly accepts multiple services.
- Keep outputs in the stable `{ ok, data?, error? }` contract; do not infer success from missing errors alone.

## Read-Only Baseline

- Run `system_status` for each target Arr service.
- Run `queue_list` with a bounded `pageSize`.
- Run `import_issues` for missing/import problem context.
- Run `queue_diagnostics` with `autoFix:false` for production baselines.
- Run `download_status` when a downloader is configured.
- Run `server_metrics` before and after validation work.

## Mutation Rules

- Assume `queue_diagnostics` and `all_services_diagnostics` mutate unless `autoFix:false` is explicitly set.
- Prefer `remove_content` with `dryRun:true` before any queue, library, or downloader removal.
- Execute `remove_content` only with the same ids/options and the returned `confirmationToken`.
- Limit production mutations to reviewed `Sample`, not-an-upgrade, explicit retry, or unambiguous manual-import cases.
- Do not delete downloader data with `deleteFiles:true` unless explicitly approved for that item or batch.

## Stuck Queue Triage

- For `Sample` items, require matching MCP and UI evidence by service, queue id, title/path, download id, status, and reason.
- For not-an-upgrade items, require diagnostics text such as not-a-custom-format-upgrade or does-not-improve-existing before queue removal.
- For `Found matching series via grab history...Automatic import is not possible`, attempt manual import only when the candidate maps to exactly one matching series/movie id and the UI agrees.
- If MCP output and UI disagree on target identity, stop and ask before mutating.

## Browser Validation

- Use the `agent-browser` skill for Sonarr, Radarr, and SABnzbd UIs only.
- Before starting, run `agent-browser --version` and `agent-browser session list`; record pre-existing sessions.
- Use a new named session for validation, take snapshots/screenshots before and after mutation, then close sessions created during the task.
- Use the UI for evidence and verification; prefer MCP tools as the primary mutation path.

## Evidence To Capture

- Service/downloader names from `list_services`.
- Tool input and structured output with secrets omitted.
- Queue item id, title, output path, download id, status, reason, and proposed action.
- UI screenshot or extracted UI text proving the same target.
- Before/after `queue_list`, `queue_diagnostics autoFix:false`, `download_status`, and `server_metrics` summaries.
- Recovery path for each approved mutation, usually re-search or re-grab.

## Local Verification

- Run `npm run check` after docs or code edits.
- Run `npm run lint`, `npm test`, and `npm run build` for behavior changes.
- Run `npm run smoke` only when environment variables point at the intended instance and no mutating defaults are enabled.
