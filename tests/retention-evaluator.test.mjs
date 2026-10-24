import assert from "node:assert/strict";
import test from "node:test";
import {
	evaluateCandidate,
	evaluateSnapshot,
	evidenceKey,
} from "../dist/retention/evaluator.js";

const evaluationTime = "2026-10-20T00:00:00.000Z";
const rule = {
	services: ["radarr"],
	users: [{ server: "plex", userId: "alice" }],
	target: "movie",
	action: "unmonitor-delete-files",
	minSizeBytes: 100,
	minAddedAgeDays: 30,
	watchGraceDays: 7,
	minInactiveDays: 14,
	protectedTags: ["keep"],
	maxCount: 10,
	maxBytes: 10000,
};
const item = {
	service: "radarr",
	id: 1,
	mediaKind: "movie",
	title: "Example",
	providerIds: { tmdb: "123" },
	path: "/media/example",
	sizeBytes: 100,
	addedAt: "2026-01-01T00:00:00Z",
	status: "released",
	monitored: true,
	tags: [],
	ratings: [],
	seasons: [],
	episodes: [],
	files: [
		{ id: 5, path: "/media/example/movie.mkv", sizeBytes: 100, episodeIds: [] },
	],
	complete: true,
	apiFamily: 3,
};
const watch = {
	complete: true,
	activePlayback: false,
	favourite: false,
	viewers: [
		{
			server: "plex",
			userId: "alice",
			status: "watched",
			lastWatchedAt: "2026-09-01T00:00:00Z",
			episodes: [],
		},
	],
	blockers: [],
};
const snapshot = {
	items: [item],
	complete: true,
	errors: [],
	observedAt: evaluationTime,
};
function candidate(overrides = {}) {
	return evaluateCandidate({
		snapshot,
		item,
		rule,
		watchEvidence: watch,
		evaluationTime,
		...overrides,
	});
}

test("watched movie produces a deterministic exact recommendation, not execution", () => {
	const result = candidate();
	assert.equal(result.eligible, true);
	assert.equal(result.estimatedReclaimedBytes, 100);
	assert.equal(result.reclaimedBytesGuaranteed, false);
	assert.deepEqual(result.files, item.files);
	assert.deepEqual(
		result.plan.steps.map((s) => s.operation),
		["unmonitor", "delete-files"],
	);
	assert.deepEqual(result, candidate());
	assert.match(result.reasons.join(" "), /watched/);
	const inputs = {
		snapshot,
		rule,
		watchEvidence: { [evidenceKey(item)]: watch },
		evaluationTime,
	};
	assert.deepEqual(evaluateSnapshot(inputs).recommendations, [result]);
});

test("unknown, protected, inconsistent or insufficient evidence always blocks", () => {
	const cases = [
		{ watchEvidence: undefined },
		{ snapshot: { ...snapshot, complete: false } },
		{
			snapshot: {
				...snapshot,
				errors: [{ service: "radarr", message: "unavailable" }],
			},
		},
		{ item: { ...item, complete: false } },
		{ item: { ...item, tags: ["keep"] } },
		{ item: { ...item, addedAt: undefined } },
		{ item: { ...item, addedAt: "2026-10-01T00:00:00Z" } },
		{ item: { ...item, providerIds: {} } },
		{ item: { ...item, files: [] } },
		{ item: { ...item, files: [{ ...item.files[0], sizeBytes: -1 }] } },
		{ watchEvidence: { ...watch, complete: false } },
		{ watchEvidence: { ...watch, activePlayback: true } },
		{ watchEvidence: { ...watch, activePlayback: null } },
		{ watchEvidence: { ...watch, favourite: true } },
		{ watchEvidence: { ...watch, favourite: null } },
		{ watchEvidence: { ...watch, blockers: ["ambiguous provider join"] } },
		{ watchEvidence: { ...watch, viewers: [] } },
		{
			watchEvidence: {
				...watch,
				viewers: [{ ...watch.viewers[0], status: "unknown" }],
			},
		},
		{
			watchEvidence: {
				...watch,
				viewers: [{ ...watch.viewers[0], status: "partial" }],
			},
		},
		{
			watchEvidence: {
				...watch,
				viewers: [{ ...watch.viewers[0], lastWatchedAt: undefined }],
			},
		},
		{
			watchEvidence: {
				...watch,
				viewers: [
					{ ...watch.viewers[0], lastWatchedAt: "2026-10-07T00:00:00Z" },
				],
			},
		},
		{ rule: { ...rule, services: ["other"] } },
		{ rule: { ...rule, minSizeBytes: 101 } },
		{
			rule: {
				...rule,
				users: [...rule.users, { server: "jellyfin", userId: "bob" }],
			},
		},
		{
			rule: {
				...rule,
				rating: { source: "imdb", scale: 10, maxValue: 5, minVotes: 100 },
			},
		},
	];
	for (const overrides of cases) {
		const result = candidate(overrides);
		assert.equal(result.eligible, false, JSON.stringify(overrides));
		assert.ok(result.blockers.length);
		assert.equal(result.plan, null);
	}
});

test("inclusive age, rating, grace and size boundaries; strict schemas", () => {
	const rated = {
		...item,
		addedAt: "2026-09-20T00:00:00Z",
		ratings: [{ source: "imdb", scale: 10, value: 5, votes: 100 }],
	};
	const scoped = {
		...rule,
		rating: { source: "imdb", scale: 10, maxValue: 5, minVotes: 100 },
	};
	const evidence = {
		...watch,
		viewers: [{ ...watch.viewers[0], lastWatchedAt: "2026-10-06T00:00:00Z" }],
	};
	assert.equal(
		candidate({ item: rated, rule: scoped, watchEvidence: evidence }).eligible,
		true,
	);
	assert.equal(
		candidate({
			item: { ...rated, ratings: [{ ...rated.ratings[0], value: 5.1 }] },
			rule: scoped,
		}).eligible,
		false,
	);
	assert.equal(
		candidate({
			item: { ...rated, ratings: [{ ...rated.ratings[0], scale: 100 }] },
			rule: scoped,
		}).eligible,
		false,
	);
	assert.equal(
		candidate({
			item: { ...rated, ratings: [{ ...rated.ratings[0], votes: 99 }] },
			rule: scoped,
		}).eligible,
		false,
	);
	assert.throws(() => candidate({ rule: { ...rule, typo: true } }));
	assert.throws(() => candidate({ rule: { ...rule, users: [] } }));
	assert.throws(() => candidate({ evaluationTime: "not-a-date" }));
});

test("exact identifier and file safety boundaries fail closed, including millisecond ages", () => {
	for (const overrides of [
		{ rule: { ...rule, maxBytes: 99 } },
		{ item: { ...item, id: -1 } },
		{ item: { ...item, path: "" } },
		{ item: { ...item, files: [{ ...item.files[0], path: "relative.mkv" }] } },
		{ item: { ...item, addedAt: "1" } },
		{ item: { ...item, addedAt: "2026-09-20T00:00:00.001Z" } },
		{
			watchEvidence: {
				...watch,
				viewers: [watch.viewers[0], watch.viewers[0]],
			},
		},
		{ item: { ...item, apiFamily: 99 } },
		{ item: { ...item, sizeBytes: 99 } },
		{ item: { ...item, sizeBytes: 101 } },
		{ item: { ...item, addedAt: "2026-02-30" } },
		{ seasonNumber: 1 },
	])
		assert.equal(
			candidate(overrides).eligible,
			false,
			JSON.stringify(overrides),
		);
	assert.throws(() =>
		candidate({
			rule: { ...rule, users: [{ server: " plex ", userId: "alice" }] },
		}),
	);
	assert.throws(() =>
		candidate({ rule: { ...rule, services: ["radarr", "radarr"] } }),
	);
	assert.throws(() =>
		candidate({
			rule: { ...rule, target: "completed-season", action: "remove-title" },
		}),
	);
});

test("all selected is the default, any-selected is explicit and never waives unknown viewers", () => {
	const users = [...rule.users, { server: "jellyfin", userId: "bob" }];
	const evidence = {
		...watch,
		viewers: [
			...watch.viewers,
			{
				...watch.viewers[0],
				server: "jellyfin",
				userId: "bob",
				status: "unwatched",
			},
		],
	};
	assert.equal(
		candidate({ rule: { ...rule, users }, watchEvidence: evidence }).eligible,
		false,
	);
	const any = candidate({
		rule: { ...rule, users, watchedPolicy: "any-selected" },
		watchEvidence: evidence,
	});
	assert.equal(any.eligible, true);
	assert.match(any.reasons.join(" "), /At least one/);
	assert.equal(any.evidence.rule.watchedPolicy, "any-selected");
	assert.equal(
		candidate({
			rule: { ...rule, users, watchedPolicy: "any-selected" },
			watchEvidence: {
				...evidence,
				viewers: [
					evidence.viewers[0],
					{ ...evidence.viewers[1], status: "unknown" },
				],
			},
		}).eligible,
		false,
	);
});

test("same titles are not crossmatched; input order does not change snapshot recommendations", () => {
	const second = {
		...item,
		id: 2,
		path: "/media/second",
		files: [{ ...item.files[0], id: 6, path: "/media/second/movie.mkv" }],
	};
	const inputs = {
		snapshot: { ...snapshot, items: [second, item] },
		rule,
		evaluationTime,
		watchEvidence: { [evidenceKey(item)]: watch, [evidenceKey(second)]: watch },
	};
	const result = evaluateSnapshot(inputs);
	assert.equal(result.recommendations.length, 2);
	assert.deepEqual(
		result,
		evaluateSnapshot({
			...inputs,
			snapshot: { ...snapshot, items: [item, second] },
		}),
	);
	assert.deepEqual(result, evaluateSnapshot(structuredClone(inputs)));
});
