import assert from "node:assert/strict";
import test from "node:test";
import {
	evaluateCandidate,
	evaluateSnapshot,
	evidenceKey,
} from "../dist/retention/evaluator.js";

const evaluationTime = "2026-10-20T00:00:00Z";
const rule = {
	services: ["sonarr"],
	users: [{ server: "plex", userId: "alice" }],
	target: "completed-season",
	action: "unmonitor-delete-files",
	minSizeBytes: 0,
	minAddedAgeDays: 1,
	watchGraceDays: 1,
	minInactiveDays: 1,
	protectedTags: [],
	maxCount: 1,
	maxBytes: 100,
};
const item = {
	service: "sonarr",
	id: 1,
	mediaKind: "series",
	title: "Example",
	providerIds: { tvdb: "9" },
	path: "/tv/example",
	sizeBytes: 200,
	addedAt: "2020-01-01T00:00:00Z",
	status: "ended",
	monitored: true,
	tags: [],
	ratings: [],
	seasons: [
		{ seasonNumber: 1, monitored: true },
		{ seasonNumber: 2, monitored: true },
	],
	episodes: [1, 2].map((n) => ({
		id: n,
		seasonNumber: n,
		episodeNumber: 1,
		title: "Episode",
		airDate: "2020-01-01T00:00:00Z",
		fileId: n,
		monitored: true,
	})),
	files: [1, 2].map((n) => ({
		id: n,
		path: `/tv/example/${n}.mkv`,
		sizeBytes: 100,
		episodeIds: [n],
	})),
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
			episodes: [
				{ seasonNumber: 1, episodeNumber: 1, status: "watched" },
				{ seasonNumber: 2, episodeNumber: 1, status: "watched" },
			],
		},
	],
};
const snapshot = {
	items: [item],
	complete: true,
	errors: [],
	observedAt: evaluationTime,
};
const candidate = (extra = {}) =>
	evaluateCandidate({
		snapshot,
		item,
		rule,
		watchEvidence: watch,
		evaluationTime,
		seasonNumber: 1,
		...extra,
	});

test("unmonitor/delete-file recommendations cannot advertise an unported Sonarr v5 execution contract", () => {
	const v5 = { ...item, apiFamily: 5 };
	const result = candidate({
		item: v5,
		snapshot: { ...snapshot, items: [v5] },
	});
	assert.equal(result.eligible, false);
	assert.match(result.blockers.join(" "), /verified v3/);
	assert.equal(candidate().eligible, true);
});

test("only completed watched seasons produce exact scoped files and unmonitor targets", () => {
	const result = candidate();
	assert.equal(result.eligible, true);
	assert.deepEqual(result.files, [item.files[0]]);
	assert.equal(result.estimatedReclaimedBytes, 100);
	assert.equal(result.plan.seasonNumber, 1);
	for (const extra of [
		{ item: { ...item, status: "continuing" } },
		{
			item: {
				...item,
				episodes: [
					{ ...item.episodes[0], airDate: undefined },
					item.episodes[1],
				],
			},
		},
		{
			item: {
				...item,
				episodes: [
					{ ...item.episodes[0], airDate: "2027-01-01" },
					item.episodes[1],
				],
			},
		},
		{
			item: {
				...item,
				episodes: [
					{ ...item.episodes[0], fileId: undefined },
					item.episodes[1],
				],
			},
		},
		{
			item: {
				...item,
				files: [{ ...item.files[0], episodeIds: [1, 2] }, item.files[1]],
			},
		},
		{
			item: {
				...item,
				files: [{ ...item.files[0], episodeIds: [] }, item.files[1]],
			},
		},
		{
			watchEvidence: {
				...watch,
				viewers: [{ ...watch.viewers[0], episodes: [] }],
			},
		},
		{ seasonNumber: 0 },
	]) {
		assert.equal(candidate(extra).eligible, false, JSON.stringify(extra));
	}
});

test("whole shows require ended metadata and every episode; specials explicitly opt in", () => {
	const wholeRule = {
		...rule,
		target: "show",
		action: "remove-title",
		maxBytes: 1000,
	};
	assert.equal(
		candidate({ rule: wholeRule, seasonNumber: undefined }).eligible,
		true,
	);
	assert.equal(
		candidate({ rule: wholeRule, seasonNumber: undefined }).plan.steps[0]
			.operation,
		"remove-title",
	);
	const special = {
		...item,
		sizeBytes: 300,
		seasons: [...item.seasons, { seasonNumber: 0, monitored: true }],
		episodes: [
			...item.episodes,
			{ ...item.episodes[0], id: 3, seasonNumber: 0, fileId: 3 },
		],
		files: [
			...item.files,
			{
				...item.files[0],
				id: 3,
				path: "/tv/example/special.mkv",
				episodeIds: [3],
			},
		],
	};
	assert.equal(
		candidate({ item: special, rule: wholeRule, seasonNumber: undefined })
			.eligible,
		false,
	);
	const evidence = {
		...watch,
		viewers: [
			{
				...watch.viewers[0],
				episodes: [
					...watch.viewers[0].episodes,
					{ seasonNumber: 0, episodeNumber: 1, status: "watched" },
				],
			},
		],
	};
	assert.equal(
		candidate({
			item: special,
			watchEvidence: evidence,
			rule: { ...wholeRule, includeSpecials: true },
			seasonNumber: undefined,
		}).eligible,
		true,
	);
});

test("snapshot bounds and stable ordering do not split files or overrun byte budget", () => {
	const input = {
		snapshot,
		rule,
		evaluationTime,
		watchEvidence: {
			[evidenceKey(item, 1)]: watch,
			[evidenceKey(item, 2)]: watch,
		},
	};
	const result = evaluateSnapshot(input);
	assert.equal(result.recommendations.length, 1);
	assert.equal(result.recommendations[0].seasonNumber, 1);
	assert.equal(result.candidates.length, 2);
	assert.equal(result.candidates[1].eligible, false);
	assert.match(result.candidates[1].blockers.join(" "), /bound/i);
	assert.equal(
		evaluateSnapshot({ ...input, rule: { ...rule, maxBytes: 99 } })
			.recommendations.length,
		0,
	);
	assert.deepEqual(result, evaluateSnapshot(input));
});

test("any-selected does not waive missing or ambiguous episode evidence for other selected users", () => {
	const anyRule = {
		...rule,
		watchedPolicy: "any-selected",
		users: [...rule.users, { server: "plex", userId: "bob" }],
	};
	for (const episodes of [
		[],
		[watch.viewers[0].episodes[0], watch.viewers[0].episodes[0]],
	]) {
		const evidence = {
			...watch,
			viewers: [
				...watch.viewers,
				{ ...watch.viewers[0], userId: "bob", status: "unwatched", episodes },
			],
		};
		assert.equal(
			candidate({ rule: anyRule, watchEvidence: evidence }).eligible,
			false,
		);
	}
	assert.equal(
		candidate({
			rule: { ...rule, target: "show", maxBytes: 1000 },
			seasonNumber: undefined,
			item: {
				...item,
				episodes: [item.episodes[0]],
				files: [item.files[0]],
				sizeBytes: 100,
			},
		}).eligible,
		false,
	);
});

test("shared file paths, duplicate metadata and cross-scope files are blocked", () => {
	const duplicate = { ...item, id: 2 };
	assert.equal(
		candidate({ snapshot: { ...snapshot, items: [item, duplicate] } }).eligible,
		false,
	);
	assert.equal(
		candidate({ item: { ...item, files: [item.files[0], item.files[0]] } })
			.eligible,
		false,
	);
	assert.equal(
		candidate({
			item: { ...item, episodes: [...item.episodes, item.episodes[0]] },
		}).eligible,
		false,
	);
});
