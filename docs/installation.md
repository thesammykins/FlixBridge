# Installation

Requires Node.js 20 or later, npm, an MCP client supporting stdio, and a reachable Sonarr or Radarr instance with an API key. SABnzbd and Plex are optional integrations, not standalone startup configurations.

## Tagged GitHub release

GitHub release assets and npm registry publication are separate. To install the exact
1.0.0 package attached to the `v1.0.0` GitHub release:

```bash
npm install -g https://github.com/thesammykins/FlixBridge/releases/download/v1.0.0/thesammykins-flixbridge-1.0.0.tgz
flixbridge
```

Compare the downloaded file with `SHA256SUMS` from the same release before installation.
The source tag is `v1.0.0`; to build that revision, check it out explicitly after cloning.
An unversioned npm-registry install below does not imply that it selects 1.0.0.

## npm release

Run the published package without a source checkout:

```bash
npx -y @thesammykins/flixbridge
```

Supply [environment variables](configuration.md) first. To install the executable globally:

```bash
npm install -g @thesammykins/flixbridge
flixbridge
```

Or install locally and use the local executable via `npx flixbridge` from that project. The npm artifact contains built `dist/`, README and license; it does not provide repository scripts, tests, docs or skills. Do not run `npm run build`, `npm run dev`, or `npm run smoke` as package-install instructions. Pin a chosen published version for repeatable deployments; a source checkout can have tools absent from the installed release.

## Source checkout

```bash
git clone https://github.com/thesammykins/FlixBridge.git
cd FlixBridge
npm ci --include=dev --ignore-scripts
npm run build
npm start
```

`npm start` runs `node dist/index.js` and needs a successful build. `npm run dev` runs `tsx src/index.ts` with development dependencies. Rebuild after source changes before running `dist/`.

For a client-managed source deployment use `command: "node"` and `args: ["/absolute/path/to/FlixBridge/dist/index.js"]`. Use absolute executable paths too if the client's PATH does not contain Node/npm. Running `npx @thesammykins/flixbridge` still selects the npm package, not this checkout.

## MCP client setup and verification

See the [README configuration example](../README.md#connect-an-mcp-client); client configuration locations and restart procedures are client-specific. Supply credentials to the launched process: GUI clients need not inherit shell exports.

1. Restart/reconnect the configured MCP server and discover its tools.
2. Call `list_services`; confirm exact instance names.
3. Call `system_status` and `queue_list` for each intended ARR service. Use `queue_diagnostics` with explicit `autoFix:false` if inspecting import problems. For Plex, call `reported_issues` after configuring its variables.

The server communicates over stdin/stdout; it is not an HTTP endpoint. Waiting silently for an MCP client is normal. EOF on stdin closes the server. Logs go to stderr; do not redirect them into the protocol stream. Current MCP `2026-07-28` and legacy initialization are served by the SDK; see [transport details](api-reference.md#transport-and-validation). Cancelling a request does not undo work already accepted by ARR/Plex/SABnzbd.

## Migration and rollback

1. Record the deployed package/source version, launch command and exact configured
   instance names privately. Keep the previous artifact/configuration available;
   take upstream backups under your normal Sonarr/Radarr operational policy.
2. Build/check/test the reviewed candidate in an isolated checkout. Pin the chosen
   artifact in the client; do not assume an unversioned `npx` command selects it.
   Reconnect the server and discover tools before using new fields/tools.
3. Leave Sonarr `API_VERSION` omitted to preserve v3 without new discovery requests.
   Opt in per instance only after reviewing [routes/limitations](configuration.md#sonarr-api-policy).
   Explicit `3` is not omission: it adds discovery/verification. Read `list_services`
   policy and `system_status` metadata, then baseline queues/diagnostics with
   `autoFix:false`; failed/partial coverage is not a clean baseline.
4. Refresh all previews after restart, policy changes or drift. Obtain separate
   authority for mutations; inspect command and exact-target readback before any
   retry. Pending imports are not automatically resumed. Preserve their downloads.
5. To roll back software, restore the previous reviewed artifact and configuration,
   reconnect and repeat read-only checks. To restore legacy routing, remove **all**
   policy aliases for that instance (setting `3` still opts into discovery).

Rollback does not undo media deletion, adds, profile changes, searches or comments.
Stopping/cancelling the server may leave upstream commands running. Inspect pending
work in the upstream API/UI first; restart loses tokens and process-local replay
guards. Any compensating write or backup restore needs its own authority. Do not
blindly replay a v5 failure against v3 or downgrade just to bypass an unported guard.
CI is verification-only; release publication requires separate maintainer approval.

## Source checks

```bash
npm run build
npm run check
npm test
```

These are local development gates; unit tests use mocks and MCP tests exercise local boundaries, not live service credentials. `npm run smoke` contacts configured services and enables debug logging. Its diagnostics call inherits the read-only default in this source; that does not make every other live script safe or provide production verification. Inspect scripts and use only an authorized test stack, not a default production health check.

Deploy reusable playbooks separately from [skills/README.md](../skills/README.md). See [usage](usage.md) and [troubleshooting](troubleshooting.md).
