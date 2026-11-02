import assert from "node:assert/strict";
import { test } from "node:test";
import { ArrMcpServer } from "../dist/index.js";
import { requestSignal } from "../dist/request-context.js";
import { serviceRegistry } from "../dist/services/registry.js";

function series(id, title = `Series ${id}`, monitored = true) {
	return {
		id,
		title,
		monitored,
		path: `/library/${id}`,
		status: "ended",
		tvdbId: id + 1000,
		tags: [1],
		seasons: [{ seasonNumber: 1, monitored: true }],
		statistics: { totalEpisodeCount: 1, episodeFileCount: 1 },
		ratings: { value: 8, votes: 10 },
	};
}

function fixture(t, libraries) {
	const env = { ...process.env };
	const fetch = globalThis.fetch;
	for (const key of Object.keys(process.env))
		if (/SONARR|RADARR|SABNZBD|PLEX|JELLYFIN|FLIX_BRIDGE/.test(key))
			delete process.env[key];
	const configs = {};
	for (const name of Object.keys(libraries)) {
		const prefix = name.toUpperCase().replaceAll("-", "_");
		process.env[`${prefix}_URL`] = `http://fixture.invalid/${name}`;
		process.env[`${prefix}_API_KEY`] = "synthetic-key";
		configs[name] = {
			baseUrl: `http://fixture.invalid/${name}`,
			apiKey: "synthetic-key",
		};
	}
	const calls = [];
	const state = { override: () => undefined };
	globalThis.fetch = async (input, options) => {
		const url = new URL(input);
		assert.equal(url.origin, "http://fixture.invalid");
		assert.equal(options.method, "GET");
		const [, service, api, version, ...parts] = url.pathname.split("/");
		assert.equal(api, "api");
		assert.equal(version, "v3");
		const path = parts.join("/");
		calls.push({ service, path, params: url.searchParams });
		const overridden = state.override({ service, path, url, options });
		if (overridden !== undefined) return overridden;
		const rows = libraries[service];
		const kind = service.includes("sonarr") ? "series" : "movie";
		if (path === kind) return Response.json(rows);
		if (path === "tag") return Response.json([{ id: 1, label: "keep" }]);
		if (parts[0] === kind && parts.length === 2) {
			const row = rows.find((row) => row.id === Number(parts[1]));
			return Response.json(row);
		}
		const itemId = Number(url.searchParams.get(`${kind}Id`));
		if (path === "episodefile" || path === "moviefile")
			return Response.json([
				{
					id: itemId + 100,
					[`${kind}Id`]: itemId,
					path: `/library/${itemId}/file.mkv`,
					size: 1234,
				},
			]);
		if (path === "episode")
			return Response.json([
				{
					id: itemId + 200,
					seriesId: itemId,
					seasonNumber: 1,
					episodeNumber: 1,
					title: "Pilot",
					episodeFileId: itemId + 100,
					hasFile: true,
					monitored: true,
				},
			]);
		throw new Error(`Unexpected fixture request: ${url}`);
	};
	serviceRegistry.clear();
	const app = new ArrMcpServer();
	app.initialize({ services: configs });
	t.after(() => {
		serviceRegistry.clear();
		globalThis.fetch = fetch;
		process.env = env;
	});
	return {
		calls,
		state,
		app,
		list: (args = {}) => app.callTool("library_list", args),
	};
}

const detailCalls = (calls) =>
	calls.filter(({ path }) => /^(series|movie)\//.test(path));

test("1500-title Sonarr first page hydrates only its one full DTO", async (t) => {
	const f = fixture(t, {
		"sonarr-a": Array.from({ length: 1500 }, (_, index) => series(index + 1)),
	});
	const result = await f.list({ services: ["sonarr-a"], page: 1, pageSize: 1 });
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(
		f.calls.length,
		5,
		"one index, one tags read, one title/files/episodes hydration",
	);
	assert.deepEqual(
		detailCalls(f.calls).map(({ path }) => path),
		["series/1"],
	);
	assert.equal(result.data.total, 1500);
	assert.equal(result.data.hasMore, true);
	assert.equal(
		result.data.complete,
		false,
		"unhydrated titles cannot prove global detail completeness",
	);
	assert.equal(result.data.pageComplete, true);
	assert.equal(result.data.coverage.scope, "page");
	assert.equal(result.data.coverage.indexComplete, true);
	const item = result.data.items[0];
	assert.equal(item.complete, true);
	assert.deepEqual(item.providerIds, { tvdb: "1001" });
	assert.deepEqual(item.tags, ["keep"]);
	assert.deepEqual(item.ratings, [
		{ source: "tvdb", value: 8, scale: 10, votes: 10 },
	]);
	assert.equal(item.sizeBytes, 1234);
	assert.deepEqual(item.files[0].episodeIds, [201]);
	assert.equal(item.episodes[0].fileId, 101);
	assert.deepEqual(item.seasons, [{ seasonNumber: 1, monitored: true }]);
});

test("filters precede one global page across ordered ARR instances", async (t) => {
	const movie = {
		...series(9, "Match movie"),
		hasFile: true,
		movieFile: { id: 109 },
	};
	const f = fixture(t, {
		"sonarr-a": [
			series(1, "Skip"),
			series(2, "MATCH first"),
			series(3, "Match unmonitored", false),
		],
		"sonarr-b": [series(4, "Match second"), series(5, "Match third")],
		"radarr-c": [movie],
	});
	const result = await f.list({
		services: ["sonarr-b", "radarr-c", "sonarr-a"],
		query: "mAtCh",
		mediaKind: "series",
		monitored: true,
		page: 2,
		pageSize: 2,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.data.total, 3);
	assert.equal(result.data.hasMore, false);
	assert.deepEqual(
		result.data.items.map(({ service, id }) => [service, id]),
		[["sonarr-a", 2]],
	);
	assert.deepEqual(
		detailCalls(f.calls).map(({ service, path }) => [service, path]),
		[["sonarr-a", "series/2"]],
	);
	assert.deepEqual(
		f.calls.filter(({ path }) => path === "tag").map(({ service }) => service),
		["sonarr-a"],
	);
	assert.equal(result.data.pageComplete, true);
	assert.equal(result.data.complete, false);
});

test("tags are fetched once per hydrated service and all-candidate coverage can be complete", async (t) => {
	const f = fixture(t, { "sonarr-a": [series(1), series(2)] });
	const result = await f.list({ pageSize: 2 });
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.calls.filter(({ path }) => path === "tag").length, 1);
	assert.equal(result.data.items.length, 2);
	assert.equal(result.data.complete, true);
	assert.equal(result.data.pageComplete, true);
});

test("failed selected detail preserves index totals and does not hydrate a replacement", async (t) => {
	const f = fixture(t, { "sonarr-a": [series(1), series(2), series(3)] });
	f.state.override = ({ path }) =>
		path === "series/1" ? new Response(null, { status: 503 }) : undefined;
	const result = await f.list({ pageSize: 2 });
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.data.total, 3);
	assert.equal(result.data.hasMore, true);
	assert.deepEqual(
		result.data.items.map(({ id }) => id),
		[2],
	);
	assert.deepEqual(
		detailCalls(f.calls).map(({ path }) => path),
		["series/1", "series/2"],
	);
	assert.equal(result.data.complete, false);
	assert.equal(result.data.pageComplete, false);
	assert.equal(result.data.coverage.indexComplete, true);
	assert.equal(result.data.errors.length, 1);
});

test("failed index retains other services' results without claiming complete totals", async (t) => {
	const f = fixture(t, { "sonarr-a": [series(1)], "sonarr-b": [series(2)] });
	f.state.override = ({ service, path }) =>
		service === "sonarr-a" && path === "series"
			? new Response(null, { status: 503 })
			: undefined;
	const result = await f.list();
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.deepEqual(
		result.data.items.map(({ service, id }) => [service, id]),
		[["sonarr-b", 2]],
	);
	assert.equal(
		result.data.total,
		1,
		"observed filtered count only, not the failed service's unknown count",
	);
	assert.equal(result.data.coverage.indexComplete, false);
	assert.equal(result.data.complete, false);
	assert.equal(
		result.data.pageComplete,
		false,
		"global page boundaries are unknown after an index failure",
	);
	assert.equal(result.data.errors.length, 1);
});

test("empty filtered page needs no tag/detail reads and reports exact index coverage", async (t) => {
	const f = fixture(t, { "sonarr-a": [series(1)] });
	const result = await f.list({ query: "not present" });
	assert.deepEqual(result.data.items, []);
	assert.equal(result.data.total, 0);
	assert.equal(result.data.hasMore, false);
	assert.equal(result.data.complete, true);
	assert.equal(result.data.pageComplete, true);
	assert.equal(f.calls.length, 1);
});

test("incomplete selected DTO is not a healthy page", async (t) => {
	const row = series(1);
	delete row.tvdbId;
	const f = fixture(t, { "sonarr-a": [row] });
	const result = await f.list();
	assert.equal(result.data.items[0].complete, false);
	assert.equal(result.data.complete, false);
	assert.equal(result.data.pageComplete, false);
});

for (const invalid of [
	[{ id: 1, title: "Bad", monitored: "yes" }],
	[{ id: 1, title: "Bad" }],
	[{ id: 1, title: "", monitored: true }],
	[{ id: 0, title: "Bad", monitored: true }],
	[series(1), series(1)],
	{ records: [], totalRecords: 1, page: 1 },
])
	test(`invalid/incomplete index is explicit, never empty healthy: ${JSON.stringify(invalid).slice(0, 90)}`, async (t) => {
		const f = fixture(t, { "sonarr-a": [series(1)] });
		f.state.override = ({ path }) =>
			path === "series" ? Response.json(invalid) : undefined;
		const result = await f.list();
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(result.data.complete, false);
		assert.equal(result.data.pageComplete, false);
		assert.equal(result.data.coverage.indexComplete, false);
		assert.ok(result.data.errors.length > 0);
		assert.equal(detailCalls(f.calls).length, 0);
	});

test("flat title index count ceiling fails explicitly without detail requests", async (t) => {
	const rows = Array.from({ length: 25001 }, (_, index) => ({
		id: index + 1,
		title: "Index",
		monitored: true,
	}));
	const f = fixture(t, { "sonarr-a": rows });
	const result = await f.list({ pageSize: 1 });
	assert.equal(result.data.pageComplete, false);
	assert.equal(result.data.coverage.indexComplete, false);
	assert.ok(result.data.errors.length > 0);
	assert.equal(detailCalls(f.calls).length, 0);
});

test("index HTTP byte ceiling fails explicitly rather than truncating", async (t) => {
	const f = fixture(t, { "sonarr-a": [series(1)] });
	f.state.override = ({ path }) =>
		path === "series"
			? Response.json([
					{ id: 1, title: "x".repeat(8 * 1024 * 1024), monitored: true },
				])
			: undefined;
	const result = await f.list({ pageSize: 1 });
	assert.equal(result.data.pageComplete, false);
	assert.equal(result.data.coverage.indexComplete, false);
	assert.ok(result.data.errors.length > 0);
	assert.equal(detailCalls(f.calls).length, 0);
});

for (const abortAt of ["before", "series", "series/1", "episodefile"])
	test(`cancellation at ${abortAt} stops all later provider/hydration requests`, async (t) => {
		const f = fixture(t, {
			"sonarr-a": [series(1), series(2)],
			"sonarr-b": [series(3)],
		});
		const controller = new AbortController();
		let countAtAbort = 0;
		if (abortAt === "before")
			controller.abort(new Error("fixture cancellation"));
		f.state.override = ({ service, path }) => {
			if (service === "sonarr-a" && path === abortAt) {
				countAtAbort = f.calls.length;
				controller.abort(new Error("fixture cancellation"));
			}
			return undefined;
		};
		const result = await requestSignal.run(controller.signal, () =>
			f.list({ pageSize: 3 }),
		);
		assert.equal(
			result.ok,
			false,
			"cancellation must not be collected into a successful aggregate",
		);
		assert.equal(
			f.calls.length,
			countAtAbort,
			"no requests after cancellation, including other services",
		);
	});

for (const changed of [{ title: "Different title" }, { monitored: false }])
	test(`selector drift during hydration is explicit: ${JSON.stringify(changed)}`, async (t) => {
		const row = series(1, "Selected title");
		const f = fixture(t, { "sonarr-a": [row] });
		f.state.override = ({ path }) =>
			path === "series/1" ? Response.json({ ...row, ...changed }) : undefined;
		const result = await f.list({ query: "Selected", monitored: true });
		assert.deepEqual(result.data.items, []);
		assert.equal(result.data.total, 1);
		assert.equal(result.data.complete, false);
		assert.equal(result.data.pageComplete, false);
		assert.match(result.data.errors[0].message, /changed during browsing/i);
	});

test("full safety snapshots still hydrate every title independently of browse pagination", async (t) => {
	const f = fixture(t, { "sonarr-a": [series(1), series(2), series(3)] });
	const { loadLibrarySnapshot } = await import("../dist/library/arr.js");
	const snapshot = await loadLibrarySnapshot(["sonarr-a"]);
	assert.equal(snapshot.complete, true);
	assert.equal(snapshot.items.length, 3);
	assert.equal(detailCalls(f.calls).length, 3);
});
