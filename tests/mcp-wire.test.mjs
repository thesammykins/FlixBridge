import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { ApprovalStore } from "../dist/approval/store.js";

const version = "2026-07-28";
const meta = (requested = version) => ({
	"io.modelcontextprotocol/protocolVersion": requested,
	"io.modelcontextprotocol/clientCapabilities": {},
});
const packageVersion = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url)),
).version;
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

test("EOF interrupts removal verification without replaying the accepted DELETE", async (t) => {
	let deletions = 0;
	let verificationReads = 0;
	const upstreamServer = createServer((req, res) => {
		if (req.method === "DELETE") {
			deletions++;
			res.writeHead(204).end();
			return;
		}
		if (deletions) verificationReads++;
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify({
				totalRecords: 1,
				records: [{ id: 1, title: "Synthetic queue", status: "completed" }],
			}),
		);
	});
	upstreamServer.listen(0, "127.0.0.1");
	await once(upstreamServer, "listening");
	t.after(() => upstreamServer.close());
	const state = realpathSync(
		mkdtempSync(join(tmpdir(), "flixbridge-eof-approval-")),
	);
	t.after(() => rmSync(state, { recursive: true, force: true }));
	const store = new ApprovalStore(state);
	const w = wire(t, {
		SONARR_URL: `http://127.0.0.1:${upstreamServer.address().port}`,
		FLIX_BRIDGE_STATE_DIR: state,
	});
	const args = {
		service: "sonarr",
		ids: [1],
		target: "queue",
		manualImport: false,
		allowManualRemoval: true,
		removeFromClient: false,
		blocklist: false,
		deleteFiles: false,
	};
	const preview = await w.modern("tools/call", {
		name: "remove_content",
		arguments: { ...args, dryRun: true },
	});
	assert.equal(preview.result.structuredContent.ok, true);
	const token = preview.result.structuredContent.data.confirmationToken;
	assert.equal(typeof token, "string");
	const requested = await w.modern("tools/call", {
		name: "request_approval",
		arguments: { tool: "remove_content", arguments: args },
	});
	assert.equal(requested.result.structuredContent.ok, true);
	const approval = requested.result.structuredContent.data;
	assert.equal((await store.get(approval.id)).state, "pending");
	// Only the trusted TEST process represents the authenticated human bridge.
	// The MCP child receives neither the actor allowlist nor production env.
	const oldActors = process.env.FLIX_BRIDGE_APPROVAL_ACTORS;
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "eof-fixture-human";
	try {
		const decision = {
			requestId: approval.id,
			planHash: approval.planHash,
			actor: "eof-fixture-human",
			decision: "yes",
			nonce: randomUUID(),
		};
		await assert.rejects(store.decide(decision), (error) =>
			/authenticated/i.test(error.message),
		);
		assert.equal((await store.decide(decision, true)).state, "approved");
	} finally {
		if (oldActors === undefined)
			Reflect.deleteProperty(process.env, "FLIX_BRIDGE_APPROVAL_ACTORS");
		else process.env.FLIX_BRIDGE_APPROVAL_ACTORS = oldActors;
	}
	w.send({
		id: 900,
		method: "tools/call",
		params: {
			name: "remove_content",
			arguments: {
				...args,
				dryRun: false,
				confirmationToken: token,
				approvalId: approval.id,
			},
			_meta: meta(),
		},
	});
	await until(() => verificationReads >= 1);
	assert.equal((await store.get(approval.id)).state, "claimed");
	await w.close();
	await assert.rejects(store.claim(approval.id, approval.plan), (error) =>
		/not executable/i.test(error.message),
	);
	assert.equal(deletions, 1);
	assert.equal(
		verificationReads,
		1,
		"cancelled workflow must not continue polling",
	);
	assert.ok(
		!w.frames.some((frame) => frame.id === 900),
		"no late output after EOF cancellation",
	);
});

test("statistics uses the selected Sonarr family and offline discovery exposes configured policies", async (t) => {
	const paths = [];
	const counts = Object.fromEntries(
		[
			"seriesCount",
			"monitoredSeriesCount",
			"completedSeriesCount",
			"continuingSeriesCount",
			"endedSeriesCount",
			"upcomingSeriesCount",
			"deletedSeriesCount",
			"standardSeriesCount",
			"dailySeriesCount",
			"animeSeriesCount",
			"seasonCount",
			"completedSeasonCount",
			"totalEpisodeCount",
			"monitoredEpisodeCount",
			"downloadedEpisodeCount",
			"missingEpisodeCount",
			"unairedEpisodeCount",
			"episodeFileCount",
			"sizeOnDisk",
		].map((key) => [key, 0]),
	);
	const statistics = {
		...counts,
		seriesCount: 2,
		qualityProfileStatistics: [],
		qualityStatistics: [],
		tagStatistics: [],
	};
	const upstreamServer = createServer((req, res) => {
		paths.push(req.url);
		assert.equal(req.method, "GET");
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify(
				req.url === "/base/api"
					? { current: "v5", deprecated: ["v3"] }
					: req.url.endsWith("/system/status")
						? { appName: "Sonarr", version: "5.0.0-fixture" }
						: statistics,
			),
		);
	});
	upstreamServer.listen(0, "127.0.0.1");
	await once(upstreamServer, "listening");
	t.after(() => upstreamServer.close());
	const url = `http://127.0.0.1:${upstreamServer.address().port}/base`;
	const w = wire(t, {
		SONARR_URL: "",
		SONARR_API_KEY: "",
		SONARR_NEW_URL: url,
		SONARR_NEW_API_KEY: "fixture",
		SONARR_NEW_API_VERSION: "5",
		SONARR_OLD_URL: url,
		SONARR_OLD_API_KEY: "fixture",
		SONARR_OLD_API_VERSION: "3",
		RADARR_URL: url,
		RADARR_API_KEY: "fixture",
	});
	const discovered = await w.modern("tools/call", { name: "list_services" });
	const services = discovered.result.structuredContent.data.services;
	assert.equal(services.find((s) => s.name === "sonarr-new").apiPolicy, 5);
	assert.equal(services.find((s) => s.name === "sonarr-old").apiPolicy, 3);
	assert.equal(services.find((s) => s.name === "radarr").apiPolicy, undefined);
	assert.deepEqual(paths, [], "list_services must not contact upstream");
	const list = await w.modern("tools/list");
	const tool = list.result.tools.find(
		(tool) => tool.name === "library_statistics",
	);
	assert.deepEqual(tool.inputSchema.required, ["service"]);
	assert.equal(tool.annotations.readOnlyHint, true);
	const result = await w.modern("tools/call", {
		name: "library_statistics",
		arguments: { service: "sonarr-new" },
	});
	assert.equal(result.result.structuredContent.ok, true);
	assert.deepEqual(result.result.structuredContent.data, {
		service: "sonarr-new",
		apiFamily: 5,
		statistics,
	});
	assert.deepEqual(
		JSON.parse(result.result.content[0].text),
		result.result.structuredContent,
	);
	assert.deepEqual(paths, [
		"/base/api",
		"/base/api/v5/system/status",
		"/base/api/v5/statistics",
	]);
	for (const service of ["sonarr-old", "radarr"]) {
		const unsupported = await w.modern("tools/call", {
			name: "library_statistics",
			arguments: { service },
		});
		assert.equal(unsupported.result.isError, true);
	}
	assert.equal(
		paths.length,
		3,
		"unsupported statistics must not scan legacy libraries",
	);
	await w.close();
});

function wire(
	t,
	extraEnv = {},
	bin = process.env.MCP_TEST_BIN || "dist/index.js",
) {
	const child = spawn(process.execPath, [bin], {
		env: {
			PATH: process.env.PATH,
			SONARR_URL: "http://127.0.0.1:1",
			SONARR_API_KEY: "offline-only",
			FLIX_BRIDGE_DEBUG: "1",
			...extraEnv,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	const frames = [];
	const pending = new Map();
	let buffer = "";
	let stderr = "";
	let id = 0;
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		while (buffer.includes("\n")) {
			const end = buffer.indexOf("\n");
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			const frame = JSON.parse(line);
			assert.equal(frame.jsonrpc, "2.0");
			frames.push(frame);
			pending.get(frame.id)?.(frame);
			pending.delete(frame.id);
		}
	});
	t.after(() => {
		if (child.exitCode === null) child.kill("SIGKILL");
	});
	const send = (frame) =>
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
	const request = async (method, params = {}) => {
		const requestId = ++id;
		const response = new Promise((resolve) => pending.set(requestId, resolve));
		send({ id: requestId, method, params });
		return await timeout(
			response,
			3000,
			() => `No response: ${method}: ${stderr}`,
		);
	};
	const modern = (method, params = {}, requested = version) =>
		request(method, { ...params, _meta: meta(requested) });
	const close = async (signal) => {
		const exit = once(child, "exit");
		if (signal) child.kill(signal);
		else child.stdin.end();
		const [code, receivedSignal] = await timeout(
			exit,
			2000,
			() => "Server failed to shut down",
		);
		assert.equal(code, 0);
		assert.equal(receivedSignal, null);
		assert.equal(buffer, "");
	};
	return { child, frames, send, request, modern, close };
}
async function timeout(promise, ms, message) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message())), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test("unsupported versions after modern pin reject every method before dispatch", async (t) => {
	const w = wire(t);
	assert.ok((await w.modern("server/discover")).result);
	assert.ok((await w.modern("tools/list")).result);
	const observed = [];
	for (const method of ["tools/list", "server/discover", "tools/call"]) {
		const response = await w.modern(
			method,
			method === "tools/call" ? { name: "list_services", arguments: {} } : {},
			"1900-01-01",
		);
		observed.push({
			method,
			code: response.error?.code,
			data: response.error?.data,
		});
	}
	assert.deepEqual(
		observed,
		["tools/list", "server/discover", "tools/call"].map((method) => ({
			method,
			code: -32022,
			data: { supported: [version], requested: "1900-01-01" },
		})),
	);
	assert.ok((await w.modern("tools/list")).result);
	await w.close();
});

test("catalogue and no-argument calls have matching structured envelopes", async (t) => {
	const w = wire(t);
	const direct = await w.modern("tools/call", { name: "list_services" });
	assert.equal(direct.error, undefined);
	assert.equal(direct.result.structuredContent.ok, true);
	assert.deepEqual(
		JSON.parse(direct.result.content[0].text),
		direct.result.structuredContent,
	);
	const listing = (await w.modern("tools/list")).result.tools;
	assert.deepEqual(
		listing.map((tool) => tool.name),
		expectedNames,
	);
	for (const tool of listing) {
		assert.deepEqual(tool.outputSchema.required, ["ok"]);
		assert.equal(tool.outputSchema.properties.ok.type, "boolean");
		assert.equal(tool.inputSchema.additionalProperties, false);
		assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
		assert.equal(typeof tool.annotations.openWorldHint, "boolean");
	}
	for (const name of [
		"remove_content",
		"manual_import",
		"remediate_reported_issue",
		"queue_diagnostics",
		"all_services_diagnostics",
		"queue_grab",
		"update_quality_profile",
		"cancel_approval",
		"update_monitoring",
	]) {
		const hints = listing.find((tool) => tool.name === name).annotations;
		assert.equal(hints.readOnlyHint, false, name);
		assert.equal(hints.destructiveHint, true, name);
		assert.equal(hints.idempotentHint, false, name);
	}
	for (const name of ["request_approval", "retention_rules"]) {
		const hints = listing.find((tool) => tool.name === name).annotations;
		assert.equal(hints.readOnlyHint, false, name);
		assert.equal(hints.destructiveHint, false, name);
		assert.equal(hints.idempotentHint, false, name);
	}
	for (const name of [
		"library_list",
		"media_detail",
		"watch_status",
		"watch_history",
		"upcoming_media",
		"cleanup_candidates",
		"retention_evaluate",
	]) {
		const hints = listing.find((tool) => tool.name === name).annotations;
		assert.equal(hints.readOnlyHint, true, name);
		assert.notEqual(hints.destructiveHint, true, name);
		assert.equal(hints.openWorldHint, true, name);
	}
	const approvalStatus = listing.find(
		(tool) => tool.name === "approval_status",
	).annotations;
	assert.equal(approvalStatus.readOnlyHint, true);
	assert.equal(approvalStatus.destructiveHint, false);
	assert.equal(approvalStatus.openWorldHint, false);
	const metrics = await w.modern("tools/call", { name: "server_metrics" });
	assert.equal(metrics.error, undefined);
	assert.equal(metrics.result.structuredContent.ok, true);
	assert.deepEqual(
		JSON.parse(metrics.result.content[0].text),
		metrics.result.structuredContent,
	);
	assert.deepEqual((await w.modern("tools/list")).result.tools, listing);
	await w.close();
});

test("tool argument errors are actionable results while envelope/name errors are RPC errors", async (t) => {
	const w = wire(t);
	const listing = (await w.modern("tools/list")).result.tools;
	for (const tool of listing) {
		for (const field of tool.inputSchema.required) {
			const response = await w.modern("tools/call", {
				name: tool.name,
				arguments: {},
			});
			assert.equal(response.error, undefined, tool.name);
			assert.equal(response.result.isError, true, tool.name);
			assert.equal(response.result.structuredContent.ok, false);
			assert.match(
				response.result.structuredContent.error.message,
				new RegExp(tool.inputSchema.required.join("|")),
			);
			assert.deepEqual(
				JSON.parse(response.result.content[0].text),
				response.result.structuredContent,
			);
		}
	}
	for (const [name, args] of [
		[
			"remove_content",
			{
				ids: [1],
				dryRun: false,
				confirmationToken: "private-marker",
				deleteFilez: true,
			},
		],
		["queue_grab", { service: "sonarr", ids: ["1"] }],
		["search", { service: "sonarr", query: "q", limit: 1.5 }],
		["queue_list", { service: "sonarr", pageSize: 1001 }],
		["remove_content", { service: "sonarr", ids: ["1.5"] }],
		["system_status", { service: "private-marker" }],
		["server_metrics", { service: "private-marker" }],
		["remove_content", { service: "private-marker", ids: [1] }],
		["remove_content", { downloader: "private-marker", ids: ["sab-id"] }],
		[
			"update_quality_profile",
			{ service: "private-marker", itemId: 1, qualityProfileId: 2 },
		],
	]) {
		const response = await w.modern("tools/call", { name, arguments: args });
		assert.equal(response.error, undefined, name);
		assert.equal(response.result.isError, true, name);
		assert.ok(!JSON.stringify(response).includes("private-marker"));
	}
	for (const params of [
		{ name: "not_a_tool" },
		{},
		{ name: 1 },
		{ name: "list_services", arguments: null },
		{ name: "list_services", arguments: [] },
	]) {
		assert.equal((await w.modern("tools/call", params)).error?.code, -32602);
	}
	assert.equal((await w.modern("not/a/method")).error?.code, -32601);
	assert.deepEqual((await w.modern("tools/list")).result.tools, listing);
	await w.close();
});

// Optional clientInfo deliberately omitted: identity is SHOULD, not MUST.
async function until(predicate) {
	const end = Date.now() + 1500;
	while (!predicate()) {
		if (Date.now() >= end) throw new Error("Condition not reached");
		await delay(5);
	}
}
async function upstream(t) {
	const responses = [];
	const http = createServer((req, res) => {
		responses.push({ req, res });
	});
	await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		http.closeAllConnections();
		http.close();
	});
	return { responses, url: `http://127.0.0.1:${http.address().port}` };
}
function finishStatus(res) {
	res.end(JSON.stringify({ appName: "Sonarr", version: "offline-fixture" }));
}

test("admission bounds active work and queue; queued cancellation never mutates", async (t) => {
	const u = await upstream(t);
	const w = wire(t, { SONARR_URL: u.url });
	await w.modern("tools/list");
	for (let id = 100; id <= 120; id++)
		w.send({
			id,
			method: "tools/call",
			params: {
				name: id === 104 ? "queue_grab" : "system_status",
				arguments:
					id === 104 ? { service: "sonarr", ids: [99] } : { service: "sonarr" },
				_meta: meta(),
			},
		});
	await until(() => u.responses.length >= 4);
	await delay(40);
	assert.equal(
		u.responses.length,
		4,
		"at most four active upstream operations",
	);
	const discovery = await w.modern("server/discover");
	assert.ok(discovery.result, "control plane remains responsive");
	await until(() => w.frames.some((frame) => frame.id === 120));
	assert.equal(w.frames.find((frame) => frame.id === 120).result.isError, true);
	assert.match(
		w.frames.find((frame) => frame.id === 120).result.structuredContent.error
			.message,
		/busy/i,
	);
	w.send({ method: "notifications/cancelled", params: { requestId: 104 } });
	await w.modern("tools/list");
	let finished = 0;
	await timeout(
		(async () => {
			while (
				w.frames.filter((frame) => frame.id >= 100 && frame.id <= 120).length <
				20
			) {
				for (; finished < u.responses.length; finished++)
					finishStatus(u.responses[finished].res);
				await delay(5);
			}
		})(),
		2000,
		() => "Queue did not drain",
	);
	assert.equal(u.responses.length, 19);
	assert.ok(u.responses.every(({ req }) => req.method === "GET"));
	assert.ok(!w.frames.some((frame) => frame.id === 104));
	await w.close();
});

test("active cancellation aborts body reads without cancelling sibling requests or late replies", async (t) => {
	const u = await upstream(t);
	const w = wire(t, { SONARR_URL: u.url });
	await w.modern("tools/list");
	for (const id of [100, 101])
		w.send({
			id,
			method: "tools/call",
			params: {
				name: "system_status",
				arguments: { service: "sonarr" },
				_meta: meta(),
			},
		});
	await until(() => u.responses.length === 2);
	const cancelled = u.responses[0];
	const sibling = u.responses[1];
	cancelled.res.writeHead(200, { "Content-Type": "application/json" });
	cancelled.res.write("{");
	w.send({ method: "notifications/cancelled", params: { requestId: 100 } });
	await until(() => cancelled.res.destroyed);
	assert.equal(sibling.res.destroyed, false);
	finishStatus(sibling.res);
	await until(() => w.frames.some((frame) => frame.id === 101));
	assert.equal(
		w.frames.find((frame) => frame.id === 101).result.structuredContent.ok,
		true,
	);
	w.send({ method: "notifications/cancelled", params: { requestId: 999 } });
	w.send({ method: "notifications/cancelled", params: { requestId: 101 } });
	await delay(40);
	assert.ok(!w.frames.some((frame) => frame.id === 100));
	assert.ok((await w.modern("tools/list")).result);
	await w.close();
});

test("dispatch failures cannot leak secrets or violate the advertised output envelope", async (t) => {
	const w = wire(t, {}, "tests/fixtures/mcp-errors.mjs");
	const failure = await w.modern("tools/call", { name: "list_services" });
	assert.equal(failure.result.isError, true);
	assert.ok(!JSON.stringify(failure).includes("private-marker"));
	assert.deepEqual(
		JSON.parse(failure.result.content[0].text),
		failure.result.structuredContent,
	);
	for (const name of ["system_status", "server_metrics"]) {
		const response = await w.modern("tools/call", {
			name,
			arguments: name === "system_status" ? { service: "sonarr" } : {},
		});
		assert.equal(
			response.error?.code,
			-32603,
			`${name}: ${JSON.stringify(response)}`,
		);
		assert.ok(!JSON.stringify(response).includes("private-marker"));
		assert.ok(!JSON.stringify(response).includes("invalid-envelope"));
	}
	await w.close();
});

test("known retention business failures remain actionable tool errors, not unexpected RPC failures", async (t) => {
	const state = realpathSync(
		mkdtempSync(join(tmpdir(), "flixbridge-rule-error-")),
	);
	t.after(() => rmSync(state, { recursive: true, force: true }));
	const w = wire(t, { FLIX_BRIDGE_STATE_DIR: state });
	const response = await w.modern("tools/call", {
		name: "retention_rules",
		arguments: { operation: "get", id: "missing" },
	});
	assert.equal(response.error, undefined);
	assert.equal(response.result.isError, true);
	assert.match(response.result.structuredContent.error.message, /not found/);
	await w.close();
});

test("advertised numeric and collection bounds match runtime validation", async (t) => {
	const w = wire(t);
	const listing = (await w.modern("tools/list")).result.tools;
	for (const tool of listing) {
		for (const [name, field] of Object.entries(tool.inputSchema.properties)) {
			if (
				[
					"page",
					"pageSize",
					"limit",
					"foreignId",
					"qualityProfileId",
					"itemId",
					"queueTimeoutMs",
				].includes(name)
			) {
				assert.equal(field.type, "integer", `${tool.name}.${name}`);
				assert.equal(field.minimum, name === "queueTimeoutMs" ? 1000 : 1);
				assert.equal(
					typeof field.maximum,
					"number",
					`${tool.name}.${name} must advertise its maximum`,
				);
			}
			if (name === "ids") {
				assert.equal(field.minItems, 1);
				assert.equal(field.maxItems, 1000);
				assert.deepEqual(
					field.items.type,
					tool.name === "remove_content" ? ["integer", "string"] : "integer",
				);
			}
		}
	}
	await w.close();
});

test("a broken package identity fails closed instead of advertising a stale fallback", () => {
	const dir = mkdtempSync(join(tmpdir(), "flixbridge-identity-"));
	try {
		cpSync("dist", join(dir, "dist"), { recursive: true });
		symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ type: "module", version: "" }),
		);
		const result = spawnSync(process.execPath, [join(dir, "dist/index.js")], {
			input: "",
			encoding: "utf8",
			timeout: 2000,
		});
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("modern requests validate required metadata independently and allow omitted identity", async (t) => {
	const w = wire(t);
	const unsupported = await w.modern("tools/list", {}, "1900-01-01");
	assert.equal(unsupported.error.code, -32022);
	assert.deepEqual(unsupported.error.data, {
		supported: [version],
		requested: "1900-01-01",
	});
	assert.ok((await w.modern("tools/list")).result);
	for (const badMeta of [
		{},
		{ "io.modelcontextprotocol/protocolVersion": version },
		{ "io.modelcontextprotocol/clientCapabilities": {} },
		{ ...meta(), "io.modelcontextprotocol/protocolVersion": 1 },
		{ ...meta(), "io.modelcontextprotocol/clientCapabilities": [] },
		{ ...meta(), "io.modelcontextprotocol/clientInfo": {} },
		{
			...meta(),
			"io.modelcontextprotocol/clientInfo": { name: 1, version: "x" },
		},
	]) {
		assert.equal(
			(await w.request("tools/list", { _meta: badMeta })).error?.code,
			-32602,
		);
	}
	for (const identity of [
		undefined,
		{ name: "client-A", version: "1" },
		{ name: "client-B", version: "2" },
	]) {
		const envelope = {
			...meta(),
			...(identity && { "io.modelcontextprotocol/clientInfo": identity }),
		};
		assert.ok(
			(
				await w.request("tools/call", {
					name: "list_services",
					_meta: envelope,
				})
			).result,
		);
	}
	await w.close();
});

for (const legacy of [
	"2024-10-07",
	"2024-11-05",
	"2025-03-26",
	"2025-06-18",
	"2025-11-25",
]) {
	test(`legacy ${legacy} initializes and consumes text plus structured output`, async (t) => {
		const w = wire(t);
		const init = await w.request("initialize", {
			protocolVersion: legacy,
			capabilities: {},
			clientInfo: { name: "legacy-test", version: "1" },
		});
		assert.equal(init.result.protocolVersion, legacy);
		assert.deepEqual(init.result.capabilities, { tools: {} });
		assert.deepEqual(init.result.serverInfo, {
			name: "arr-mcp",
			version: packageVersion,
		});
		w.send({ method: "notifications/initialized" });
		const list = await w.request("tools/list");
		assert.deepEqual(
			list.result.tools.map((tool) => tool.name),
			expectedNames,
		);
		const call = await w.request("tools/call", {
			name: "list_services",
			arguments: {},
		});
		assert.equal(call.result.resultType, undefined);
		assert.equal(call.result.structuredContent.ok, true);
		assert.deepEqual(
			JSON.parse(call.result.content[0].text),
			call.result.structuredContent,
		);
		await w.close();
	});
}

for (const signal of [undefined, "SIGINT", "SIGTERM"]) {
	test(`${signal || "EOF"} aborts active and queued work and exits naturally`, async (t) => {
		const u = await upstream(t);
		const w = wire(t, { SONARR_URL: u.url });
		await w.modern("tools/list");
		for (let id = 100; id < 120; id++)
			w.send({
				id,
				method: "tools/call",
				params: {
					name: "system_status",
					arguments: { service: "sonarr" },
					_meta: meta(),
				},
			});
		await until(() => u.responses.length === 4);
		await w.modern("server/discover");
		await w.close(signal);
		await until(() => u.responses.every(({ res }) => res.destroyed));
		assert.equal(u.responses.length, 4);
		assert.ok(!w.frames.some((frame) => frame.id >= 100));
	});
}

test("installed-style symlinked bin starts the actual server", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "flixbridge-bin-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const bin = join(dir, "flixbridge");
	symlinkSync(resolve("dist/index.js"), bin);
	const w = wire(t, {}, bin);
	assert.ok((await w.modern("server/discover")).result);
	await w.close();
});

test("built product serves modern discovery without initialize", async (t) => {
	const w = wire(t);
	const response = await w.modern("server/discover");
	assert.equal(response.error, undefined);
	assert.deepEqual(response.result.supportedVersions, [version]);
	assert.deepEqual(response.result.capabilities, { tools: {} });
	assert.equal(response.result.resultType, "complete");
	assert.deepEqual(
		response.result._meta["io.modelcontextprotocol/serverInfo"],
		{ name: "arr-mcp", version: packageVersion },
	);
	await w.close();
});
