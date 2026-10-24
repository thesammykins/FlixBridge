# Installation

Requires Node.js 20 or later, npm and an MCP client supporting stdio. Configure a reachable ARR or Plex/Jellyfin media-server integration; media-only reads are supported, but ARR targets and explicit viewers are needed for library cleanup. SABnzbd-only is not a standalone MCP startup configuration. This describes a 1.1.0 source candidate, not publication or live-validation evidence.

## Tagged GitHub release

A source tag, a GitHub release asset and an npm registry version are separate
artifacts. Check the [release listing](https://github.com/thesammykins/FlixBridge/releases)
for an actual downloadable package; a tag alone does not provide one. If a maintainer
has attached a reviewed tarball and `SHA256SUMS`, download both, verify the checksum,
then install the local tarball with npm. Do not assume an unversioned npm install
selects the source version described by these docs.

When no package asset exists, use the source-checkout instructions and explicitly
check out the reviewed tag or commit before building. Keep the previous working
artifact/configuration until the new installation's read-only baseline succeeds.

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

## Optional retention CLI and bridge

The candidate defines two bins: `flixbridge` (stdio MCP) and `flixbridge-retention` (opt-in local operations). A source build can run the latter as `node /absolute/path/to/FlixBridge/dist/cli.js --help`; after installing an artifact that actually includes it, use `flixbridge-retention --help`. Do not assume an older npm artifact exposes this bin.

Configure [private state and approval environment](configuration.md#private-state-and-human-approval) before use. Both CLI and MCP share environment-only source configuration and the same explicitly selected state directory. Example invocations only, not installed schedules:

```bash
flixbridge-retention bridge --port 8787
flixbridge-retention evaluate --rule reviewed-movies --version 1 --at 2026-10-01T00:00:00Z
flixbridge-retention run-due --at 2026-10-02T00:00:00Z --request-approval
```

The bridge is a separate foreground process and needs trusted adapter integration; rules must already exist and be enabled for due evaluation. `--request-approval` creates proposals for human decisions, never approval/deletion. `execute --request <approved-request-uuid>` is an explicitly invoked mutation after authenticated consent, not a scheduler phase that self-approves. See [full CLI/rule contract and opt-in schedule example](retention-rules.md#cli-and-opt-in-scheduling). No command installs cron/launchd jobs or automatically starts a listener.

## MCP client setup and verification

See the [README configuration example](../README.md#connect-an-mcp-client); client configuration locations and restart procedures are client-specific. Supply credentials to the launched process: GUI clients need not inherit shell exports.

1. Restart/reconnect the configured MCP server and discover its tools.
2. Call `list_services`; confirm exact instance names.
3. Call `system_status` for each intended ARR/media server and `queue_list` for each ARR service. For library reads use `library_list`, `media_detail` and explicit-viewer `watch_status`; inspect coverage/capability limits. Use `queue_diagnostics` with explicit `autoFix:false` if inspecting import problems. For Plex, call `reported_issues` after configuring its variables.

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
work in the upstream API/UI first; restart loses preview tokens and process-local import/Plex guards, not durable approvals/consumed claims. Stop destructive callers and external schedules before downgrading: older versions may re-enable weaker token-only removal. Preserve and reconcile private state; do not restore old approved records for replay. See [retention migration](retention-migration.md). Any compensating write or backup restore needs its own authority. Do not
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
