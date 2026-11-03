import assert from "node:assert/strict";
import { test } from "node:test";
import { ArrMcpServer } from "../dist/index.js";
import { PlexReportsClient } from "../dist/services/plex/reports.js";
import { serviceRegistry } from "../dist/services/registry.js";

const cursors = [
	"opaque-A==",
	"opaque-B/+",
	"opaque-C_%",
	"opaque-D==",
	"opaque-E==",
];
const node = (i) => ({
	id: `r${i + 1}`,
	message: "Fixture",
	url: `server://fixture/library/metadata/${i + 1}`,
	date: "2026-01-01T00:00:00Z",
	commentCount: 0,
});
function fixture(t, size = 5) {
	const fetch = globalThis.fetch,
		env = { ...process.env },
		calls = [],
		state = { change: (value) => value, failure: undefined };
	process.env = Object.fromEntries(
		Object.entries(env).filter(
			([key]) =>
				!/^(?:FLIX_BRIDGE_|SONARR_|RADARR_|SABNZBD_|PLEX_|JELLYFIN_)/.test(key),
		),
	);
	Object.assign(process.env, {
		PLEX_BASE_URL: "https://plex.invalid",
		PLEX_TOKEN: "synthetic-provider",
	});
	const rows = Array.from({ length: size }, (_, i) => node(i));
	globalThis.fetch = async (input, options) => {
		const url = String(input),
			headers = new Headers(options.headers),
			body = options.body ? JSON.parse(options.body) : undefined;
		calls.push({ url, method: options.method, headers, body });
		if (url === "https://community.plex.tv/api") {
			if (body.query.includes("query reportComments"))
				return Response.json({ data: { reportComments: { nodes: [] } } });
			if (state.failure) return state.failure();
			if (body.variables.first === 1)
				return Response.json({
					errors: [
						{
							message:
								"Synthetic reproduction of the observed first-one rejection",
						},
					],
				});
			const offset =
				body.variables.after === null
					? 0
					: cursors.indexOf(body.variables.after) + 1;
			const selected = rows.slice(offset, offset + body.variables.first);
			const pageInfo = {
				hasNextPage: offset + selected.length < rows.length,
				startCursor: selected.length ? cursors[offset] : null,
				endCursor: selected.length
					? cursors[offset + selected.length - 1]
					: null,
			};
			return Response.json({
				data: { reports: state.change({ nodes: selected, pageInfo }) },
			});
		}
		return Response.json({
			MediaContainer: { Metadata: [{ type: "movie", title: "Fixture" }] },
		});
	};
	t.after(() => {
		globalThis.fetch = fetch;
		process.env = env;
		serviceRegistry.clear();
	});
	return {
		calls,
		state,
		page: (options) =>
			new PlexReportsClient({
				baseUrl: "https://plex.invalid",
				token: "synthetic-provider",
			}).listReportsPage(options),
	};
}
const feeds = (calls) =>
	calls.filter((call) => call.body?.query.includes("query getReportedIssues"));
const comments = (calls) =>
	calls.filter((call) => call.body?.query.includes("query reportComments"));

test("limit-one traversal returns all reports once, using first-node native cursors across fresh clients", async (t) => {
	const f = fixture(t),
		ids = [],
		seen = new Set();
	let after;
	for (let i = 0; i < 8; i++) {
		const result = await f.page({ limit: 1, ...(after ? { after } : {}) });
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(result.data.reports.length, 1);
		ids.push(result.data.reports[0].id);
		assert.equal(
			result.data.complete,
			false,
			"a continuation/partial first page is not whole-feed coverage",
		);
		if (!result.data.hasMore) {
			assert.equal(result.data.nextCursor, null);
			break;
		}
		assert.equal(seen.has(result.data.nextCursor), false);
		seen.add(result.data.nextCursor);
		after = result.data.nextCursor;
	}
	assert.deepEqual(ids, ["r1", "r2", "r3", "r4", "r5"]);
	assert.deepEqual(
		feeds(f.calls).map((call) => call.body.variables),
		cursors.map((_, i) => ({ first: 2, after: i ? cursors[i - 1] : null })),
	);
	assert.ok(
		feeds(f.calls).every((call) => /startCursor/.test(call.body.query)),
	);
	assert.deepEqual(
		comments(f.calls).map((call) => call.body.variables.id),
		ids,
		"no comments for unreturned lookahead nodes",
	);
});

test("a terminal two-node provider page still has more for the one-item MCP page", async (t) => {
	const f = fixture(t, 2),
		result = await f.page({ limit: 1 });
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.data.reports[0].id, "r1");
	assert.equal(result.data.hasMore, true);
	assert.equal(result.data.nextCursor, cursors[0]);
	assert.equal(result.data.complete, false);
	assert.equal(comments(f.calls).length, 1);
});

test("mixed MCP page sizes retain opaque continuation without skipping the unreturned lookahead", async (t) => {
	const f = fixture(t),
		ids = [];
	let after;
	for (const limit of [1, 2, 1, 10]) {
		const result = await f.page({ limit, ...(after ? { after } : {}) });
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.ok(result.data.reports.length <= limit);
		ids.push(...result.data.reports.map(({ id }) => id));
		after = result.data.nextCursor ?? undefined;
	}
	assert.deepEqual(ids, ["r1", "r2", "r3", "r4", "r5"]);
	assert.deepEqual(
		feeds(f.calls).map(({ body }) => body.variables),
		[
			{ first: 2, after: null },
			{ first: 2, after: cursors[0] },
			{ first: 2, after: cursors[2] },
			{ first: 10, after: cursors[3] },
		],
	);
});

for (const size of [0, 1])
	test(`limit-one empty/single terminal feed is truthful: ${size}`, async (t) => {
		const f = fixture(t, size);
		f.state.change = (page) => ({ ...page, pageInfo: { hasNextPage: false } });
		const result = await f.page({ limit: 1 });
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(result.data.reports.length, size);
		assert.equal(result.data.hasMore, false);
		assert.equal(result.data.nextCursor, null);
		assert.equal(result.data.complete, true);
	});

for (const bad of [
	undefined,
	null,
	"",
	"bad cursor",
	42,
	"x".repeat(2049),
	cursors[1],
])
	test(`trimming refuses missing/invalid/ambiguous first boundary: ${typeof bad === "string" ? bad.slice(0, 20) : bad}`, async (t) => {
		const f = fixture(t, 2);
		f.state.change = (page) => ({
			...page,
			pageInfo: { ...page.pageInfo, startCursor: bad },
		});
		const result = await f.page({ limit: 1 });
		assert.equal(result.ok, false);
		assert.equal(result.data, undefined);
		assert.equal(feeds(f.calls).length, 1);
		assert.equal(comments(f.calls).length, 0);
	});

test("trimming refuses a repeated continuation boundary before comments", async (t) => {
	const f = fixture(t);
	f.state.change = (page) => ({
		...page,
		pageInfo: { ...page.pageInfo, startCursor: cursors[0] },
	});
	const result = await f.page({ limit: 1, after: cursors[0] });
	assert.equal(result.ok, false);
	assert.equal(comments(f.calls).length, 0);
});

test("trimming refuses missing end boundary or oversized provider pages", async (t) => {
	const f = fixture(t, 2);
	for (const change of [
		(page) => ({ ...page, pageInfo: { ...page.pageInfo, endCursor: null } }),
		(page) => ({ ...page, nodes: [...page.nodes, node(2)] }),
		(page) => ({ ...page, nodes: [node(0), node(0)] }),
		(page) => ({ ...page, nodes: [node(0), { ...node(1), commentCount: -1 }] }),
	]) {
		f.state.change = change;
		const result = await f.page({ limit: 1 });
		assert.equal(result.ok, false);
		assert.equal(comments(f.calls).length, 0);
	}
});

for (const status of [401, 403, 500, 200])
	test(`limit-one accommodation does not retry authentication/provider failures: ${status}`, async (t) => {
		const f = fixture(t);
		f.state.failure = () =>
			status === 200
				? Response.json({
						errors: [
							{
								message: "private-provider-details",
								extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
							},
						],
					})
				: new Response("private-provider-details", { status });
		const result = await f.page({ limit: 1 });
		assert.equal(result.ok, false);
		assert.equal(feeds(f.calls).length, 1);
		assert.equal(comments(f.calls).length, 0);
		assert.equal(
			JSON.stringify(result).includes("private-provider-details"),
			false,
		);
	});

test("larger/default limits retain their old request shape and cursor forwarding", async (t) => {
	const f = fixture(t, 0);
	for (const limit of [undefined, 2, 3, 100]) {
		const result = await f.page({ limit });
		assert.equal(result.ok, true);
	}
	assert.deepEqual(
		feeds(f.calls).map(({ body }) => body.variables.first),
		[25, 2, 3, 100],
	);
	assert.ok(
		feeds(f.calls).every(({ body }) => !body.query.includes("startCursor")),
	);
});

test("real dispatcher and MCP serializer keep the one-item contract and avoid lookahead metadata", async (t) => {
	const f = fixture(t, 2),
		app = new ArrMcpServer();
	app.initialize({ services: {} });
	const first = app.toolResult(
		await app.callTool("reported_issues", { limit: 1 }),
	);
	assert.equal(first.structuredContent.ok, true, JSON.stringify(first));
	assert.deepEqual(JSON.parse(first.content[0].text), first.structuredContent);
	assert.equal(first.structuredContent.data.total, 1);
	assert.equal(first.structuredContent.data.reports.length, 1);
	assert.equal(first.structuredContent.data.nextCursor, cursors[0]);
	assert.equal(first.structuredContent.data.hasMore, true);
	assert.deepEqual(
		f.calls.filter(({ method }) => method === "GET").map(({ url }) => url),
		["https://plex.invalid/library/metadata/1"],
	);
	const second = app.toolResult(
		await app.callTool("reported_issues", {
			limit: 1,
			after: first.structuredContent.data.nextCursor,
		}),
	);
	assert.equal(second.structuredContent.ok, true);
	assert.deepEqual(
		JSON.parse(second.content[0].text),
		second.structuredContent,
	);
	assert.equal(second.structuredContent.data.reports[0].id, "r2");
	assert.equal(second.structuredContent.data.hasMore, false);
	assert.equal(second.structuredContent.data.complete, false);
});
