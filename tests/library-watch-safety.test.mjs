import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { getWatchEvidence } from "../dist/library/watch.js";

// Source-derived DTOs, not captured deployment results. Only fetch is replaced;
// mediaReader/readJson/fetchJson, authentication headers and parsing remain real.
// Contracts: Jellyfin ItemsController, BaseItemDto, SessionController;
// Plex developer.plex.tv/pms metadata Media.Part.file and status/sessions.
const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
let seasons;
let leaves;
let root;
let sessions;
let requests;
let elevationStatus;
const state = () => ({
	Played: true,
	PlayCount: 1,
	PlaybackPositionTicks: 0,
	IsFavorite: false,
	LastPlayedDate: "2020-01-01T00:00:00Z",
});
const series = () => ({
	service: "sonarr-test",
	id: 1,
	mediaKind: "series",
	title: "Show",
	providerIds: { tvdb: "123" },
	path: "/arr/Show",
	sizeBytes: 20,
	addedAt: "2019-01-01T00:00:00Z",
	status: "ended",
	monitored: true,
	tags: [],
	ratings: [],
	seasons: [1, 2].map((seasonNumber) => ({ seasonNumber, monitored: true })),
	episodes: [1, 2].map((n) => ({
		id: n,
		seasonNumber: n,
		episodeNumber: 1,
		title: "Leaf",
		fileId: n,
		monitored: true,
		airDate: "2019-01-01",
	})),
	files: [1, 2].map((n) => ({
		id: n,
		path: `/arr/Show/s${n}.mkv`,
		sizeBytes: 10,
		episodeIds: [n],
	})),
	complete: true,
	apiFamily: 3,
});
const scopes = (type) => [{ server: `${type}-test`, userId: "alice" }];
const page = (Items) => ({
	Items,
	TotalRecordCount: Items.length,
	StartIndex: 0,
});
before(() => {
	globalThis.fetch = async (input, options) => {
		const url = new URL(input);
		assert.equal(url.origin, "http://watch.invalid", "No live HTTP permitted");
		requests.push({ url, headers: new Headers(options.headers) });
		const path = url.pathname;
		if (
			["/Auth/Providers", "/:/prefs"].includes(path) &&
			elevationStatus !== 200
		)
			return new Response("{}", { status: elevationStatus });
		let body;
		if (path === "/Users/alice") body = { Id: "alice" };
		else if (path === "/Auth/Providers") body = [];
		else if (path === "/Sessions") body = sessions;
		else if (path === "/Users/alice/Items") {
			const kind = url.searchParams.get("IncludeItemTypes");
			body = page(
				kind === "Season"
					? seasons
					: kind === "Episode"
						? leaves.filter((leaf) => leaf.Id !== "hidden")
						: [root],
			);
		} else if (path === "/Items")
			body = page(
				leaves.filter((leaf) => leaf.Id === url.searchParams.get("Ids")),
			);
		else if (path === "/accounts")
			body = { MediaContainer: { Account: [{ id: "alice" }] } };
		else if (path === "/:/prefs")
			body = {
				MediaContainer: {
					size: 1,
					Setting: [{ id: "FriendlyName", value: "Fixture" }],
				},
			};
		else if (path === "/library/sections")
			body = {
				MediaContainer: {
					Directory: [
						{ key: "1", type: root.type === "movie" ? "movie" : "show" },
					],
				},
			};
		else if (path === "/library/sections/1/all")
			body = { MediaContainer: { size: 1, totalSize: 1, Metadata: [root] } };
		else if (path.endsWith("/allLeaves")) {
			const visible = leaves.filter((leaf) => leaf.ratingKey !== "hidden");
			body = {
				MediaContainer: {
					size: visible.length,
					totalSize: visible.length,
					Metadata: visible,
				},
			};
		} else if (path === "/status/sessions")
			body = { MediaContainer: { size: sessions.length, Metadata: sessions } };
		else if (path.startsWith("/library/metadata/")) {
			const key = path.split("/").at(-1);
			const item = leaves.find((leaf) => leaf.ratingKey === key);
			body = {
				MediaContainer: { size: item ? 1 : 0, Metadata: item ? [item] : [] },
			};
		} else throw new Error(`Unexpected read ${path}`);
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};
});
beforeEach(() => {
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_)?(PLEX|JELLYFIN)_/.test(key))
			Reflect.deleteProperty(process.env, key);
	process.env.JELLYFIN_TEST_URL = "http://watch.invalid";
	process.env.JELLYFIN_TEST_API_KEY = "admin-test";
	process.env.PLEX_TEST_URL = "http://watch.invalid";
	process.env.PLEX_TEST_TOKEN = "admin-test";
	process.env.PLEX_TEST_USER_ALICE_ID = "alice";
	process.env.PLEX_TEST_USER_ALICE_TOKEN = "viewer-test";
	root = {
		Id: "root",
		Name: "Show",
		Type: "Series",
		ProviderIds: { Tvdb: "123" },
		UserData: state(),
	};
	seasons = [1, 2].map((n) => ({
		Id: `season-${n}`,
		Name: "Season",
		Type: "Season",
		SeriesId: "root",
		IndexNumber: n,
		UserData: state(),
	}));
	leaves = [1, 2].map((n) => ({
		Id: `leaf-${n}`,
		Name: "Leaf",
		Type: "Episode",
		SeriesId: "root",
		ParentIndexNumber: n,
		IndexNumber: 1,
		MediaSources: [{ Id: `source-${n}`, Path: `/arr/Show/s${n}.mkv` }],
		UserData: state(),
	}));
	sessions = [];
	requests = [];
	elevationStatus = 200;
});
after(() => {
	globalThis.fetch = savedFetch;
	process.env = savedEnv;
});

function usePlex() {
	root = {
		ratingKey: "root",
		title: "Show",
		type: "show",
		Guid: [{ id: "tvdb://123" }],
		viewCount: 1,
		lastViewedAt: 1900000000,
	};
	leaves = [1, 2].map((n) => ({
		ratingKey: `leaf-${n}`,
		title: "Leaf",
		type: "episode",
		grandparentRatingKey: "root",
		parentIndex: n,
		index: 1,
		Media: [{ Part: [{ file: `/arr/Show/s${n}.mkv` }] }],
		viewCount: 1,
		lastViewedAt: 1577836800,
	}));
}

for (const type of ["jellyfin", "plex"]) {
	test(`${type} provider+coordinates cannot transfer watched evidence from the wrong physical copy`, async () => {
		if (type === "plex") usePlex();
		if (type === "jellyfin")
			leaves[1].MediaSources[0].Path = "/arr/Show/s2-UHD.mkv";
		else leaves[1].Media[0].Part[0].file = "/arr/Show/s2-UHD.mkv";
		const wrong = await getWatchEvidence(series(), scopes(type));
		assert.equal(wrong.viewers[0].status, "unknown");
		assert.equal(wrong.complete, false);
		assert.ok(wrong.blockers.some((b) => /physical|copy|path/i.test(b)));
		const exact = await getWatchEvidence(series(), scopes(type), 1);
		assert.equal(exact.viewers[0].status, "watched");
		assert.deepEqual(exact.viewers[0].copies, [
			{
				arrFileId: 1,
				arrPath: "/arr/Show/s1.mkv",
				serverItemId: "leaf-1",
				serverPath: "/arr/Show/s1.mkv",
			},
		]);
	});
}

for (const type of ["jellyfin", "plex"]) {
	test(`${type} hidden active copy protects exact ARR file independently of selected user's root IDs`, async () => {
		if (type === "plex") {
			usePlex();
			leaves.push({
				ratingKey: "hidden",
				title: "Hidden edition",
				type: "episode",
				grandparentRatingKey: "hidden-root",
				Media: [{ Part: [{ file: "/arr/Show/s1.mkv" }] }],
			});
			sessions = [
				{
					ratingKey: "hidden",
					title: "Hidden edition",
					type: "episode",
					grandparentRatingKey: "hidden-root",
				},
			];
		} else {
			leaves.push({
				Id: "hidden",
				Name: "Hidden edition",
				Type: "Episode",
				SeriesId: "hidden-root",
				MediaSources: [{ Path: "/arr/Show/s1.mkv" }],
			});
			sessions = [
				{
					UserId: "not-selected",
					NowPlayingItem: { Id: "hidden", SeriesId: "hidden-root" },
				},
			];
		}
		const result = await getWatchEvidence(series(), scopes(type), 1);
		assert.equal(result.activePlayback, true);
		assert.equal(result.viewers[0].status, "watched");
		const globalReads = requests.filter(({ url }) =>
			type === "plex"
				? url.pathname === "/library/metadata/hidden"
				: url.pathname === "/Items",
		);
		assert.equal(globalReads.length, 1);
		assert.equal(
			globalReads[0].headers.get(
				type === "plex" ? "x-plex-token" : "x-emby-token",
			),
			"admin-test",
		);
	});
}

for (const type of ["jellyfin", "plex"]) {
	test(`${type} explicit mount mapping proves copies and active paths without inferring roots`, async () => {
		if (type === "plex") usePlex();
		for (const leaf of leaves) {
			if (type === "jellyfin")
				leaf.MediaSources[0].Path = leaf.MediaSources[0].Path.replace(
					"/arr/",
					"/server/",
				);
			else
				leaf.Media[0].Part[0].file = leaf.Media[0].Part[0].file.replace(
					"/arr/",
					"/server/",
				);
		}
		assert.equal(
			(await getWatchEvidence(series(), scopes(type))).viewers[0].status,
			"unknown",
		);
		const prefix = `${type.toUpperCase()}_TEST_PATH_MEDIA`;
		process.env[`${prefix}_ARR_ROOT`] = "/arr";
		process.env[`${prefix}_SERVER_ROOT`] = "/server";
		const matched = await getWatchEvidence(series(), scopes(type));
		assert.equal(matched.viewers[0].status, "watched");
		assert.equal(matched.complete, true);
		assert.equal(matched.activePlayback, false);
		assert.equal(
			matched.viewers[0].copies[0].serverPath,
			"/server/Show/s1.mkv",
		);
		sessions =
			type === "jellyfin"
				? [
						{
							NowPlayingItem: {
								Id: "hidden",
								MediaSources: [{ Path: "/server/Show/s1.mkv" }],
							},
						},
					]
				: [
						{
							ratingKey: "hidden",
							title: "Playing",
							type: "episode",
							Media: [{ Part: [{ file: "/server/Show/s1.mkv" }] }],
						},
					];
		assert.equal(
			(await getWatchEvidence(series(), scopes(type), 1)).activePlayback,
			true,
		);
		process.env[`${prefix}_ARR_ROOT`] = "/ar";
		assert.equal(
			(await getWatchEvidence(series(), scopes(type))).viewers[0].status,
			"unknown",
			"mapping must respect component boundary",
		);
	});
}

test("path mapping preserves literal case and components across explicit POSIX and drive-letter roots", async () => {
	const { serverFilePath } = await import("../dist/library/media.js");
	const server = {
		pathMappings: [{ arrRoot: "D:\\media", serverRoot: "/server" }],
	};
	assert.equal(
		serverFilePath(server, "D:\\media\\Show\\s1.mkv"),
		"/server/Show/s1.mkv",
	);
	assert.equal(
		serverFilePath(server, "d:\\media\\Show\\s1.mkv"),
		"d:\\media\\Show\\s1.mkv",
	);
	assert.equal(
		serverFilePath(server, "D:\\media-other\\s1.mkv"),
		"D:\\media-other\\s1.mkv",
	);
	assert.equal(serverFilePath(server, "D:\\media\\..\\s1.mkv"), undefined);
	assert.equal(
		serverFilePath(
			{ pathMappings: [{ arrRoot: "/", serverRoot: "/server" }] },
			"/Show/s1.mkv",
		),
		"/server/Show/s1.mkv",
	);
});

test("path mapping config rejects incomplete, overlapping, noncanonical and alias-conflicting roots", async () => {
	const { serverConfigs } = await import("../dist/library/media.js");
	const rejects = (regex) =>
		assert.throws(serverConfigs, (error) => regex.test(error.message));
	const prefix = "JELLYFIN_TEST_PATH_MEDIA";
	process.env[`${prefix}_ARR_ROOT`] = "/arr";
	rejects(/path mapping/i);
	process.env[`${prefix}_SERVER_ROOT`] = "/server";
	assert.equal(
		serverConfigs().find((s) => s.name === "jellyfin-test").pathMappings.length,
		1,
	);
	for (const invalid of [
		"relative",
		"/arr/../arr",
		"/arr//files",
		"/arr/",
		" /arr",
		"/arr\n",
	]) {
		process.env[`${prefix}_ARR_ROOT`] = invalid;
		rejects(/path mapping/i);
	}
	process.env[`${prefix}_ARR_ROOT`] = "/arr";
	process.env.JELLYFIN_TEST_PATH_SECOND_ARR_ROOT = "/arr/nested";
	process.env.JELLYFIN_TEST_PATH_SECOND_SERVER_ROOT = "/other";
	rejects(/ambiguous.*path|path.*ambiguous/i);
	process.env.JELLYFIN_TEST_PATH_SECOND_ARR_ROOT = "/other";
	process.env.JELLYFIN_TEST_PATH_SECOND_SERVER_ROOT = "/server/nested";
	rejects(/ambiguous.*path|path.*ambiguous/i);
	Reflect.deleteProperty(process.env, "JELLYFIN_TEST_PATH_SECOND_ARR_ROOT");
	Reflect.deleteProperty(process.env, "JELLYFIN_TEST_PATH_SECOND_SERVER_ROOT");
	process.env.FLIX_BRIDGE_JELLYFIN_TEST_URL = "http://watch.invalid";
	process.env.FLIX_BRIDGE_JELLYFIN_TEST_API_KEY = "admin-test";
	rejects(/Conflicting.*aliases/i);
});

test("watched Jellyfin leaves with missing timestamps never inherit root or sibling chronology", async () => {
	Reflect.deleteProperty(leaves[1].UserData, "LastPlayedDate");
	const result = await getWatchEvidence(series(), scopes("jellyfin"));
	assert.equal(result.viewers[0].status, "watched");
	assert.equal(result.viewers[0].lastWatchedAt, undefined);
	const scoped = await getWatchEvidence(series(), scopes("jellyfin"), 1);
	const candidate = await evaluate(series(), "jellyfin", result);
	assert.equal(candidate.eligible, false);
	assert.ok(candidate.blockers.some((b) => /Last watch unknown/i.test(b)));
	assert.equal(scoped.viewers[0].lastWatchedAt, "2020-01-01T00:00:00Z");
});
test("watched Plex leaves with missing timestamps never inherit root or sibling chronology", async () => {
	usePlex();
	Reflect.deleteProperty(leaves[1], "lastViewedAt");
	const result = await getWatchEvidence(series(), scopes("plex"));
	assert.equal(result.viewers[0].status, "watched");
	assert.equal(result.viewers[0].lastWatchedAt, undefined);
	assert.equal(
		(await getWatchEvidence(series(), scopes("plex"), 1)).viewers[0]
			.lastWatchedAt,
		"2020-01-01T00:00:00.000Z",
	);
	assert.equal((await evaluate(series(), "plex", result)).eligible, false);
});

function evaluate(item, type, watchEvidence, seasonNumber) {
	const evaluationTime = "2026-10-20T00:00:00Z";
	return import("../dist/retention/evaluator.js").then(
		({ evaluateCandidate }) =>
			evaluateCandidate({
				snapshot: {
					items: [item],
					complete: true,
					errors: [],
					observedAt: evaluationTime,
				},
				item,
				watchEvidence,
				evaluationTime,
				seasonNumber,
				rule: {
					services: [item.service],
					users: scopes(type),
					target: seasonNumber === undefined ? "show" : "completed-season",
					action: "unmonitor-delete-files",
					minSizeBytes: 1,
					minAddedAgeDays: 1,
					watchGraceDays: 30,
					minInactiveDays: 30,
					protectedTags: [],
					maxCount: 1,
					maxBytes: 100,
					allowUnsupportedFavourites: true,
				},
			}),
	);
}
for (const type of ["jellyfin", "plex"]) {
	test(`${type} restricted credentials cannot prove global session absence even with known watch data`, async () => {
		if (type === "plex") usePlex();
		elevationStatus = 403;
		const result = await getWatchEvidence(series(), scopes(type), 1);
		assert.equal(result.activePlayback, null);
		assert.equal(result.complete, false);
		assert.equal(result.viewers[0].status, "watched");
		assert.ok(result.blockers.some((b) => /403/.test(b)));
		assert.equal(
			requests.some(({ url }) =>
				["/Sessions", "/status/sessions"].includes(url.pathname),
			),
			false,
		);
	});
	test(`${type} movie copy proof rejects missing paths, merged editions and a watched different file`, async () => {
		const item = {
			...series(),
			mediaKind: "movie",
			providerIds: { tmdb: "456" },
			episodes: [],
			seasons: [],
			files: [series().files[0]],
			sizeBytes: 10,
		};
		root =
			type === "jellyfin"
				? {
						Id: "movie",
						Name: "Movie",
						Type: "Movie",
						ProviderIds: { Tmdb: "456" },
						MediaSources: [{ Path: item.files[0].path }],
						UserData: state(),
					}
				: {
						ratingKey: "movie",
						title: "Movie",
						type: "movie",
						Guid: [{ id: "tmdb://456" }],
						Media: [{ Part: [{ file: item.files[0].path }] }],
						viewCount: 1,
						lastViewedAt: 1577836800,
					};
		const happy = await getWatchEvidence(item, scopes(type));
		assert.equal(happy.complete, true);
		assert.equal(happy.viewers[0].copies[0].arrFileId, 1);
		const original = structuredClone(root);
		for (const mode of ["missing", "merged", "wrong", "relative"]) {
			root = structuredClone(original);
			if (type === "jellyfin") {
				if (mode === "missing") Reflect.deleteProperty(root, "MediaSources");
				else if (mode === "merged")
					root.MediaSources.push({ Path: "/arr/Show/edition.mkv" });
				else
					root.MediaSources[0].Path =
						mode === "wrong" ? "/arr/Show/edition.mkv" : "Show/s1.mkv";
			} else {
				if (mode === "missing") Reflect.deleteProperty(root, "Media");
				else if (mode === "merged")
					root.Media.push({ Part: [{ file: "/arr/Show/edition.mkv" }] });
				else
					root.Media[0].Part[0].file =
						mode === "wrong" ? "/arr/Show/edition.mkv" : "Show/s1.mkv";
			}
			const result = await getWatchEvidence(item, scopes(type));
			assert.equal(result.complete, false, mode);
			assert.equal(result.viewers[0].status, "unknown", mode);
			assert.equal(result.viewers[0].lastWatchedAt, undefined, mode);
			assert.deepEqual(result.viewers[0].copies, [], mode);
		}
	});
	test(`${type} any unresolved active file blocks absence; a proven unrelated file does not`, async () => {
		if (type === "plex") usePlex();
		sessions =
			type === "jellyfin"
				? [{ NowPlayingItem: { Id: "hidden" } }]
				: [{ ratingKey: "hidden", title: "Unavailable", type: "movie" }];
		const unknown = await getWatchEvidence(series(), scopes(type), 1);
		assert.equal(unknown.activePlayback, null);
		assert.equal(unknown.complete, false);
		assert.equal(unknown.viewers[0].status, "watched");
		assert.equal((await evaluate(series(), type, unknown, 1)).eligible, false);
		sessions =
			type === "jellyfin"
				? [
						{
							NowPlayingItem: {
								Id: "hidden",
								MediaSources: [{ Path: "/arr/Unrelated/file.mkv" }],
							},
						},
					]
				: [
						{
							ratingKey: "hidden",
							title: "Other",
							type: "movie",
							Media: [{ Part: [{ file: "/arr/Unrelated/file.mkv" }] }],
						},
					];
		const unrelated = await getWatchEvidence(series(), scopes(type), 1);
		assert.equal(unrelated.activePlayback, false);
		assert.equal((await evaluate(series(), type, unrelated, 1)).eligible, true);
	});
}

test("Jellyfin missing or ambiguous scoped season favourite records remain unknown, never false", async () => {
	const original = structuredClone(seasons);
	for (const mode of [
		"absent",
		"duplicate",
		"flag-missing",
		"wrong-user",
		"wrong-series",
	]) {
		seasons = structuredClone(original);
		if (mode === "absent") seasons.pop();
		else if (mode === "duplicate")
			seasons.push({ ...seasons[1], Id: "duplicate" });
		else if (mode === "flag-missing")
			Reflect.deleteProperty(seasons[1].UserData, "IsFavorite");
		else if (mode === "wrong-user") seasons[1].UserData.UserId = "other";
		else seasons[1].SeriesId = "wrong";
		const result = await getWatchEvidence(series(), scopes("jellyfin"), 2);
		assert.equal(result.favourite, null, mode);
		assert.equal(result.complete, false, mode);
		assert.equal(result.viewers[0].status, "watched", mode);
		assert.ok(
			result.blockers.some((b) => /favourite/i.test(b)),
			mode,
		);
	}
});

test("Jellyfin season favourite protects selected season and whole series, not sibling season", async () => {
	seasons[1].UserData.IsFavorite = true;
	assert.equal(
		(await getWatchEvidence(series(), scopes("jellyfin"), 2)).favourite,
		true,
	);
	assert.equal(
		(await getWatchEvidence(series(), scopes("jellyfin"))).favourite,
		true,
	);
	assert.equal(
		(await getWatchEvidence(series(), scopes("jellyfin"), 1)).favourite,
		false,
	);
	assert.ok(
		requests.some(
			({ url }) =>
				url.searchParams.get("IncludeItemTypes") === "Season" &&
				url.searchParams.get("ParentId") === "root",
		),
	);
});
