import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
const exec = promisify(execFile);
process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "human:test";
const moduleUrl = new URL("../dist/approval/index.js", import.meta.url).href;
async function child(script) {
	const { stdout } = await exec(process.execPath, [
		"--input-type=module",
		"-e",
		`import {ApprovalStore} from ${JSON.stringify(moduleUrl)}; ${script}`,
	]);
	return JSON.parse(stdout);
}
import * as approval from "../dist/approval/index.js";

async function fixture(t) {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "approval-test-")),
	);
	t.after(() => rm(directory, { recursive: true, force: true }));
	return { directory, store: new approval.ApprovalStore(directory) };
}

test("durable immutable private records deduplicate and cancellation is terminal", async (t) => {
	assert.equal(typeof approval.ApprovalStore, "function");
	const { directory, store } = await fixture(t);
	const plan = { kind: "remove", targets: [{ fileId: 7 }] };
	const original = await store.create(plan);
	plan.targets[0].fileId = 9;
	assert.equal(original.state, "pending");
	assert.equal(original.planHash, approval.hashPlan(original.plan));
	assert.equal(original.plan.targets[0].fileId, 7);
	assert.equal((await store.create(original.plan)).id, original.id);
	const reloaded = new approval.ApprovalStore(directory);
	assert.deepEqual(await reloaded.get(original.id), original);
	assert.equal((await reloaded.cancel(original.id)).state, "cancelled");
	assert.notEqual((await store.create(original.plan)).id, original.id);
	assert.equal((await stat(directory)).mode & 0o777, 0o700);
	for (const name of await readdir(directory)) {
		assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
		JSON.parse(await readFile(join(directory, name), "utf8"));
	}
	await assert.rejects(store.get("../escape"));
});

test("authenticated actor and exact full hash authorize one claim before terminal finish", async (t) => {
	const { directory, store } = await fixture(t);
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "human:test";
	const plan = { action: "remove", fileId: 12 };
	const record = await store.create(plan);
	const decision = {
		requestId: record.id,
		planHash: record.planHash,
		actor: "human:test",
		decision: "yes",
		nonce: "0123456789abcdef",
	};
	assert.equal(typeof store.decide, "function");
	await assert.rejects(store.decide(decision));
	await assert.rejects(store.decide({ ...decision, actor: "model" }, true));
	await assert.rejects(
		store.decide({ ...decision, planHash: record.planHash.slice(0, 12) }, true),
	);
	await assert.rejects(store.claim(record.id, plan));
	assert.equal((await store.decide(decision, true)).state, "approved");
	await assert.rejects(store.decide(decision, true));
	assert.equal((await store.claim(record.id, plan)).state, "claimed");
	const disk = JSON.parse(
		await readFile(join(directory, "approvals.json"), "utf8"),
	);
	assert.equal(disk.records[0].state, "claimed");
	await assert.rejects(store.claim(record.id, plan));
	await assert.rejects(store.cancel(record.id));
	assert.equal(
		(await store.finish(record.id, "partial", { deleted: 1 })).state,
		"partial",
	);
	await assert.rejects(store.finish(record.id, "completed"));
	assert.equal((await store.create(plan)).state, "pending");
});

test("cross-process create/claim is serialized and a dead claimant becomes terminal uncertain", async (t) => {
	const { directory, store } = await fixture(t);
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "human:test";
	const setup = `const store = new ApprovalStore(${JSON.stringify(directory)});`;
	const records = await Promise.all(
		Array.from({ length: 8 }, () =>
			child(
				`${setup} console.log(JSON.stringify(await store.create({fileId: 100})));`,
			),
		),
	);
	assert.equal(new Set(records.map((record) => record.id)).size, 1);
	const record = records[0];
	await store.decide(
		{
			requestId: record.id,
			planHash: record.planHash,
			actor: "human:test",
			decision: "yes",
			nonce: "concurrent_nonce_000",
		},
		true,
	);
	const claims = await Promise.all(
		Array.from({ length: 8 }, () =>
			child(
				`${setup} try { await store.claim(${JSON.stringify(record.id)}, {fileId:100}); console.log('true'); } catch { console.log('false'); }`,
			),
		),
	);
	assert.equal(claims.filter(Boolean).length, 1);
	assert.equal((await store.get(record.id)).state, "uncertain");
	await assert.rejects(store.claim(record.id, { fileId: 100 }));
	await assert.rejects(store.finish(record.id, "completed"));
});

test("expiry survives reload, rejection deduplicates permanently and drift invalidates consent", async (t) => {
	const { directory, store } = await fixture(t);
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "human:test";
	const decision = (record, value, nonce) => ({
		requestId: record.id,
		planHash: record.planHash,
		actor: "human:test",
		decision: value,
		nonce,
	});
	const ordinary = await store.create({ fileId: 1 });
	assert.equal(ordinary.expiresAt - ordinary.createdAt, 30 * 60 * 1000);
	const expired = await store.create({ fileId: 2 }, { ttlMs: 1 });
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(
		(await new approval.ApprovalStore(directory).get(expired.id)).state,
		"expired",
	);
	await assert.rejects(
		store.decide(decision(expired, "yes", "expired_nonce_0000"), true),
	);
	const rejected = await store.create({ fileId: 3 });
	assert.equal(
		(await store.decide(decision(rejected, "no", "rejected_nonce_000"), true))
			.state,
		"rejected",
	);
	assert.equal((await store.create(rejected.plan)).id, rejected.id);
	await assert.rejects(
		store.decide(decision(rejected, "yes", "rejected_nonce_001"), true),
	);
	await store.decide(decision(ordinary, "yes", "drifted_nonce_0000"), true);
	await assert.rejects(store.claim(ordinary.id, { fileId: 10 }));
	assert.equal((await store.get(ordinary.id)).state, "invalidated");
	await assert.rejects(store.claim(ordinary.id, ordinary.plan));
});

test("credentials never reach disk, status or normalized storage errors", async (t) => {
	const { directory, store } = await fixture(t);
	const secret = "test-only-credential-47ab7597";
	const previous = process.env.FLIX_BRIDGE_APPROVAL_SECRET;
	process.env.FLIX_BRIDGE_APPROVAL_SECRET = secret;
	t.after(() => {
		if (previous === undefined)
			Reflect.deleteProperty(process.env, "FLIX_BRIDGE_APPROVAL_SECRET");
		else process.env.FLIX_BRIDGE_APPROVAL_SECRET = previous;
	});
	await assert.rejects(
		store.create({ url: "HTTPS://user:password@example.invalid/private" }),
	);
	await assert.rejects(store.create({ [secret]: "not a credential value" }));
	await assert.rejects(store.create({ fileId: 1, apiKey: secret }));
	await assert.rejects(
		store.create({ fileId: 1, evidence: `prefix-${secret}` }),
	);
	const record = await store.create({ fileId: 1 });
	await store.decide(
		{
			requestId: record.id,
			planHash: record.planHash,
			actor: "human:test",
			decision: "yes",
			nonce: "redaction_nonce_000",
		},
		true,
	);
	await store.claim(record.id, record.plan);
	await store.finish(record.id, "failed", {
		apiKey: secret,
		message: `prefix-${secret}`,
		url: "https://user:password@example.invalid/path?token=hidden",
	});
	const disk = await readFile(join(directory, "approvals.json"), "utf8");
	const output = JSON.stringify(await store.get(record.id));
	assert.ok(!disk.includes(secret) && !output.includes(secret));
	assert.ok(
		!disk.includes("user:password") && !output.includes("token=hidden"),
	);
});

test("unsafe permissions, symlink state and malformed ledger fail closed with private errors", async (t) => {
	const { directory, store } = await fixture(t);
	const record = await store.create({ fileId: 1 });
	await chmod(directory, 0o755);
	await assert.rejects(store.get(record.id));
	await chmod(directory, 0o700);
	const path = join(directory, "approvals.json");
	await chmod(path, 0o644);
	await assert.rejects(store.get(record.id));
	await rm(path);
	await symlink(join(directory, "missing-private-path"), path);
	await assert.rejects(
		store.get(record.id),
		(error) => !JSON.stringify(error).includes(directory),
	);
	await rm(path);
	await writeFile(
		path,
		JSON.stringify({
			version: 1,
			records: [{ ...record, state: "approved", expiresAt: null }],
			nonces: [],
		}),
		{ mode: 0o600 },
	);
	await assert.rejects(store.get(record.id));
});

test("decision input is snapshotted before async storage, so caller cannot replace the actor", async (t) => {
	const { store } = await fixture(t);
	const record = await store.create({ fileId: 66 });
	const input = {
		requestId: record.id,
		planHash: record.planHash,
		actor: "human:test",
		decision: "yes",
		nonce: "snapshot_nonce_000",
	};
	const pending = store.decide(input, true);
	input.actor = "model";
	assert.equal((await pending).actor, "human:test");
});

test("canonical JSON rejects exotic arrays and oversized root strings", () => {
	const exotic = [1];
	Object.setPrototypeOf(exotic, { map: () => ["fake"] });
	assert.throws(() => approval.hashPlan(exotic));
	assert.throws(() => approval.hashPlan("x".repeat(256 * 1024)));
});

test("SIGKILL after claim cannot resume execution; dead transaction locks recover safely", async (t) => {
	const { directory, store } = await fixture(t);
	const record = await store.create({ fileId: 77 });
	await store.decide(
		{
			requestId: record.id,
			planHash: record.planHash,
			actor: "human:test",
			decision: "yes",
			nonce: "crash_claim_nonce_0",
		},
		true,
	);
	const processChild = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import {ApprovalStore} from ${JSON.stringify(moduleUrl)}; const store=new ApprovalStore(${JSON.stringify(directory)}); await store.claim(${JSON.stringify(record.id)},{fileId:77}); console.log('claimed'); setInterval(()=>{},1000);`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	t.after(() => processChild.kill("SIGKILL"));
	await new Promise((resolve, reject) => {
		processChild.stdout.once("data", resolve);
		processChild.once("error", reject);
		processChild.once("exit", () => reject(new Error("claimant exited early")));
	});
	const exited = new Promise((resolve) => processChild.once("exit", resolve));
	processChild.kill("SIGKILL");
	await exited;
	assert.equal((await store.get(record.id)).state, "uncertain");
	assert.equal((await store.create(record.plan)).id, record.id);
	const lockUrl = new URL("../dist/approval/lock.js", import.meta.url).href;
	await child(
		`import {lockDirectory} from ${JSON.stringify(lockUrl)}; await lockDirectory(${JSON.stringify(directory)}); console.log('true');`,
	);
	assert.equal((await store.get(record.id)).state, "uncertain");
});

test("explicit state directory, actor configuration and expiry bounds fail closed", async (t) => {
	const { store } = await fixture(t);
	assert.throws(() => new approval.ApprovalStore("relative-state"));
	for (const ttlMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, 86400001])
		await assert.rejects(store.create({ fileId: 1 }, { ttlMs }));
	const record = await store.create({ fileId: 2 });
	const actorEnv = process.env.FLIX_BRIDGE_APPROVAL_ACTORS;
	Reflect.deleteProperty(process.env, "FLIX_BRIDGE_APPROVAL_ACTORS");
	t.after(() => {
		process.env.FLIX_BRIDGE_APPROVAL_ACTORS = actorEnv;
	});
	await assert.rejects(
		store.decide(
			{
				requestId: record.id,
				planHash: record.planHash,
				actor: "human:test",
				decision: "yes",
				nonce: "config_nonce_00000",
			},
			true,
		),
	);
	assert.equal((await store.get(record.id)).state, "pending");
});

test("canonical hash is order independent, full SHA256, strict JSON only", () => {
	assert.equal(typeof approval.hashPlan, "function");
	const { hashPlan } = approval;
	const expected = createHash("sha256")
		.update('{"a":[1,true,null],"z":{"b":2}}')
		.digest("hex");
	assert.equal(hashPlan({ z: { b: 2 }, a: [1, true, null] }), expected);
	assert.equal(hashPlan({ a: [1, true, null], z: { b: 2 } }), expected);
	for (const value of [
		undefined,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1n,
		new Date(),
		{ a: undefined },
		Object.assign(new Array(2), { 1: 1 }),
		{ a: () => 1 },
		{ [Symbol()]: 1 },
	]) {
		assert.throws(() => hashPlan(value));
	}
	const cycle = {};
	cycle.self = cycle;
	assert.throws(() => hashPlan(cycle));
	assert.throws(() =>
		hashPlan(
			Object.defineProperty({}, "secret", {
				get() {
					throw new Error("getter ran");
				},
				enumerable: true,
			}),
		),
	);
});
