import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

// Only the loopback HTTP boundary is replaced; fetchJson and parsing are real.
let api;
let base;
const calls = [];
let route = () => [404, {}];
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
before(async () => {
	globalThis.fetch = (url, options) => {
		assert.equal(
			new URL(url).hostname,
			"127.0.0.1",
			"Tests must never contact live services",
		);
		return originalFetch(url, options);
	};
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_)?(SONARR|RADARR|PLEX|JELLYFIN|TMDB)_/.test(key))
			Reflect.deleteProperty(process.env, key);
	api = createServer((req, res) => {
		calls.push({ url: req.url, headers: req.headers, method: req.method });
		const [status, body] = route(new URL(req.url, "http://localhost"), req);
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(typeof body === "string" ? body : JSON.stringify(body));
	});
	await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${api.address().port}/prefix`;
});
after(async () => {
	globalThis.fetch = originalFetch;
	process.env = originalEnv;
	await new Promise((resolve) => api.close(resolve));
});
const moduleUnderTest = () => import("../dist/library/intelligence.js");

test("read-only tool schemas reject unknown fields, coercion, missing users and invalid bounds before HTTP", async () => {
	const { libraryTools, runLibraryTool, mediaServers } =
		await moduleUnderTest();
	assert.deepEqual(libraryTools.map((t) => t.name).sort(), [
		"library_list",
		"media_detail",
		"upcoming_media",
		"watch_history",
		"watch_status",
	]);
	for (const tool of libraryTools) {
		assert.equal(tool.inputSchema.additionalProperties, false);
		assert.equal(tool.annotations.readOnlyHint, true);
	}
	const before = calls.length;
	for (const [name, args] of [
		["library_list", { page: 0 }],
		["library_list", { pageSize: 251 }],
		["library_list", { extra: true }],
		["media_detail", { service: "radarr-test", itemId: "1" }],
		["watch_status", { service: "radarr-test", itemId: 1, users: [] }],
		[
			"watch_status",
			{
				service: "radarr-test",
				itemId: 1,
				users: [{ server: "plex", userId: "1", extra: true }],
			},
		],
		["watch_history", { server: "plex", userId: "1", page: 1.2 }],
		["upcoming_media", { start: "not-a-date" }],
		["unknown_tool", {}],
	])
		assert.equal((await runLibraryTool(name, args)).ok, false);
	assert.equal(calls.length, before);
	process.env.PLEX_TEST_URL = base;
	process.env.PLEX_TEST_TOKEN = "private-test-token";
	process.env.JELLYFIN_TEST_URL = base;
	process.env.JELLYFIN_TEST_API_KEY = "private-jelly-key";
	assert.deepEqual(
		mediaServers().map(({ name, type }) => ({ name, type })),
		[
			{ name: "jellyfin-test", type: "jellyfin" },
			{ name: "plex-test", type: "plex" },
		],
	);
	assert.ok(!JSON.stringify(mediaServers()).includes("private-"));
});
const movie = {
	id: 1,
	title: "Exact",
	tmdbId: 100,
	imdbId: "tt123",
	year: 2020,
	path: "/movies/Exact",
	monitored: true,
	status: "released",
	added: "2020-01-01T00:00:00Z",
	tags: [2],
	hasFile: true,
	movieFile: { id: 4 },
	ratings: {
		imdb: { value: 7.4, votes: 20, type: "user" },
		rottenTomatoes: { value: 85, votes: 10, type: "critic" },
	},
};
const movieFile = {
	id: 4,
	movieId: 1,
	path: "/movies/Exact/movie.mkv",
	size: 1000,
};
test("tools return paged ARR browsing, exact detail and real bounded calendar records", async () => {
	process.env.RADARR_TEST_URL = base;
	process.env.RADARR_TEST_API_KEY = "fixture-secret";
	route = (url) =>
		url.pathname === "/prefix/api/v3/calendar"
			? [
					200,
					[
						{
							id: 1,
							title: "Exact",
							digitalRelease: "2026-01-02T00:00:00Z",
							tmdbId: 100,
						},
					],
				]
			: arrRoute(url);
	const { runLibraryTool } = await moduleUnderTest();
	const listed = await runLibraryTool("library_list", {
		services: ["radarr-test"],
		pageSize: 1,
		query: "exact",
	});
	assert.equal(listed.ok, true);
	assert.equal(listed.data.total, 1);
	assert.equal(listed.data.hasMore, false);
	assert.equal(listed.data.items[0].service, "radarr-test");
	const detail = await runLibraryTool("media_detail", {
		service: "radarr-test",
		itemId: 1,
	});
	assert.equal(detail.ok, true);
	assert.equal(detail.data.id, 1);
	const calendar = await runLibraryTool("upcoming_media", {
		services: ["radarr-test"],
		start: "2026-01-01T00:00:00Z",
		end: "2026-01-10T00:00:00Z",
	});
	assert.equal(calendar.ok, true);
	assert.equal(calendar.data.items[0].digitalRelease, "2026-01-02T00:00:00Z");
	const prior = calls.length;
	assert.equal(
		(
			await runLibraryTool("upcoming_media", {
				start: "2026-01-10T00:00:00Z",
				end: "2026-01-01T00:00:00Z",
			})
		).ok,
		false,
	);
	assert.equal(calls.length, prior);
});
test("Jellyfin isolates viewer summaries, exact joins, favourites and active sessions over real HTTP", async () => {
	const {
		loadLibrarySnapshot,
		getWatchEvidence,
		runLibraryTool,
		mediaSystemStatus,
	} = await moduleUnderTest();
	process.env.JELLYFIN_TEST_URL = base;
	process.env.JELLYFIN_TEST_API_KEY = "private-jelly-key";
	let sessions = [];
	route = (url, req) => {
		if (url.pathname.includes("/api/v3/")) return arrRoute(url);
		assert.equal(req.headers["x-emby-token"], "private-jelly-key");
		if (url.pathname === "/prefix/Auth/Providers") return [200, []];
		if (url.pathname === "/prefix/System/Info")
			return [
				200,
				{ Id: "server-one", ServerName: "Fixture", Version: "10.10.0" },
			];
		if (/\/Users\/(alice|bob)$/.test(url.pathname))
			return [
				200,
				{ Id: url.pathname.split("/").at(-1), Name: "Fixture user" },
			];
		if (url.pathname === "/prefix/Sessions") return [200, sessions];
		if (url.pathname.endsWith("/Items")) {
			const user = url.pathname.split("/")[3];
			return [
				200,
				{
					Items: [
						{
							Id: "copy-a",
							Name: "Different title is fine",
							Type: "Movie",
							ProviderIds: { Tmdb: "100", Imdb: "tt123" },
							MediaSources: [{ Path: movieFile.path }],
							UserData: {
								Played: user === "alice",
								PlaybackPositionTicks: user === "bob" ? 10 : 0,
								IsFavorite: user === "bob",
								LastPlayedDate: "2026-01-01T00:00:00Z",
							},
						},
					],
					TotalRecordCount: 1,
					StartIndex: 0,
				},
			];
		}
		return [404, {}];
	};
	const item = (await loadLibrarySnapshot(["radarr-test"])).items[0];
	const users = [
		{ server: "jellyfin-test", userId: "alice" },
		{ server: "jellyfin-test", userId: "bob" },
	];
	const result = await getWatchEvidence(item, users);
	assert.equal(result.complete, true);
	assert.deepEqual(
		result.viewers.map((v) => v.status),
		["watched", "partial"],
	);
	assert.equal(result.favourite, true);
	assert.equal(result.activePlayback, false);
	sessions = [
		{
			UserId: "not-selected",
			NowPlayingItem: {
				Id: "copy-a",
				MediaSources: [{ Path: movieFile.path }],
			},
		},
	];
	assert.equal((await getWatchEvidence(item, users)).activePlayback, true);
	const status = await runLibraryTool("watch_status", {
		service: "radarr-test",
		itemId: 1,
		users,
	});
	assert.equal(status.ok, true);
	assert.deepEqual(
		status.data.viewers.map((v) => v.status),
		["watched", "partial"],
	);
	assert.equal((await mediaSystemStatus("jellyfin-test")).ok, true);
	const history = await runLibraryTool("watch_history", {
		server: "jellyfin-test",
		userId: "alice",
	});
	assert.equal(history.ok, true);
	assert.equal(history.data.supported, false);
	assert.deepEqual(history.data.events, []);
});

test("standalone media browsing and user discovery need no ARR configuration", async () => {
	const saved = process.env.RADARR_TEST_URL;
	Reflect.deleteProperty(process.env, "RADARR_TEST_URL");
	Reflect.deleteProperty(process.env, "RADARR_TEST_API_KEY");
	const { loadLibrarySnapshot, runLibraryTool } = await moduleUnderTest();
	route = (url) => {
		if (url.pathname === "/prefix/Items")
			return [
				200,
				{
					Items: [
						{
							Id: "j-copy",
							Name: "Standalone",
							Type: "Movie",
							ProviderIds: { Tmdb: "100" },
						},
					],
					TotalRecordCount: 1,
				},
			];
		if (url.pathname === "/prefix/Users")
			return [
				200,
				[{ Id: "alice", Name: "Alice", AccessToken: "must-not-leak" }],
			];
		if (url.pathname === "/prefix/accounts")
			return [
				200,
				{ MediaContainer: { Account: [{ id: 9, name: "Plex viewer" }] } },
			];
		if (url.pathname === "/prefix/library/sections")
			return [
				200,
				{
					MediaContainer: {
						Directory: [{ key: "1", type: "movie", title: "Films" }],
					},
				},
			];
		if (url.pathname === "/prefix/library/sections/1/all")
			return [
				200,
				{
					MediaContainer: {
						size: 1,
						totalSize: 1,
						offset: 0,
						Metadata: [
							{
								ratingKey: "7",
								title: "Plex movie",
								type: "movie",
								Guid: [{ id: "tmdb://100" }],
							},
						],
					},
				},
			];
		return [404, {}];
	};
	try {
		assert.equal((await loadLibrarySnapshot()).items.length, 0);
		const browse = await runLibraryTool("library_list", {});
		assert.equal(browse.ok, true);
		assert.equal(browse.data.complete, true);
		assert.deepEqual(
			browse.data.items.map((i) => i.id),
			["j-copy", "7"],
		);
		const users = await runLibraryTool("library_list", {
			scope: "users",
			services: ["jellyfin-test", "plex-test"],
		});
		assert.equal(users.ok, true);
		assert.deepEqual(
			users.data.items.map((u) => [u.server, u.userId]),
			[
				["jellyfin-test", "alice"],
				["plex-test", "9"],
			],
		);
		assert.ok(!JSON.stringify(users).includes("must-not-leak"));
	} finally {
		process.env.RADARR_TEST_URL = saved;
		process.env.RADARR_TEST_API_KEY = "fixture-secret";
	}
});

test("Plex uses configured per-user tokens, exact GUIDs and real account-scoped history; favourites stay unknown", async () => {
	process.env.PLEX_TEST_USER_ALICE_ID = "9";
	process.env.PLEX_TEST_USER_ALICE_TOKEN = "alice-token";
	const {
		loadLibrarySnapshot,
		getWatchEvidence,
		runLibraryTool,
		mediaSystemStatus,
	} = await moduleUnderTest();
	route = (url, req) => {
		if (url.pathname.includes("/api/v3/")) return arrRoute(url);
		if (url.pathname === "/prefix/identity")
			return [
				200,
				{
					MediaContainer: {
						machineIdentifier: "fixture-server",
						version: "1.42",
					},
				},
			];
		if (url.pathname === "/prefix/accounts")
			return [
				200,
				{
					MediaContainer: {
						Account: [
							{ id: 9, name: "Alice" },
							{ id: 10, name: "Bob" },
						],
					},
				},
			];
		if (url.pathname === "/prefix/library/sections") {
			assert.equal(req.headers["x-plex-token"], "alice-token");
			return [
				200,
				{ MediaContainer: { Directory: [{ key: "1", type: "movie" }] } },
			];
		}
		if (url.pathname === "/prefix/library/sections/1/all")
			return [
				200,
				{
					MediaContainer: {
						size: 1,
						totalSize: 1,
						Metadata: [
							{
								ratingKey: "7",
								type: "movie",
								title: "Different",
								Guid: [{ id: "tmdb://100" }, { id: "imdb://tt123" }],
								viewCount: 1,
								lastViewedAt: 100,
								Media: [{ Part: [{ file: movieFile.path }] }],
							},
						],
					},
				},
			];
		if (url.pathname === "/prefix/status/sessions")
			return [
				200,
				{
					MediaContainer: {
						size: 1,
						Metadata: [
							{
								ratingKey: "7",
								type: "movie",
								title: "Playing elsewhere",
								Media: [{ Part: [{ file: movieFile.path }] }],
							},
						],
					},
				},
			];
		if (url.pathname === "/prefix/:/prefs")
			return [
				200,
				{
					MediaContainer: {
						size: 1,
						Setting: [{ id: "FriendlyName", value: "Fixture" }],
					},
				},
			];
		if (url.pathname === "/prefix/status/sessions/history") {
			assert.equal(url.searchParams.get("accountID"), "9");
			return [
				200,
				{
					MediaContainer: {
						size: 1,
						totalSize: 1,
						offset: 0,
						Metadata: [
							{
								historyKey: "h1",
								ratingKey: "7",
								type: "movie",
								title: "Real history",
								accountID: 9,
								viewedAt: 100,
							},
						],
					},
				},
			];
		}
		return [404, {}];
	};
	const item = (await loadLibrarySnapshot(["radarr-test"])).items[0];
	const evidence = await getWatchEvidence(item, [
		{ server: "plex-test", userId: "9" },
		{ server: "plex-test", userId: "10" },
	]);
	assert.deepEqual(
		evidence.viewers.map((v) => v.status),
		["watched", "unknown"],
	);
	assert.equal(evidence.activePlayback, true);
	assert.equal(evidence.favourite, null);
	assert.equal(evidence.complete, false);
	// Known unsupported Plex favourites are a limitation (policy-option opt-in), not a failed read.
	assert.ok(evidence.limitations.some((b) => /favourite/i.test(b)));
	const events = await runLibraryTool("watch_history", {
		server: "plex-test",
		userId: "9",
	});
	assert.equal(events.ok, true);
	assert.equal(events.data.events[0].id, "h1");
	assert.equal(events.data.events[0].watchedAt, "1970-01-01T00:01:40.000Z");
	assert.equal(events.data.total, 1);
	assert.equal((await mediaSystemStatus("plex-test")).ok, true);
});

test("optional TMDB reviews are actual provider text, attributed, bounded and never conditions", async () => {
	const { runLibraryTool } = await moduleUnderTest();
	route = arrRoute;
	const unconfigured = await runLibraryTool("media_detail", {
		service: "radarr-test",
		itemId: 1,
		includeReviews: true,
	});
	assert.equal(unconfigured.ok, true);
	assert.equal(unconfigured.data.reviews.capability, "unconfigured");
	process.env.TMDB_API_TOKEN = "tmdb-test-secret";
	const realFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, options) => {
		if (new URL(url).hostname !== "api.themoviedb.org")
			return realFetch(url, options);
		requests.push({ url: String(url), headers: new Headers(options.headers) });
		const body = new URL(url).pathname.endsWith("/reviews")
			? {
					id: 100,
					page: 1,
					total_pages: 1,
					total_results: 1,
					results: [
						{
							id: "review-a",
							author: "Actual reviewer",
							content: "Literal fixture review, not generated.",
							url: "https://www.themoviedb.org/review/review-a",
							created_at: "2026-01-01T00:00:00Z",
							author_details: { rating: 8 },
						},
					],
				}
			: { id: 100, vote_average: 7.2, vote_count: 50 };
		return new Response(JSON.stringify(body), { status: 200 });
	};
	try {
		const result = await runLibraryTool("media_detail", {
			service: "radarr-test",
			itemId: 1,
			includeReviews: true,
		});
		assert.equal(result.ok, true);
		assert.equal(result.data.reviews.capability, "supported");
		assert.equal(
			result.data.reviews.items[0].content,
			"Literal fixture review, not generated.",
		);
		assert.equal(result.data.reviews.executableConditions, false);
		assert.deepEqual(result.data.reviews.rating, {
			source: "tmdb",
			value: 7.2,
			scale: 10,
			votes: 50,
		});
		assert.equal(requests.length, 2);
		assert.ok(
			requests.every(
				(r) => r.headers.get("authorization") === "Bearer tmdb-test-secret",
			),
		);
		assert.ok(!JSON.stringify(result).includes("tmdb-test-secret"));
	} finally {
		globalThis.fetch = realFetch;
		Reflect.deleteProperty(process.env, "TMDB_API_TOKEN");
	}
});

test("Sonarr preserves every episode, multi-episode file identity and scale without v5 fallback", async () => {
	process.env.SONARR_TEST_URL = base;
	process.env.SONARR_TEST_API_KEY = "sonarr-fixture";
	const { loadLibrarySnapshot } = await moduleUnderTest();
	const series = {
		id: 2,
		title: "Series",
		tvdbId: 200,
		path: "/series/Series",
		monitored: true,
		status: "ended",
		tags: [],
		seasons: [
			{ seasonNumber: 0, monitored: false },
			{ seasonNumber: 1, monitored: true },
		],
		statistics: { totalEpisodeCount: 2, episodeFileCount: 1 },
		ratings: { value: 8, votes: 4 },
	};
	const episodes = [1, 2].map((ep) => ({
		id: ep + 10,
		seriesId: 2,
		seasonNumber: 1,
		episodeNumber: ep,
		title: `Episode ${ep}`,
		episodeFileId: 5,
		hasFile: true,
		monitored: true,
		airDateUtc: "2020-01-01T00:00:00Z",
	}));
	calls.length = 0;
	route = (url) => {
		if (url.pathname === "/prefix/api")
			return [200, { current: "v5", deprecated: ["v3"] }];
		if (url.pathname === "/prefix/api/v5/system/status")
			return [200, { appName: "Sonarr", version: "5.0.0" }];
		if (url.pathname === "/prefix/api/v3/tag") return [200, []];
		if (url.pathname === "/prefix/api/v3/series") return [200, [{ id: 2 }]];
		if (url.pathname === "/prefix/api/v3/series/2") return [200, series];
		if (url.pathname === "/prefix/api/v3/episode") return [200, episodes];
		if (url.pathname === "/prefix/api/v3/episodefile")
			return [
				200,
				[{ id: 5, seriesId: 2, path: "/series/Series/double.mkv", size: 50 }],
			];
		return [404, {}];
	};
	try {
		const legacy = await loadLibrarySnapshot(["sonarr-test"]);
		assert.equal(legacy.complete, true);
		assert.deepEqual(legacy.items[0].files[0].episodeIds, [11, 12]);
		assert.equal(legacy.items[0].seasons[0].seasonNumber, 0);
		assert.equal(legacy.items[0].ratings[0].scale, 10);
		process.env.SONARR_TEST_API_VERSION = "5";
		calls.length = 0;
		const pinned = await loadLibrarySnapshot(["sonarr-test"]);
		assert.equal(pinned.complete, false);
		assert.match(pinned.errors[0].message, /not ported/);
		assert.ok(calls.every((c) => !c.url.includes("/v3/")));
		process.env.SONARR_TEST_API_VERSION = "auto";
		calls.length = 0;
		assert.equal((await loadLibrarySnapshot(["sonarr-test"])).complete, false);
		assert.ok(calls.every((c) => !c.url.includes("/v3/")));
	} finally {
		Reflect.deleteProperty(process.env, "SONARR_TEST_URL");
		Reflect.deleteProperty(process.env, "SONARR_TEST_API_KEY");
		Reflect.deleteProperty(process.env, "SONARR_TEST_API_VERSION");
	}
});

test("ARR pagination, auth and schema failures preserve partial snapshots and never upstream secrets", async () => {
	const { loadLibrarySnapshot, runLibraryTool } = await moduleUnderTest();
	let mode = "paged";
	route = (url) => {
		if (url.pathname === "/prefix/api/v3/movie") {
			const page = Number(url.searchParams.get("page"));
			if (mode === "stalled")
				return [200, { records: [], totalRecords: 1, page }];
			return [200, { records: [{ id: page }], totalRecords: 2, page }];
		}
		if (url.pathname === "/prefix/api/v3/movie/2")
			return [403, { message: "secret-upstream-body" }];
		if (mode === "bad-detail" && url.pathname === "/prefix/api/v3/movie/1")
			return [200, { ...movie, monitored: "true" }];
		return arrRoute(url);
	};
	const partial = await loadLibrarySnapshot(["radarr-test"]);
	assert.equal(partial.complete, false);
	assert.equal(partial.items.length, 1);
	assert.equal(partial.errors.length, 1);
	assert.ok(!JSON.stringify(partial).includes("secret-upstream-body"));
	mode = "stalled";
	assert.equal((await loadLibrarySnapshot(["radarr-test"])).items.length, 0);
	mode = "bad-detail";
	const detail = await runLibraryTool("media_detail", {
		service: "radarr-test",
		itemId: 1,
	});
	assert.equal(detail.ok, false);
	assert.match(detail.error.message, /schema validation/);
});

test("Jellyfin unknown identity, conflicts, incomplete pages and malformed summaries block evidence", async () => {
	const { loadLibrarySnapshot, getWatchEvidence } = await moduleUnderTest();
	route = arrRoute;
	const item = (await loadLibrarySnapshot(["radarr-test"])).items[0];
	const scopes = [{ server: "jellyfin-test", userId: "alice" }];
	for (const mode of [
		"missing-played",
		"duplicate-copy",
		"conflict",
		"missing-identity",
		"stalled-page",
		"bad-user",
		"unauthorized",
	]) {
		route = (url) => {
			if (url.pathname === "/prefix/Users/alice")
				return mode === "unauthorized"
					? [401, { token: "upstream-secret" }]
					: [200, { Id: mode === "bad-user" ? "other-user" : "alice" }];
			if (url.pathname === "/prefix/Auth/Providers") return [200, []];
			if (url.pathname === "/prefix/Sessions") return [200, []];
			if (url.pathname === "/prefix/Users/alice/Items") {
				const entry = {
					Id: "one",
					Name: "Exact",
					Type: "Movie",
					ProviderIds:
						mode === "missing-identity"
							? {}
							: { Tmdb: "100", Imdb: mode === "conflict" ? "tt999" : "tt123" },
					UserData: {
						Played: true,
						PlaybackPositionTicks: 0,
						IsFavorite: false,
					},
				};
				if (mode === "missing-played")
					Reflect.deleteProperty(entry.UserData, "Played");
				const entries =
					mode === "stalled-page"
						? []
						: mode === "duplicate-copy"
							? [entry, { ...entry, Id: "two" }]
							: [entry];
				return [
					200,
					{
						Items: entries,
						TotalRecordCount: mode === "stalled-page" ? 1 : entries.length,
					},
				];
			}
			return [404, {}];
		};
		const evidence = await getWatchEvidence(item, scopes);
		assert.equal(evidence.complete, false, mode);
		assert.equal(evidence.viewers[0].status, "unknown", mode);
		assert.ok(evidence.blockers.length, mode);
		assert.ok(!JSON.stringify(evidence).includes("upstream-secret"));
	}
	const before = calls.length;
	await assert.rejects(
		() => getWatchEvidence(item, [...scopes, ...scopes]),
		(e) => /unique/.test(e.message),
	);
	assert.equal(calls.length, before);
});

test("configured status failures retain reachability distinction and exact schema endpoint", async () => {
	const { mediaSystemStatus } = await moduleUnderTest();
	route = () => [200, { Id: "fixture", ServerName: "Missing version" }];
	const malformed = await mediaSystemStatus("jellyfin-test");
	assert.equal(malformed.ok, false);
	assert.equal(malformed.data.configured, true);
	assert.match(malformed.error.message, /System\/Info/);
	route = () => [401, { error: "credential-do-not-print" }];
	const unauthorized = await mediaSystemStatus("plex-test");
	assert.equal(unauthorized.ok, false);
	assert.equal(unauthorized.data.reachable, true);
	assert.ok(!JSON.stringify(unauthorized).includes("credential-do-not-print"));
	assert.equal(
		(await mediaSystemStatus("not-configured")).data.configured,
		false,
	);
});

test("Jellyfin paginates every candidate and matches episodes by coordinates, not titles", async () => {
	const { getWatchEvidence } = await moduleUnderTest();
	const series = {
		service: "sonarr-test",
		id: 2,
		title: "Series",
		mediaKind: "series",
		providerIds: { tvdb: "200" },
		path: "/series",
		sizeBytes: 20,
		status: "ended",
		monitored: true,
		tags: [],
		ratings: [],
		seasons: [{ seasonNumber: 1, monitored: true }],
		episodes: [1, 2].map((ep) => ({
			id: ep,
			seasonNumber: 1,
			episodeNumber: ep,
			title: "Identical",
			monitored: true,
			fileId: 5,
		})),
		files: [
			{ id: 5, path: "/series/double.mkv", sizeBytes: 20, episodeIds: [1, 2] },
		],
		complete: true,
		apiFamily: 3,
	};
	let ambiguous = false;
	const starts = [];
	route = (url) => {
		if (url.pathname === "/prefix/Users/alice") return [200, { Id: "alice" }];
		if (url.pathname === "/prefix/Auth/Providers") return [200, []];
		if (url.pathname === "/prefix/Sessions") return [200, []];
		if (url.pathname === "/prefix/Users/alice/Items") {
			const state = {
				Played: true,
				PlaybackPositionTicks: 0,
				IsFavorite: false,
				LastPlayedDate: "2026-01-01T00:00:00Z",
			};
			if (url.searchParams.get("IncludeItemTypes") === "Season")
				return [
					200,
					{
						TotalRecordCount: 1,
						Items: [
							{
								Id: "season-1",
								Name: "Season",
								Type: "Season",
								SeriesId: "root",
								IndexNumber: 1,
								UserData: state,
							},
						],
					},
				];
			if (url.searchParams.get("ParentId"))
				return [
					200,
					{
						TotalRecordCount: 2,
						Items: [2, 1].map((ep) => ({
							Id: `ep-${ep}`,
							Name: "Identical",
							Type: "Episode",
							SeriesId: "root",
							ParentIndexNumber: 1,
							IndexNumber: ep,
							MediaSources: ambiguous
								? [{ Id: "a" }, { Id: "b" }]
								: [{ Id: "a", Path: "/series/double.mkv" }],
							UserData: { ...state, Played: ep === 1 },
						})),
					},
				];
			const start = Number(url.searchParams.get("StartIndex"));
			starts.push(start);
			return [
				200,
				{
					TotalRecordCount: 2,
					StartIndex: start,
					Items: [
						{
							Id: start === 0 ? "other" : "root",
							Name: "Not matched by title",
							Type: "Series",
							ProviderIds: { Tvdb: start === 0 ? "999" : "200" },
							UserData: {
								...state,
								LastPlayedDate: "2026-01-01T01:00:00+10:00",
							},
						},
					],
				},
			];
		}
		return [404, {}];
	};
	const scopes = [{ server: "jellyfin-test", userId: "alice" }];
	const result = await getWatchEvidence(series, scopes, 1);
	assert.deepEqual(starts, [0, 1]);
	assert.equal(result.complete, true);
	assert.equal(result.viewers[0].lastWatchedAt, "2026-01-01T00:00:00Z");
	assert.deepEqual(
		result.viewers[0].episodes.map((ep) => [ep.episodeNumber, ep.status]),
		[
			[1, "watched"],
			[2, "unwatched"],
		],
	);
	ambiguous = true;
	const copies = await getWatchEvidence(series, scopes, 1);
	assert.equal(copies.complete, false);
	assert.equal(copies.viewers[0].status, "unknown");
});

test("out-of-range provider ratings fail explicitly rather than disappearing", async () => {
	const { loadLibrarySnapshot, runLibraryTool } = await moduleUnderTest();
	route = (url) =>
		url.pathname === "/prefix/api/v3/movie/1"
			? [200, { ...movie, ratings: { imdb: { value: 74, votes: 20 } } }]
			: arrRoute(url);
	const result = await runLibraryTool("media_detail", {
		service: "radarr-test",
		itemId: 1,
	});
	assert.equal(result.ok, false);
	assert.match(result.error.message, /rating/i);
	route = arrRoute;
	assert.equal((await loadLibrarySnapshot(["radarr-test"])).complete, true);
});

test("provider kind drift and calendar entries without dates remain incomplete", async () => {
	const { runLibraryTool } = await moduleUnderTest();
	route = (url) =>
		url.pathname.endsWith("/calendar")
			? [200, [{ id: 1, title: "Undated" }]]
			: [
					200,
					{
						Items: [{ Id: "folder", Name: "Not a movie", Type: "Folder" }],
						TotalRecordCount: 1,
					},
				];
	const browse = await runLibraryTool("library_list", {
		services: ["jellyfin-test"],
	});
	assert.equal(browse.ok, true);
	assert.equal(browse.data.complete, false);
	assert.deepEqual(browse.data.items, []);
	const calendar = await runLibraryTool("upcoming_media", {
		services: ["radarr-test"],
		start: "2026-01-01T00:00:00Z",
		end: "2026-01-10T00:00:00Z",
	});
	assert.equal(calendar.data.complete, false);
	assert.deepEqual(calendar.data.items, []);
});

test("restricted Jellyfin credentials cannot establish server-global session absence", async () => {
	const { getWatchEvidence, loadLibrarySnapshot } = await moduleUnderTest();
	route = arrRoute;
	const item = (await loadLibrarySnapshot(["radarr-test"])).items[0];
	route = (url) => {
		if (url.pathname === "/prefix/Users/alice") return [200, { Id: "alice" }];
		if (url.pathname === "/prefix/Auth/Providers") return [403, {}];
		if (url.pathname === "/prefix/Sessions") return [200, []];
		return [
			200,
			{
				Items: [
					{
						Id: "one",
						Name: "Known",
						Type: "Movie",
						ProviderIds: { Tmdb: "100" },
						UserData: {
							Played: true,
							PlaybackPositionTicks: 0,
							IsFavorite: false,
						},
					},
				],
				TotalRecordCount: 1,
			},
		];
	};
	const result = await getWatchEvidence(item, [
		{ server: "jellyfin-test", userId: "alice" },
	]);
	assert.equal(result.complete, false);
	assert.equal(result.activePlayback, null);
});

function arrRoute(url) {
	if (url.pathname === "/prefix/api/v3/movie") return [200, [movie]];
	if (url.pathname === "/prefix/api/v3/movie/1") return [200, movie];
	if (url.pathname === "/prefix/api/v3/moviefile") return [200, [movieFile]];
	if (url.pathname === "/prefix/api/v3/tag")
		return [200, [{ id: 2, label: "keep" }]];
	return [404, {}];
}

test("ARR snapshot reads full detail, files, tags and provider-scaled ratings without losing URL prefix", async () => {
	process.env.RADARR_TEST_URL = base;
	process.env.RADARR_TEST_API_KEY = "fixture-secret";
	calls.length = 0;
	route = arrRoute;
	const { loadLibrarySnapshot } = await moduleUnderTest();
	const snapshot = await loadLibrarySnapshot(["radarr-test"]);
	assert.equal(snapshot.complete, true);
	assert.equal(snapshot.items.length, 1);
	const item = snapshot.items[0];
	assert.deepEqual(item.providerIds, { tmdb: "100", imdb: "tt123" });
	assert.deepEqual(item.tags, ["keep"]);
	assert.equal(item.files[0].path, movieFile.path);
	assert.equal(item.sizeBytes, 1000);
	assert.deepEqual(item.ratings, [
		{ source: "imdb", value: 7.4, scale: 10, votes: 20 },
		{ source: "rottenTomatoes", value: 85, scale: 100, votes: 10 },
	]);
	assert.ok(calls.some((c) => c.url === "/prefix/api/v3/movie/1"));
	assert.ok(
		calls.every(
			(c) => c.headers["x-api-key"] === "fixture-secret" && c.method === "GET",
		),
	);
});
