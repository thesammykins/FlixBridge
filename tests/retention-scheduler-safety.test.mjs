import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createRule,
	reviseRule,
	runDueRules,
} from "../dist/retention/rules.js";
const rule = {
	services: ["radarr"],
	users: [{ server: "jellyfin", userId: "alice" }],
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
async function setup(t) {
	const stateDir = await mkdtemp(join(tmpdir(), "scheduler-safe-"));
	t.after(() => rm(stateDir, { recursive: true, force: true }));
	const options = { stateDir };
	await createRule(
		{ id: "movies", name: "Movies", rule, evaluationTime: time },
		options,
	);
	await reviseRule(
		{ id: "movies", expectedVersion: 1, enabled: true, evaluationTime: time },
		options,
	);
	return options;
}
test("a later due interval cannot overlap an existing reserved evaluation of the same logical rule", async (t) => {
	const options = await setup(t);
	let started;
	const start = new Promise((resolve) => {
		started = resolve;
	});
	let finish;
	const gate = new Promise((resolve) => {
		finish = resolve;
	});
	const first = runDueRules(
		{ evaluationTime: time },
		async () => {
			started();
			await gate;
			return "first";
		},
		options,
	);
	await start;
	try {
		await assert.rejects(
			runDueRules(
				{ evaluationTime: "2026-10-22T00:00:00Z" },
				async () => "overlap",
				options,
			),
			(error) => /outstanding evaluation/.test(error.message),
		);
	} finally {
		finish();
		await first;
	}
});
test("a name-only revision does not reset interval history and trigger duplicate proposals", async (t) => {
	const options = await setup(t);
	await runDueRules({ evaluationTime: time }, async () => "first", options);
	await reviseRule(
		{ id: "movies", expectedVersion: 2, name: "Renamed", evaluationTime: time },
		options,
	);
	const second = await runDueRules(
		{ evaluationTime: time },
		async () => "duplicate",
		options,
	);
	assert.deepEqual(second, []);
});
