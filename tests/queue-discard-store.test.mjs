import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ApprovalStore } from "../dist/approval/store.js";

const exec = promisify(execFile);
const moduleUrl = new URL("../dist/approval/store.js", import.meta.url).href;
const job = "a".repeat(64);
async function fixture(t) {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "discard-ledger-")),
	);
	t.after(() => rm(directory, { recursive: true, force: true }));
	return { directory, store: new ApprovalStore(directory, "queue-discard") };
}
test("policy claims use a distinct durable ledger and permanently reserve physical jobs", async (t) => {
	const { directory, store } = await fixture(t);
	assert.equal(typeof store.claimPolicy, "function");
	const record = await store.claimPolicy(
		{ policyFingerprint: "v1", ids: [1, 2] },
		[job],
	);
	assert.equal(record.state, "claimed");
	assert.equal(record.authority, "queue-discard-policy");
	assert.equal(record.actor, undefined);
	assert.equal(record.decidedAt, undefined);
	assert.equal(
		(await stat(join(directory, "queue-discard.json"))).mode & 0o777,
		0o600,
	);
	assert.equal(
		JSON.parse(await readFile(join(directory, "queue-discard.json"), "utf8"))
			.records.length,
		1,
	);
	await store.finish(record.id, "failed");
	await assert.rejects(
		new ApprovalStore(directory, "queue-discard").claimPolicy(
			{ ids: [2], policyFingerprint: "v2" },
			[job],
		),
	);
	await assert.rejects(new ApprovalStore(directory).claimPolicy({}, [job]));
	await assert.rejects(store.create({ ids: [3] }));
	await assert.rejects(store.claimPolicy({}, []));
});
test("policy reservation identities are integrity-bound to the immutable execution manifest", async (t) => {
	const { directory, store } = await fixture(t);
	const record = await store.claimPolicy({ ids: [7] }, [job]);
	const path = join(directory, "queue-discard.json");
	const ledger = JSON.parse(await readFile(path, "utf8"));
	ledger.records[0].reservations = ["b".repeat(64)];
	await writeFile(path, JSON.stringify(ledger));
	await assert.rejects(store.get(record.id));
});
test("separate processes cannot claim regrouped jobs concurrently or replay a dead claimant", async (t) => {
	const { directory, store } = await fixture(t);
	const script = (
		n,
	) => `import { ApprovalStore } from ${JSON.stringify(moduleUrl)};
	const s = new ApprovalStore(${JSON.stringify(directory)}, 'queue-discard');
	try { const r = await s.claimPolicy({ids:[${n}]}, [${JSON.stringify(job)}]); console.log(JSON.stringify(r)); } catch { console.log('false'); }`;
	const results = await Promise.all(
		Array.from({ length: 6 }, (_, n) =>
			exec(process.execPath, ["--input-type=module", "-e", script(n)]),
		),
	);
	const claims = results.map(({ stdout }) => JSON.parse(stdout));
	assert.equal(claims.filter(Boolean).length, 1);
	assert.equal((await store.get(claims.find(Boolean).id)).state, "uncertain");
	await assert.rejects(store.claimPolicy({ freshToken: true }, [job]));
});
test("SIGKILL after durable policy claim leaves no timeout takeover", async (t) => {
	const { directory, store } = await fixture(t);
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { ApprovalStore } from ${JSON.stringify(moduleUrl)};
	const s = new ApprovalStore(${JSON.stringify(directory)}, 'queue-discard');
	console.log(JSON.stringify(await s.claimPolicy({ ids:[7] }, [${JSON.stringify(job)}]))); setInterval(()=>{}, 1000);`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const [bytes] = await once(child.stdout, "data");
	const record = JSON.parse(bytes.toString());
	child.kill("SIGKILL");
	await once(child, "exit");
	assert.equal((await store.get(record.id)).state, "uncertain");
	await assert.rejects(store.claimPolicy({ ids: [8], fresh: true }, [job]));
});
