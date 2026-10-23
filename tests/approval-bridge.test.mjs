import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as approval from "../dist/approval/index.js";

const testSecret = randomBytes(32).toString("hex");
process.env.FLIX_BRIDGE_APPROVAL_SECRET = testSecret;
process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "human:test";

function signed(body, timestamp = String(Date.now()), purpose = "decision") {
	return {
		"content-type": "application/json",
		"x-flixbridge-timestamp": timestamp,
		"x-flixbridge-signature": `sha256=${createHmac("sha256", testSecret).update(`flixbridge.approval.${purpose}.v1\n${timestamp}\n${body}`).digest("hex")}`,
	};
}
async function fixture(t) {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "approval-http-")),
	);
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new approval.ApprovalStore(directory);
	const server = approval.createApprovalBridge(store);
	assert.equal(server.listening, false);
	await new Promise((resolve) => server.listen(0, resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	assert.equal(server.address().address, "127.0.0.1");
	return {
		store,
		server,
		url: `http://127.0.0.1:${server.address().port}/approvals/decision`,
	};
}

test("external binding requires explicit unsafe opt-in; no listening side effect", async (t) => {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "approval-bind-")),
	);
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new approval.ApprovalStore(directory);
	assert.throws(() =>
		approval.createApprovalBridge(store, { host: "0.0.0.0" }),
	);
	const server = approval.createApprovalBridge(store);
	assert.throws(() => server.listen({ port: 0, host: "0.0.0.0" }));
	assert.throws(() => server.listen(0, "0.0.0.0"));
	assert.equal(server.listening, false);
	const external = approval.createApprovalBridge(store, {
		host: "0.0.0.0",
		unsafeAllowExternalBinding: true,
	});
	assert.equal(external.listening, false);
});

test("forged, cross-plan, wrong actor, expired and replayed nonces never grant consent", async (t) => {
	const { store, url } = await fixture(t);
	const record = await store.create({ fileId: 19 });
	const value = {
		requestId: record.id,
		planHash: record.planHash,
		actor: "human:test",
		decision: "no",
		nonce: "security_nonce_0000",
	};
	const post = async (input, headers, raw) => {
		const body = raw ?? JSON.stringify(input);
		return fetch(url, {
			method: "POST",
			headers: headers ?? signed(body),
			body,
		});
	};
	assert.equal(
		(await post(value, { "content-type": "application/json" })).status,
		401,
	);
	assert.equal(
		(
			await post(value, {
				...signed(JSON.stringify(value)),
				"x-flixbridge-signature": `sha256=${"0".repeat(64)}`,
			})
		).status,
		401,
	);
	assert.equal(
		(
			await post(
				value,
				signed(JSON.stringify(value), String(Date.now() - 301000)),
			)
		).status,
		401,
	);
	assert.equal(
		(
			await post(
				value,
				signed(JSON.stringify(value), String(Date.now() + 301000)),
			)
		).status,
		401,
	);
	assert.equal((await post({ ...value, actor: "model" })).status, 409);
	assert.equal(
		(await post({ ...value, planHash: "f".repeat(64) })).status,
		409,
	);
	assert.equal(
		(await post({ ...value, planHash: record.planHash.slice(0, 12) })).status,
		400,
	);
	assert.equal((await post({ ...value, extra: "unknown" })).status, 400);
	assert.equal((await post(value, undefined, "x".repeat(17000))).status, 413);
	assert.equal((await store.get(record.id)).state, "pending");
	assert.equal((await post(value)).status, 200);
	assert.equal((await store.create(record.plan)).state, "rejected");
	const other = await store.create({ fileId: 20 });
	assert.equal(
		(
			await post({
				...value,
				requestId: other.id,
				planHash: other.planHash,
				decision: "yes",
			})
		).status,
		409,
	);
	assert.equal((await store.get(other.id)).state, "pending");
	const expired = await store.create({ fileId: 21 }, { ttlMs: 1 });
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(
		(
			await post({
				...value,
				requestId: expired.id,
				planHash: expired.planHash,
				nonce: "expired_callback_00",
			})
		).status,
		409,
	);
});

test("optional webhook signs bounded complete plan and explicit button references, rejects redirect replay", async (t) => {
	assert.equal(typeof approval.sendApprovalRequest, "function");
	const { store } = await fixture(t);
	const record = await store.create({ fileId: 91 });
	const previous = process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL;
	Reflect.deleteProperty(process.env, "FLIX_BRIDGE_APPROVAL_WEBHOOK_URL");
	t.after(() => {
		if (previous === undefined)
			Reflect.deleteProperty(process.env, "FLIX_BRIDGE_APPROVAL_WEBHOOK_URL");
		else process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL = previous;
	});
	assert.deepEqual(await approval.sendApprovalRequest(store, record.id), {
		sent: false,
	});
	let captured;
	let redirected = 0;
	const receiver = createServer(async (request, response) => {
		if (request.url === "/destination") {
			redirected++;
			response.end("{}");
			return;
		}
		if (request.url === "/redirect") {
			response.writeHead(307, { location: "/destination" });
			response.end();
			return;
		}
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		captured = {
			body: Buffer.concat(chunks).toString(),
			headers: request.headers,
		};
		response.setHeader("content-type", "application/json");
		response.end("{}");
	});
	await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => receiver.close(resolve)));
	const base = `http://127.0.0.1:${receiver.address().port}`;
	process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL = `${base}/notify`;
	assert.deepEqual(await approval.sendApprovalRequest(store, record.id), {
		sent: true,
	});
	const payload = JSON.parse(captured.body);
	assert.equal(
		captured.headers["x-flixbridge-signature"],
		signed(
			captured.body,
			captured.headers["x-flixbridge-timestamp"],
			"request",
		)["x-flixbridge-signature"],
	);
	assert.equal(payload.requestId, record.id);
	assert.equal(payload.planHash, approval.hashPlan(payload.plan));
	assert.ok(
		Buffer.byteLength(captured.body) < 300 * 1024 &&
			!captured.body.includes(testSecret),
	);
	assert.deepEqual(
		payload.buttons.map((button) => button.reference.decision),
		["yes", "no"],
	);
	for (const button of payload.buttons) {
		assert.deepEqual(button.reference, {
			requestId: record.id,
			planHash: record.planHash,
			expiresAt: record.expiresAt,
			decision: button.reference.decision,
		});
		assert.equal(
			button.signature,
			signed(
				JSON.stringify({
					decision: button.reference.decision,
					expiresAt: record.expiresAt,
					planHash: record.planHash,
					requestId: record.id,
				}),
				String(record.expiresAt),
				"reference",
			)["x-flixbridge-signature"],
		);
	}
	assert.equal(
		approval.verifyApprovalSignature(
			captured.body,
			captured.headers["x-flixbridge-timestamp"],
			captured.headers["x-flixbridge-signature"],
		),
		false,
	);
	process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL = `${base}/redirect`;
	await assert.rejects(
		approval.sendApprovalRequest(store, record.id),
		(error) => !JSON.stringify(error).includes(base),
	);
	assert.equal(redirected, 0);
	await store.cancel(record.id);
	process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL = `${base}/notify`;
	await assert.rejects(approval.sendApprovalRequest(store, record.id));
});

test("callback authentication never normalizes invalid UTF-8 into a signed actor", async (t) => {
	const { store, url } = await fixture(t);
	const record = await store.create({ fileId: 55 });
	const previous = process.env.FLIX_BRIDGE_APPROVAL_ACTORS;
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "human:\uFFFD";
	t.after(() => {
		process.env.FLIX_BRIDGE_APPROVAL_ACTORS = previous;
	});
	const body = JSON.stringify({
		requestId: record.id,
		planHash: record.planHash,
		actor: "human:\uFFFD",
		decision: "yes",
		nonce: "utf8_nonce_0000000",
	});
	const bytes = Buffer.from(body);
	const position = bytes.indexOf(Buffer.from("\uFFFD"));
	const invalid = Buffer.concat([
		bytes.subarray(0, position),
		Buffer.from([255]),
		bytes.subarray(position + 3),
	]);
	const response = await fetch(url, {
		method: "POST",
		headers: signed(body),
		body: invalid,
	});
	assert.equal(response.status, 400);
	assert.equal((await store.get(record.id)).state, "pending");
});

test("loopback callback requires signed human full-plan decision and persists single use", async (t) => {
	assert.equal(typeof approval.createApprovalBridge, "function");
	const { store, url } = await fixture(t);
	const record = await store.create({ fileId: 17 });
	const body = JSON.stringify({
		requestId: record.id,
		planHash: record.planHash,
		actor: "human:test",
		decision: "yes",
		nonce: "callback_nonce_0000",
	});
	const response = await fetch(url, {
		method: "POST",
		headers: signed(body),
		body,
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		requestId: record.id,
		state: "approved",
	});
	assert.equal((await store.get(record.id)).actor, "human:test");
	assert.equal(
		(await fetch(url, { method: "POST", headers: signed(body), body })).status,
		409,
	);
	assert.equal((await fetch(url)).status, 405);
	await store.claim(record.id, record.plan);
	await store.finish(record.id, "completed");
});
