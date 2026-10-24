import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createRule,
	evaluateRule,
	getRule,
	listRules,
	reviseRule,
	runDueRules,
} from "../dist/retention/rules.js";

const rule = {
	services: ["radarr"],
	users: [{ server: "plex", userId: "1" }],
	target: "movie",
	action: "remove-title",
	minSizeBytes: 1,
	minAddedAgeDays: 30,
	watchGraceDays: 7,
	minInactiveDays: 14,
	protectedTags: [],
	maxCount: 1,
	maxBytes: 1000,
	intervalHours: 24,
};
const time = "2026-10-20T00:00:00Z";
async function storage(t) {
	const stateDir = await mkdtemp(join(tmpdir(), "retention-test-"));
	t.after(() => rm(stateDir, { recursive: true, force: true }));
	return { stateDir };
}

test("rules are disabled initially, immutable revisions use optimistic concurrency and strict validation", async (t) => {
	const options = await storage(t);
	const one = await createRule(
		{ id: "old-movies", name: "Old movies", rule, evaluationTime: time },
		options,
	);
	assert.equal(one.enabled, false);
	assert.equal(one.version, 1);
	assert.equal(one.rule.watchedPolicy, "all-selected");
	assert.deepEqual(await getRule("old-movies", 1, options), one);
	const two = await reviseRule(
		{ id: one.id, expectedVersion: 1, enabled: true, evaluationTime: time },
		options,
	);
	assert.equal(two.version, 2);
	assert.equal(two.enabled, true);
	assert.deepEqual(await getRule(one.id, 1, options), one);
	assert.deepEqual(await listRules(options), [two]);
	await assert.rejects(
		reviseRule(
			{ id: one.id, expectedVersion: 1, enabled: false, evaluationTime: time },
			options,
		),
		{ message: /version/i },
	);
	await assert.rejects(
		createRule(
			{ id: one.id, name: "duplicate", rule, evaluationTime: time },
			options,
		),
		{ message: /exists/i },
	);
	await assert.rejects(
		createRule(
			{ id: "../escape", name: "bad", rule, evaluationTime: time },
			options,
		),
	);
	await assert.rejects(
		createRule(
			{
				id: "unknown",
				name: "bad",
				rule: { ...rule, extra: true },
				evaluationTime: time,
			},
			options,
		),
	);
	const disk = JSON.parse(
		await readFile(join(options.stateDir, "retention", "rules.json"), "utf8"),
	);
	assert.equal(disk.schemaVersion, 1);
	assert.equal(disk.revisions.length, 2);
});

test("cross-process revisions serialize and do not lose updates", async (t) => {
	const options = await storage(t);
	await createRule(
		{ id: "movies", name: "Movies", rule, evaluationTime: time },
		options,
	);
	const code = `import { reviseRule } from './dist/retention/rules.js'; try { await reviseRule({ id: 'movies', expectedVersion: 1, enabled: true, evaluationTime: '${time}' }, { stateDir: process.argv[1] }); process.stdout.write('ok'); } catch { process.stdout.write('conflict'); }`;
	function child() {
		return new Promise((resolve, reject) => {
			const process = spawn(
				globalThis.process.execPath,
				["--input-type=module", "-e", code, options.stateDir],
				{ cwd: new URL("..", import.meta.url) },
			);
			let output = "";
			process.stdout.on("data", (chunk) => {
				output += chunk;
			});
			process.on("error", reject);
			process.on("exit", (exit) =>
				exit === 0 ? resolve(output) : reject(new Error(`Child exit ${exit}`)),
			);
		});
	}
	assert.deepEqual(
		(await Promise.all([child(), child(), child(), child()])).sort(),
		["conflict", "conflict", "conflict", "ok"],
	);
	assert.equal((await getRule("movies", undefined, options)).version, 2);
});

test("scheduler reserves a due version once, uses inclusive intervals and never evaluates disabled rules", async (t) => {
	const options = await storage(t);
	await createRule(
		{ id: "movies", name: "Movies", rule, evaluationTime: time },
		options,
	);
	let calls = 0;
	const evaluate = async (configuration, context) => {
		calls++;
		assert.deepEqual(configuration.services, ["radarr"]);
		return { proposalOnly: true, context };
	};
	assert.deepEqual(
		await runDueRules({ evaluationTime: time }, evaluate, options),
		[],
	);
	await reviseRule(
		{ id: "movies", expectedVersion: 1, enabled: true, evaluationTime: time },
		options,
	);
	const first = await Promise.all([
		runDueRules({ evaluationTime: time }, evaluate, options),
		runDueRules({ evaluationTime: time }, evaluate, options),
	]);
	assert.equal(first.flat().length, 1);
	assert.equal(calls, 1);
	assert.deepEqual(
		await runDueRules(
			{ evaluationTime: "2026-10-20T23:59:59Z" },
			evaluate,
			options,
		),
		[],
	);
	assert.equal(
		(
			await runDueRules(
				{ evaluationTime: "2026-10-21T00:00:00Z" },
				evaluate,
				options,
			)
		).length,
		1,
	);
	await reviseRule(
		{
			id: "movies",
			expectedVersion: 2,
			name: "Version three",
			evaluationTime: "2026-10-21T00:00:00Z",
		},
		options,
	);
	assert.deepEqual(
		await runDueRules(
			{ evaluationTime: "2026-10-21T00:00:00Z" },
			evaluate,
			options,
		),
		[],
	);
	assert.equal(
		(
			await runDueRules(
				{ evaluationTime: "2026-10-22T00:00:00Z" },
				evaluate,
				options,
			)
		)[0].version,
		3,
	);
	const preview = await evaluateRule(
		{ id: "movies", version: 1, evaluationTime: time },
		evaluate,
		options,
	);
	assert.equal(preview.version, 1);
	assert.equal(preview.result.proposalOnly, true);
	assert.deepEqual(
		await runDueRules({ evaluationTime: time }, evaluate, options),
		[],
	);
});

test("storage fails closed without explicit configuration, on corruption and on symlinks", async (t) => {
	const options = await storage(t);
	const previous = process.env.FLIX_BRIDGE_STATE_DIR;
	Reflect.deleteProperty(process.env, "FLIX_BRIDGE_STATE_DIR");
	try {
		await assert.rejects(listRules(), { message: /FLIX_BRIDGE_STATE_DIR/ });
	} finally {
		if (previous !== undefined) process.env.FLIX_BRIDGE_STATE_DIR = previous;
	}
	await assert.rejects(listRules({ stateDir: "relative" }), {
		message: /absolute/,
	});
	await createRule(
		{ id: "movies", name: "Movies", rule, evaluationTime: time },
		options,
	);
	const path = join(options.stateDir, "retention", "rules.json");
	assert.equal((await stat(path)).mode & 0o077, 0);
	assert.equal(
		(await stat(join(options.stateDir, "retention"))).mode & 0o077,
		0,
	);
	await writeFile(path, "{bad json");
	await assert.rejects(listRules(options));
	await assert.rejects(
		createRule(
			{ id: "another", name: "Another", rule, evaluationTime: time },
			options,
		),
	);
	assert.equal(await readFile(path, "utf8"), "{bad json");
	await rm(path);
	const target = join(options.stateDir, "outside.json");
	await writeFile(target, "{}");
	await symlink(target, path);
	await assert.rejects(listRules(options));
	assert.equal(await readFile(target, "utf8"), "{}");
});

test("scheduler failure is reserved durably, secret-free and does not retry the same interval", async (t) => {
	const options = await storage(t);
	await createRule(
		{ id: "movies", name: "Movies", rule, evaluationTime: time },
		options,
	);
	await reviseRule(
		{ id: "movies", expectedVersion: 1, enabled: true, evaluationTime: time },
		options,
	);
	let calls = 0;
	const evaluate = async () => {
		calls++;
		throw Error("secret-api-key");
	};
	const first = await runDueRules({ evaluationTime: time }, evaluate, options);
	assert.equal(first[0].status, "failed");
	assert.ok(!JSON.stringify(first).includes("secret-api-key"));
	assert.deepEqual(
		await runDueRules({ evaluationTime: time }, evaluate, options),
		[],
	);
	assert.equal(calls, 1);
	await assert.rejects(
		evaluateRule(
			{ id: "movies", evaluationTime: "2026-10-19T00:00:00Z" },
			evaluate,
			options,
		),
		{ message: /precedes/ },
	);
	const disk = JSON.parse(
		await readFile(join(options.stateDir, "retention", "rules.json"), "utf8"),
	);
	assert.equal(disk.attempts[0].status, "failed");
	assert.ok(!JSON.stringify(disk).includes("secret-api-key"));
});
