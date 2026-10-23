import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	cleanup_candidates,
	retentionTools,
	retention_evaluate,
	retention_rules,
	runRetentionTool,
} from "../dist/retention/tools.js";

const evaluationTime = "2026-10-20T00:00:00Z";
const rule = {
	services: ["radarr"],
	users: [{ server: "plex", userId: "alice" }],
	target: "movie",
	action: "remove-title",
	minSizeBytes: 1,
	minAddedAgeDays: 1,
	watchGraceDays: 1,
	minInactiveDays: 1,
	protectedTags: [],
	maxCount: 1,
	maxBytes: 1000,
};
const item = {
	service: "radarr",
	id: 1,
	mediaKind: "movie",
	title: "Example",
	providerIds: { tmdb: "123" },
	path: "/media/example",
	sizeBytes: 100,
	addedAt: "2020-01-01T00:00:00Z",
	status: "released",
	monitored: true,
	tags: [],
	ratings: [],
	seasons: [],
	episodes: [],
	files: [
		{ id: 1, path: "/media/example/movie.mkv", sizeBytes: 100, episodeIds: [] },
	],
	complete: true,
	apiFamily: 3,
};
const watch = {
	complete: true,
	activePlayback: false,
	favourite: false,
	blockers: [],
	viewers: [
		{
			server: "plex",
			userId: "alice",
			status: "watched",
			lastWatchedAt: "2020-02-01T00:00:00Z",
			episodes: [],
		},
	],
};
function dependencies() {
	const calls = [];
	return {
		calls,
		loadLibrarySnapshot: async (services) => {
			calls.push(["load", services]);
			return {
				items: [item],
				complete: true,
				errors: [],
				observedAt: evaluationTime,
			};
		},
		getWatchEvidence: async (target, users, seasonNumber) => {
			calls.push(["watch", target.id, users, seasonNumber]);
			return watch;
		},
	};
}

test("MCP descriptors and injected dispatch are usable without library runtime imports", async () => {
	assert.deepEqual(retentionTools, [
		cleanup_candidates,
		retention_rules,
		retention_evaluate,
	]);
	assert.deepEqual(
		retentionTools.map((t) => t.name),
		["cleanup_candidates", "retention_rules", "retention_evaluate"],
	);
	for (const descriptor of retentionTools)
		assert.equal(descriptor.inputSchema.additionalProperties, false);
	assert.equal(cleanup_candidates.annotations.readOnlyHint, true);
	assert.equal(retention_rules.annotations.readOnlyHint, false);
	const deps = dependencies();
	const result = await runRetentionTool(
		"cleanup_candidates",
		{ rule, evaluationTime },
		deps,
	);
	assert.equal(result.recommendations.length, 1);
	assert.deepEqual(deps.calls, [
		["load", ["radarr"]],
		["watch", 1, rule.users, undefined],
	]);
	assert.deepEqual(result.recommendations[0].plan.files, item.files);
	await assert.rejects(
		runRetentionTool(
			"cleanup_candidates",
			{ rule, evaluationTime, extra: true },
			deps,
		),
	);
	await assert.rejects(runRetentionTool("not-a-tool", {}, deps));
	const blocked = await runRetentionTool(
		"cleanup_candidates",
		{ rule, evaluationTime },
		{
			...deps,
			getWatchEvidence: async () => {
				throw Error("private credentials not emitted");
			},
		},
	);
	assert.equal(blocked.recommendations.length, 0);
	assert.ok(!JSON.stringify(blocked).includes("private credentials"));
});

test("persistent tool mutations never call live dependencies; evaluation is proposal-only", async (t) => {
	const stateDir = await mkdtemp(join(tmpdir(), "retention-tools-"));
	const previous = process.env.FLIX_BRIDGE_STATE_DIR;
	process.env.FLIX_BRIDGE_STATE_DIR = stateDir;
	t.after(async () => {
		if (previous === undefined)
			Reflect.deleteProperty(process.env, "FLIX_BRIDGE_STATE_DIR");
		else process.env.FLIX_BRIDGE_STATE_DIR = previous;
		await rm(stateDir, { recursive: true, force: true });
	});
	const deps = dependencies();
	const created = await runRetentionTool(
		"retention_rules",
		{ operation: "create", id: "movies", name: "Movies", rule, evaluationTime },
		deps,
	);
	assert.equal(created.enabled, false);
	assert.equal(
		(await runRetentionTool("retention_rules", { operation: "list" }, deps))
			.length,
		1,
	);
	assert.equal(
		(
			await runRetentionTool(
				"retention_rules",
				{ operation: "get", id: "movies", version: 1 },
				deps,
			)
		).version,
		1,
	);
	await runRetentionTool(
		"retention_rules",
		{
			operation: "revise",
			id: "movies",
			expectedVersion: 1,
			enabled: true,
			evaluationTime,
		},
		deps,
	);
	assert.deepEqual(deps.calls, []);
	const evaluated = await runRetentionTool(
		"retention_evaluate",
		{ id: "movies", evaluationTime },
		deps,
	);
	assert.equal(evaluated.version, 2);
	assert.equal(evaluated.result.recommendations.length, 1);
	assert.deepEqual(
		deps.calls.map((c) => c[0]),
		["load", "watch"],
	);
});
