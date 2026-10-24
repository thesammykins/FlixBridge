# Deployable FlixBridge agent skills

- `flixbridge-operations`: service discovery, read-only monitoring and authorized queue triage.
- `flixbridge-plex-reports`: Plex reported-issue review and authorized remediation.

## Install

1. Configure a working FlixBridge MCP server in your agent host using the project's README and your host's MCP documentation. These skills do not install or configure the server.
2. Obtain the folders from this Git repository (they are not included in the npm package), then copy each desired skill folder (including its `SKILL.md`) into the skills directory supported by your host. Consult the host's documentation for its directory location, skill discovery and reload procedure; there is no universal installation command.
3. Confirm that the host loads the skill and exposes FlixBridge tools. Call `list_services` first. Tool names below are server names; select the corresponding tools exposed by your host without assuming a particular namespace.
4. For Plex reports, the server also needs `PLEX_BASE_URL` (or `PLEX_URL`) and `PLEX_TOKEN`, supplied through your normal secure configuration mechanism. Never put credentials in skill files or conversation output.

Both folders are standalone: neither requires another skill, a browser package, scheduled jobs or a particular agent host. Use the installed server's discovered schemas as authoritative if its version differs. Missing tools or configuration are blockers, not permission to invent substitutes.

## Safety contract

Inspection is the default. Skills grant no permission to mutate services: obtain explicit user authorization for the concrete action and bounded targets, including comments, searches, imports and deletions. A preview or confirmation token is not user authorization. Every explicit removal scope and monitoring execution requires durable human `approvalId`; no MCP self-approve tool exists. A trusted separate adapter must authenticate the allowlisted human and bind signed buttons or yes/no replies to one exact request/full hash. Optional schedules evaluate/request decisions only, never approve/delete. See [provider contracts](../docs/library-provider-contracts.md), [approval protocol](../docs/approval-protocol.md), [rules/CLI](../docs/retention-rules.md), [policy options](../docs/retention-policy-options.md) and [migration](../docs/retention-migration.md). Keep diagnostics explicitly `autoFix:false`; preserve exact preview targets/options and verify changes with readback. Redact private data from summaries.
