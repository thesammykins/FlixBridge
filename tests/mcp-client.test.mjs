import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const expectedNames = [
	"list_services",
	"system_status",
	"queue_list",
	"queue_grab",
	"remove_content",
	"manual_import",
	"root_folders",
	"history_detail",
	"search",
	"add_new",
	"import_issues",
	"quality_profiles",
	"queue_diagnostics",
	"all_services_diagnostics",
	"download_status",
	"server_metrics",
	"reported_issues",
	"remediate_reported_issue",
	"update_quality_profile",
	"library_statistics",
	"library_list",
	"media_detail",
	"watch_status",
	"watch_history",
	"upcoming_media",
	"request_approval",
	"approval_status",
	"cancel_approval",
	"update_monitoring",
	"cleanup_candidates",
	"retention_rules",
	"retention_evaluate",
];

const cases = [
	["v2 default legacy", Client, StdioClientTransport, {}],
	[
		"v2 automatic modern",
		Client,
		StdioClientTransport,
		{ versionNegotiation: { mode: "auto", probe: { timeoutMs: 2000 } } },
	],
	[
		"v2 pinned modern",
		Client,
		StdioClientTransport,
		{ versionNegotiation: { mode: { pin: "2026-07-28" } } },
	],
];
// Optional external compatibility installations; no legacy SDK in the runtime dependency graph.
if (process.env.MCP_LEGACY_CLIENT_ROOT) {
	for (const [label, pkg] of [
		["v1 1.29.0", "mcp-sdk-1-29"],
		["v1 1.32.1", "@modelcontextprotocol/sdk"],
	]) {
		const root = join(process.env.MCP_LEGACY_CLIENT_ROOT, "node_modules", pkg);
		const { Client: OldClient } = await import(
			pathToFileURL(join(root, "dist/esm/client/index.js")).href
		);
		const { StdioClientTransport: OldTransport } = await import(
			pathToFileURL(join(root, "dist/esm/client/stdio.js")).href
		);
		cases.push([label, OldClient, OldTransport, {}]);
	}
}
const version = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url)),
).version;
for (const [label, ClientClass, Transport, options] of cases) {
	test(`actual built product consumed by ${label}`, async () => {
		const client = new ClientClass(
			{ name: "offline SDK compatibility", version: "1" },
			options,
		);
		const transport = new Transport({
			command: process.execPath,
			args: [resolve(process.env.MCP_TEST_BIN || "dist/index.js")],
			env: {
				PATH: process.env.PATH,
				SONARR_URL: "http://127.0.0.1:1",
				SONARR_API_KEY: "offline-only",
			},
			stderr: "pipe",
		});
		transport.stderr?.resume();
		try {
			await client.connect(transport);
			assert.deepEqual(client.getServerVersion(), { name: "arr-mcp", version });
			assert.equal(
				client.getProtocolEra?.() ?? "legacy",
				label.includes("modern") ? "modern" : "legacy",
			);
			const list = await client.listTools();
			assert.deepEqual(
				list.tools.map((tool) => tool.name),
				expectedNames,
			);
			assert.equal(list.tools[0].name, "list_services");
			for (const name of ["list_services", "server_metrics"]) {
				const result = await client.callTool({ name, arguments: {} });
				assert.equal(result.structuredContent.ok, true);
				assert.deepEqual(
					JSON.parse(result.content[0].text),
					result.structuredContent,
				);
			}
			const failure = await client.callTool({
				name: "system_status",
				arguments: {},
			});
			assert.equal(failure.isError, true);
			assert.equal(failure.structuredContent.ok, false);
			assert.deepEqual(
				JSON.parse(failure.content[0].text),
				failure.structuredContent,
			);
		} finally {
			await client.close();
		}
	});
}
