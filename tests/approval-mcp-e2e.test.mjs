import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createApprovalBridge } from "../dist/approval/bridge.js";
import { ApprovalStore } from "../dist/approval/store.js";

async function fixture(t) {
	const directory = await realpath(
		await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "approved-mcp-")),
	);
	const prior = {
		secret: process.env.FLIX_BRIDGE_APPROVAL_SECRET,
		actors: process.env.FLIX_BRIDGE_APPROVAL_ACTORS,
	};
	const secret = "synthetic-callback-key-not-a-provider-token-123456";
	process.env.FLIX_BRIDGE_APPROVAL_SECRET = secret;
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "test-human";
	let target = {
		id: 7,
		title: "Synthetic queue title",
		status: "completed",
		seriesId: 11,
		episodeId: 111,
		downloadId: "synthetic-nzo",
		protocol: "usenet",
		outputPath: "/fixture/download",
	};
	let deletions = 0;
	const paths = [];
	const upstream = createServer((req, res) => {
		paths.push([req.method, req.url]);
		if (req.method === "DELETE" && req.url.startsWith("/base/api/v3/queue/7")) {
			deletions++;
			target = null;
			res.writeHead(204).end();
			return;
		}
		res.setHeader("Content-Type", "application/json");
		if (req.url.startsWith("/base/api/v3/queue"))
			res.end(
				JSON.stringify({
					records: target ? [target] : [],
					totalRecords: target ? 1 : 0,
				}),
			);
		else
			res
				.writeHead(404)
				.end(JSON.stringify({ message: "fixture route missing" }));
	});
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	const store = new ApprovalStore(directory);
	const bridge = createApprovalBridge(store);
	bridge.listen(0, "127.0.0.1");
	await once(bridge, "listening");
	const client = new Client({ name: "human-approval-e2e", version: "1" });
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [resolve("dist/index.js")],
		env: {
			PATH: process.env.PATH,
			SONARR_URL: `http://127.0.0.1:${upstream.address().port}/base`,
			SONARR_API_KEY: "synthetic-provider-value-74cc91",
			FLIX_BRIDGE_STATE_DIR: directory,
		},
		stderr: "pipe",
	});
	transport.stderr?.resume();
	await client.connect(transport);
	t.after(async () => {
		await client.close();
		await new Promise((r) => upstream.close(r));
		await new Promise((r) => bridge.close(r));
		await rm(directory, { recursive: true, force: true });
		for (const [name, value] of [
			["FLIX_BRIDGE_APPROVAL_SECRET", prior.secret],
			["FLIX_BRIDGE_APPROVAL_ACTORS", prior.actors],
		]) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	});
	const args = {
		service: "sonarr",
		target: "queue",
		ids: [7],
		manualImport: false,
		allowManualRemoval: false,
		removeFromClient: false,
		blocklist: false,
		deleteFiles: false,
		removeFromDownloader: false,
		addImportExclusion: false,
	};
	const call = async (name, input) => {
		const response = await client.callTool({ name, arguments: input });
		assert.deepEqual(
			JSON.parse(response.content[0].text),
			response.structuredContent,
		);
		return response.structuredContent;
	};
	const approve = async (record) => {
		const body = JSON.stringify({
			requestId: record.id,
			planHash: record.planHash,
			actor: "test-human",
			decision: "yes",
			nonce: randomUUID(),
		});
		const timestamp = String(Date.now());
		const signature = `sha256=${createHmac("sha256", secret).update(`flixbridge.approval.decision.v1\n${timestamp}\n${body}`).digest("hex")}`;
		const response = await fetch(
			`http://127.0.0.1:${bridge.address().port}/approvals/decision`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-FlixBridge-Timestamp": timestamp,
					"X-FlixBridge-Signature": signature,
				},
				body,
			},
		);
		assert.equal(response.status, 200, await response.text());
	};
	return {
		call,
		approve,
		args,
		store,
		paths,
		get deletions() {
			return deletions;
		},
		drift() {
			target = { ...target, outputPath: "/fixture/changed" };
		},
	};
}

test("real MCP -> immutable request -> authenticated callback -> exact deletion -> durable readback", async (t) => {
	const f = await fixture(t);
	const blocked = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken: "not-human-consent",
	});
	assert.equal(blocked.ok, false);
	assert.equal(f.deletions, 0);
	const request = await f.call("request_approval", {
		tool: "remove_content",
		arguments: f.args,
	});
	assert.equal(request.ok, true, JSON.stringify(request));
	assert.equal(request.data.state, "pending");
	const duplicate = await f.call("request_approval", {
		tool: "remove_content",
		arguments: f.args,
	});
	assert.equal(duplicate.data.id, request.data.id);
	assert.equal(duplicate.data.newRequest, false);
	await f.approve(request.data);
	const executed = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		approvalId: request.data.id,
	});
	assert.equal(executed.ok, true, JSON.stringify(executed));
	assert.equal(f.deletions, 1);
	assert.equal((await f.store.get(request.data.id)).state, "completed");
	const replay = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		approvalId: request.data.id,
	});
	assert.equal(replay.ok, false);
	assert.equal(f.deletions, 1);
	assert.ok(f.paths.every(([, path]) => path.startsWith("/base/api/v3/")));
});

test("material queue drift invalidates human consent before any DELETE", async (t) => {
	const f = await fixture(t);
	const request = await f.call("request_approval", {
		tool: "remove_content",
		arguments: f.args,
	});
	assert.equal(request.ok, true, JSON.stringify(request));
	await f.approve(request.data);
	f.drift();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		approvalId: request.data.id,
	});
	assert.equal(result.ok, false);
	assert.equal(f.deletions, 0);
	assert.equal((await f.store.get(request.data.id)).state, "invalidated");
});

test("two real MCP execution calls cannot spend the same human decision twice", async (t) => {
	const f = await fixture(t);
	const request = await f.call("request_approval", {
		tool: "remove_content",
		arguments: f.args,
	});
	assert.equal(request.ok, true, JSON.stringify(request));
	await f.approve(request.data);
	const results = await Promise.all(
		[1, 2].map(() =>
			f.call("remove_content", {
				...f.args,
				dryRun: false,
				approvalId: request.data.id,
			}),
		),
	);
	assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
	assert.equal(f.deletions, 1);
});
