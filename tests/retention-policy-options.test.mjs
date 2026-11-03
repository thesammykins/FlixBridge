import assert from "node:assert/strict";
import test from "node:test";
import { getWatchEvidence } from "../dist/library/watch.js";
import { evaluateCandidate } from "../dist/retention/evaluator.js";
import { ruleSchema } from "../dist/retention/schema.js";
import { cleanupCandidates, ruleJsonSchema } from "../dist/retention/tools.js";

const evaluationTime = "2026-10-20T00:00:00Z";
const rule = {
	services: ["radarr"],
	users: [{ server: "plex-policy", userId: "9" }],
	target: "movie",
	action: "unmonitor-delete-files",
	minSizeBytes: 1,
	minAddedAgeDays: 30,
	watchGraceDays: 7,
	minInactiveDays: 60,
	protectedTags: [],
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
	ratings: [{ source: "imdb", scale: 10, value: 3, votes: 100 }],
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
	blockers: [],
	viewers: [
		{
			...rule.users[0],
			status: "watched",
			lastWatchedAt: "2026-01-01T00:00:00Z",
			episodes: [],
		},
	],
};
function candidate(overrides = {}) {
	const target = overrides.item ?? item;
	return evaluateCandidate({
		snapshot: {
			items: [target],
			complete: true,
			errors: [],
			observedAt: evaluationTime,
		},
		item: target,
		rule,
		watchEvidence: watch,
		evaluationTime,
		...overrides,
	});
}

// Exercise real provider parsers/HTTP client with only transport replaced.
async function plexEvidence(run) {
	const originalEnv = { ...process.env };
	const originalFetch = globalThis.fetch;
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_)?(PLEX|JELLYFIN)_/.test(key)) delete process.env[key];
	Object.assign(process.env, {
		PLEX_POLICY_URL: "http://127.0.0.1:9876/plex",
		PLEX_POLICY_TOKEN: "test-owner",
		PLEX_POLICY_USER_ALICE_ID: "9",
		PLEX_POLICY_USER_ALICE_TOKEN: "test-alice",
		JELLYFIN_POLICY_URL: "http://127.0.0.1:9876/jelly",
		JELLYFIN_POLICY_API_KEY: "test-jelly",
	});
	const state = {
		viewCount: 1,
		lastViewedAt: 1767225600,
		sessions: { size: 0 },
		jellyUserData: {
			Played: false,
			PlaybackPositionTicks: 0,
			IsFavorite: false,
		},
	};
	globalThis.fetch = async (input, options) => {
		const url = new URL(input);
		assert.equal(url.origin, "http://127.0.0.1:9876");
		assert.equal(options?.method ?? "GET", "GET");
		const routes = {
			"/plex/accounts": {
				MediaContainer: { Account: [{ id: 9, name: "Alice" }] },
			},
			"/plex/:/prefs": {
				MediaContainer: {
					size: 1,
					Setting: [{ id: "FriendlyName", value: "Fixture" }],
				},
			},
			"/plex/library/sections": {
				MediaContainer: { Directory: [{ key: "1", type: "movie" }] },
			},
			"/plex/library/sections/1/all": {
				MediaContainer: {
					size: 1,
					totalSize: 1,
					Metadata: [
						{
							ratingKey: "7",
							type: "movie",
							title: "Example",
							Guid: [{ id: "tmdb://123" }],
							viewCount: state.viewCount,
							lastViewedAt: state.lastViewedAt,
							Media: [{ Part: [{ file: item.files[0].path }] }],
						},
					],
				},
			},
			"/plex/status/sessions": { MediaContainer: state.sessions },
			"/jelly/Users/alice": { Id: "alice" },
			"/jelly/Users/alice/Items": {
				Items: [
					{
						Id: "j1",
						Name: "Example",
						Type: "Movie",
						ProviderIds: { Tmdb: "123" },
						MediaSources: [{ Path: item.files[0].path }],
						UserData: state.jellyUserData,
					},
				],
				TotalRecordCount: 1,
				StartIndex: 0,
			},
			"/jelly/Auth/Providers": [],
			"/jelly/Sessions": [],
		};
		assert.ok(
			routes[url.pathname],
			`Unexpected provider route: ${url.pathname}`,
		);
		return new Response(JSON.stringify(routes[url.pathname]), { status: 200 });
	};
	try {
		await run(state);
	} finally {
		globalThis.fetch = originalFetch;
		process.env = originalEnv;
	}
}

test("explicit Jellyfin unwatched flags work without history but missing favourites never receive the Plex waiver", async () => {
	await plexEvidence(async (state) => {
		const jellyUsers = [{ server: "jellyfin-policy", userId: "alice" }];
		const jellyRule = {
			...rule,
			users: jellyUsers,
			watchState: "unwatched",
			allowUnsupportedFavourites: true,
		};
		let evidence = await getWatchEvidence(item, jellyUsers);
		assert.equal(evidence.complete, true);
		assert.equal(evidence.favouriteSupported, true);
		assert.equal(evidence.viewers[0].status, "unwatched");
		assert.equal(evidence.viewers[0].lastWatchedAt, undefined);
		assert.equal(
			candidate({ rule: jellyRule, watchEvidence: evidence }).eligible,
			true,
		);
		for (const stateUpdate of [
			{ IsFavorite: undefined },
			{ IsFavorite: true },
			{ Played: undefined },
			{ PlaybackPositionTicks: 1 },
		]) {
			const saved = state.jellyUserData;
			state.jellyUserData = { ...saved, ...stateUpdate };
			evidence = await getWatchEvidence(item, jellyUsers);
			assert.equal(
				candidate({ rule: jellyRule, watchEvidence: evidence }).eligible,
				false,
				JSON.stringify(stateUpdate),
			);
			state.jellyUserData = saved;
		}
		const users = [...rule.users, ...jellyUsers];
		const mixedRule = {
			...rule,
			users,
			watchedPolicy: "any-selected",
			allowUnsupportedFavourites: true,
		};
		evidence = await getWatchEvidence(item, users);
		assert.equal(evidence.complete, true);
		assert.equal(evidence.favouriteSupported, false);
		assert.equal(evidence.favourite, null);
		assert.equal(
			candidate({ rule: mixedRule, watchEvidence: evidence }).eligible,
			true,
		);
		for (const IsFavorite of [undefined, true]) {
			state.jellyUserData.IsFavorite = IsFavorite;
			evidence = await getWatchEvidence(item, users);
			assert.equal(
				candidate({ rule: mixedRule, watchEvidence: evidence }).eligible,
				false,
				String(IsFavorite),
			);
		}
	});
});

test("snapshot observations allow only a deterministic five-minute post-evaluation read window", async () => {
	for (const observedAt of ["2026-10-20T00:00:01Z", "2026-10-20T00:05:00Z"]) {
		const snapshot = { items: [item], complete: true, errors: [], observedAt };
		const result = candidate({ snapshot });
		assert.equal(result.eligible, true, observedAt);
		assert.equal(result.evidence.observedAt, observedAt);
		assert.equal(result.evidence.evaluationTime, evaluationTime);
		assert.deepEqual(result, candidate({ snapshot }));
	}
	for (const observedAt of [
		"2026-10-20T00:05:00.001Z",
		"2027-01-01T00:00:00Z",
		"invalid",
		undefined,
	])
		assert.equal(
			candidate({
				snapshot: { items: [item], complete: true, errors: [], observedAt },
			}).eligible,
			false,
			String(observedAt),
		);
	const snapshot = {
		items: [item],
		complete: true,
		errors: [],
		observedAt: "2026-10-20T00:00:01Z",
	};
	assert.equal(
		candidate({
			snapshot,
			item: { ...item, addedAt: "2026-10-20T00:00:01Z" },
			rule: { ...rule, minAddedAgeDays: 0 },
		}).eligible,
		false,
	);
	assert.equal(
		candidate({
			snapshot,
			rule: { ...rule, watchGraceDays: 0, minInactiveDays: 0 },
			watchEvidence: {
				...watch,
				viewers: [
					{ ...watch.viewers[0], lastWatchedAt: "2026-10-20T00:00:01Z" },
				],
			},
		}).eligible,
		false,
	);
	const result = await cleanupCandidates(
		{ rule, evaluationTime },
		{
			loadLibrarySnapshot: async () => snapshot,
			getWatchEvidence: async () => watch,
		},
	);
	assert.equal(result.recommendations.length, 1);
	assert.equal(
		result.recommendations[0].evidence.observedAt,
		snapshot.observedAt,
	);
});

test("old low-rated explicit unwatched movies use residency, never invented playback history", async () => {
	const unwatchedRule = {
		...rule,
		watchState: "unwatched",
		allowUnsupportedFavourites: true,
		rating: { source: "imdb", scale: 10, maxValue: 4, minVotes: 100 },
	};
	await plexEvidence(async (state) => {
		state.viewCount = 0;
		state.lastViewedAt = undefined;
		const evidence = await getWatchEvidence(item, rule.users);
		assert.equal(evidence.complete, true);
		assert.equal(evidence.viewers[0].status, "unwatched");
		assert.equal(evidence.viewers[0].lastWatchedAt, undefined);
		const result = candidate({ rule: unwatchedRule, watchEvidence: evidence });
		assert.equal(result.eligible, true);
		assert.deepEqual(
			result,
			candidate({ rule: unwatchedRule, watchEvidence: evidence }),
		);
		assert.match(result.reasons.join(" "), /currently unwatched/i);
		assert.match(result.reasons.join(" "), /residency/i);
		assert.match(result.reasons.join(" "), /not.*never.watched/i);
		assert.ok(
			!result.reasons.includes(
				"Age, inactivity, protection and footprint conditions satisfied",
			),
		);
		assert.equal(result.evidence.watch.viewers[0].lastWatchedAt, undefined);
		assert.equal(
			candidate({
				watchEvidence: evidence,
				rule: { ...rule, allowUnsupportedFavourites: true },
			}).eligible,
			false,
		);
		for (const addedAt of [
			undefined,
			"2026-10-01T00:00:00Z",
			"2026-08-21T00:00:00.001Z",
			"invalid",
		])
			assert.equal(
				candidate({
					item: { ...item, addedAt },
					rule: unwatchedRule,
					watchEvidence: evidence,
				}).eligible,
				false,
				String(addedAt),
			);
		assert.equal(
			candidate({
				item: { ...item, addedAt: "2026-08-21T00:00:00Z" },
				rule: unwatchedRule,
				watchEvidence: evidence,
			}).eligible,
			true,
		);
		state.viewCount = undefined;
		const missing = await getWatchEvidence(item, rule.users);
		assert.equal(missing.viewers[0].status, "unknown");
		assert.equal(
			candidate({ rule: unwatchedRule, watchEvidence: missing }).eligible,
			false,
		);
	});
});

test("unwatched rules require every viewer explicitly unwatched and preserve all evidence guards", () => {
	const unwatchedRule = {
		...rule,
		watchState: "unwatched",
		watchedPolicy: "any-selected",
	};
	const unseen = {
		...watch,
		viewers: [
			{ ...watch.viewers[0], status: "unwatched", lastWatchedAt: undefined },
		],
	};
	assert.equal(
		candidate({ rule: unwatchedRule, watchEvidence: unseen }).eligible,
		true,
	);
	for (const evidence of [
		{ ...unseen, complete: false },
		{ ...unseen, activePlayback: null },
		{ ...unseen, favourite: true },
		{ ...unseen, favourite: null },
		{ ...unseen, viewers: [] },
		{ ...unseen, viewers: [...unseen.viewers, ...unseen.viewers] },
		...["watched", "unknown", "partial", undefined].map((status) => ({
			...unseen,
			viewers: [{ ...unseen.viewers[0], status }],
		})),
		...["invalid", "2027-01-01T00:00:00Z", "2026-10-19T00:00:00Z"].map(
			(lastWatchedAt) => ({
				...unseen,
				viewers: [{ ...unseen.viewers[0], lastWatchedAt }],
			}),
		),
	])
		assert.equal(
			candidate({ rule: unwatchedRule, watchEvidence: evidence }).eligible,
			false,
			JSON.stringify(evidence),
		);
	const bob = { ...unseen.viewers[0], userId: "bob" };
	const multiRule = {
		...unwatchedRule,
		users: [...rule.users, { server: bob.server, userId: bob.userId }],
	};
	assert.equal(
		candidate({
			rule: multiRule,
			watchEvidence: { ...unseen, viewers: [...unseen.viewers, bob] },
		}).eligible,
		true,
	);
	for (const status of ["watched", "partial", "unknown"])
		assert.equal(
			candidate({
				rule: multiRule,
				watchEvidence: {
					...unseen,
					viewers: [...unseen.viewers, { ...bob, status }],
				},
			}).eligible,
			false,
			status,
		);
	assert.equal(
		candidate({ rule: multiRule, watchEvidence: unseen }).eligible,
		false,
	);
	assert.equal(
		candidate({
			watchEvidence: {
				...watch,
				viewers: [{ ...watch.viewers[0], lastWatchedAt: undefined }],
			},
		}).eligible,
		false,
	);
	assert.equal(
		candidate({
			watchEvidence: {
				...watch,
				viewers: [{ ...watch.viewers[0], lastWatchedAt: null }],
			},
		}).eligible,
		false,
	);
});

test("any-selected watched policies may use residency only for explicitly unwatched other viewers", () => {
	const bob = {
		...watch.viewers[0],
		userId: "bob",
		status: "unwatched",
		lastWatchedAt: undefined,
	};
	const anyRule = {
		...rule,
		watchedPolicy: "any-selected",
		users: [...rule.users, { server: bob.server, userId: bob.userId }],
	};
	const evidence = { ...watch, viewers: [...watch.viewers, bob] };
	for (const status of [undefined, "unexpected"]) {
		assert.equal(
			candidate({
				rule: anyRule,
				watchEvidence: {
					...evidence,
					viewers: [
						...watch.viewers,
						{ ...bob, status, lastWatchedAt: watch.viewers[0].lastWatchedAt },
					],
				},
			}).eligible,
			false,
			String(status),
		);
	}
	const result = candidate({ rule: anyRule, watchEvidence: evidence });
	assert.equal(result.eligible, true);
	assert.match(result.reasons.join(" "), /residency/);
	assert.equal(
		candidate({
			rule: anyRule,
			watchEvidence: {
				...evidence,
				viewers: [...watch.viewers, { ...bob, status: "watched" }],
			},
		}).eligible,
		false,
	);
	assert.equal(
		candidate({
			rule: anyRule,
			watchEvidence: {
				...evidence,
				viewers: [...watch.viewers, { ...bob, status: "unknown" }],
			},
		}).eligible,
		false,
	);
});

test("whole unwatched shows need complete zero/unwatched episode evidence and ended inventory", () => {
	const series = {
		...item,
		mediaKind: "series",
		status: "ended",
		seasons: [{ seasonNumber: 1, monitored: true }],
		episodes: [1, 2].map((n) => ({
			id: n,
			seasonNumber: 1,
			episodeNumber: n,
			title: "Episode",
			airDate: "2020-01-01",
			fileId: 5,
			monitored: true,
		})),
		files: [{ ...item.files[0], episodeIds: [1, 2] }],
	};
	const showRule = {
		...rule,
		target: "show",
		watchState: "unwatched",
		action: "remove-title",
	};
	const viewer = {
		...watch.viewers[0],
		status: "unwatched",
		lastWatchedAt: undefined,
		episodes: series.episodes.map(({ seasonNumber, episodeNumber }) => ({
			seasonNumber,
			episodeNumber,
			status: "unwatched",
		})),
	};
	const evidence = { ...watch, viewers: [viewer] };
	assert.equal(
		candidate({ item: series, rule: showRule, watchEvidence: evidence })
			.eligible,
		true,
	);
	for (const episodes of [
		[],
		[viewer.episodes[0]],
		[viewer.episodes[0], viewer.episodes[0]],
		...["unknown", "partial", "watched"].map((status) => [
			viewer.episodes[0],
			{ ...viewer.episodes[1], status },
		]),
	])
		assert.equal(
			candidate({
				item: series,
				rule: showRule,
				watchEvidence: { ...evidence, viewers: [{ ...viewer, episodes }] },
			}).eligible,
			false,
			JSON.stringify(episodes),
		);
	assert.equal(
		candidate({
			item: { ...series, status: "continuing" },
			rule: showRule,
			watchEvidence: evidence,
		}).eligible,
		false,
	);
	const watchedViewer = {
		...viewer,
		status: "watched",
		lastWatchedAt: watch.viewers[0].lastWatchedAt,
		episodes: viewer.episodes.map((episode) => ({
			...episode,
			status: "watched",
		})),
	};
	const anyRule = {
		...showRule,
		watchState: "watched",
		watchedPolicy: "any-selected",
		users: [...rule.users, { server: viewer.server, userId: "bob" }],
	};
	for (const status of [undefined, "unexpected"]) {
		const bob = {
			...watchedViewer,
			userId: "bob",
			status: "unwatched",
			episodes: viewer.episodes.map((episode) => ({ ...episode, status })),
		};
		assert.equal(
			candidate({
				item: series,
				rule: anyRule,
				watchEvidence: { ...watch, viewers: [watchedViewer, bob] },
			}).eligible,
			false,
			String(status),
		);
	}
	assert.throws(() =>
		candidate({
			item: series,
			rule: {
				...showRule,
				target: "completed-season",
				action: "unmonitor-delete-files",
			},
			seasonNumber: 1,
			watchEvidence: evidence,
		}),
	);
});

test("watchState defaults to watched; strict runtime and advertised schemas reject unwatched seasons", () => {
	assert.equal(ruleSchema.parse(rule).watchState, "watched");
	assert.equal(
		ruleSchema.parse({ ...rule, watchState: "unwatched" }).watchState,
		"unwatched",
	);
	assert.deepEqual(ruleJsonSchema.properties.watchState, {
		type: "string",
		enum: ["watched", "unwatched"],
		default: "watched",
	});
	assert.equal(ruleJsonSchema.additionalProperties, false);
	assert.ok(!ruleJsonSchema.required.includes("watchState"));
	assert.ok(!ruleJsonSchema.required.includes("allowUnsupportedFavourites"));
	assert.throws(() =>
		ruleSchema.parse({ ...rule, watchState: "never-watched" }),
	);
	assert.throws(() => ruleSchema.parse({ ...rule, watchState: null }));
	assert.throws(() =>
		ruleSchema.parse({
			...rule,
			watchState: "unwatched",
			target: "completed-season",
		}),
	);
	assert.ok(
		ruleJsonSchema.allOf.some(
			(constraint) =>
				constraint.if?.properties?.target?.const === "completed-season" &&
				constraint.then?.properties?.watchState?.const === "watched",
		),
	);
});

test("unsupported favourites require an explicit opt-in that cannot waive protection or missing evidence", async () => {
	const unsupported = { ...watch, favourite: null, favouriteSupported: false };
	assert.equal(candidate({ watchEvidence: unsupported }).eligible, false);
	const optedIn = { ...rule, allowUnsupportedFavourites: true };
	assert.equal(
		candidate({ rule: optedIn, watchEvidence: unsupported }).eligible,
		true,
	);
	assert.equal(ruleSchema.parse(rule).allowUnsupportedFavourites, false);
	assert.deepEqual(ruleJsonSchema.properties.allowUnsupportedFavourites, {
		type: "boolean",
		default: false,
	});
	assert.throws(() =>
		ruleSchema.parse({ ...rule, allowUnsupportedFavourites: "true" }),
	);
	assert.throws(() =>
		ruleSchema.parse({ ...rule, allowUnsupportedFavorites: true }),
	);
	for (const override of [
		{ favourite: true },
		{ favouriteSupported: true },
		{ favouriteSupported: undefined },
		{ complete: false },
		{ activePlayback: null },
		{ activePlayback: true },
		{ blockers: ["Jellyfin favourite coverage is incomplete"] },
		{ viewers: [] },
		{ viewers: [{ ...watch.viewers[0], status: "unknown" }] },
		{ viewers: [{ ...watch.viewers[0], status: "partial" }] },
	])
		assert.equal(
			candidate({
				rule: optedIn,
				watchEvidence: { ...unsupported, ...override },
			}).eligible,
			false,
			JSON.stringify(override),
		);
	await plexEvidence(async (state) => {
		const evidence = await getWatchEvidence(item, rule.users);
		const result = await cleanupCandidates(
			{ rule: optedIn, evaluationTime },
			{
				loadLibrarySnapshot: async () => ({
					items: [item],
					complete: true,
					errors: [],
					observedAt: evaluationTime,
				}),
				getWatchEvidence,
			},
		);
		assert.equal(result.recommendations.length, 1);
		assert.deepEqual(result.recommendations[0].evidence.watch, evidence);
		state.sessions = { size: 1 };
		const failed = await getWatchEvidence(item, rule.users);
		assert.equal(failed.complete, false);
		assert.notEqual(failed.favouriteSupported, false);
		assert.equal(
			candidate({ rule: optedIn, watchEvidence: failed }).eligible,
			false,
		);
	});
});

test("Plex unsupported favourites are truthful limitations, not failed watch/session coverage", async () => {
	await plexEvidence(async () => {
		const evidence = await getWatchEvidence(item, rule.users);
		assert.equal(evidence.complete, true);
		assert.equal(evidence.favourite, null);
		assert.equal(evidence.favouriteSupported, false);
		assert.deepEqual(evidence.blockers, []);
		assert.match(evidence.limitations.join(" "), /Plex.*unsupported/);
		assert.equal(candidate({ watchEvidence: evidence }).eligible, false);
	});
});
