import assert from "node:assert/strict";
import { test } from "node:test";
import { PlexReportsClient } from "../dist/services/plex/reports.js";

const client = () =>
	new PlexReportsClient({ baseUrl: "https://plex.invalid", token: "fixture" });
const report = (id = "report-1", commentCount = 0) => ({
	id,
	message: "Provider text is data",
	url: "server://fixture/library/metadata/1",
	date: "2026-01-01T00:00:00Z",
	commentCount,
});
const feed = (nodes, hasNextPage = false, endCursor = null) => ({
	data: { reports: { nodes, pageInfo: { hasNextPage, endCursor } } },
});
const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { status });
async function mockFetch(respond, run) {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = respond;
		return await run();
	} finally {
		globalThis.fetch = original;
	}
}

test("Plex distinguishes a complete first page from a terminal continuation", async () => {
	await mockFetch(
		async () => json(feed([])),
		async () => {
			assert.deepEqual((await client().listReportsPage()).data, {
				reports: [],
				hasMore: false,
				nextCursor: null,
				complete: true,
			});
			assert.equal(
				(await client().listReportsPage({ after: "opaque" })).data.complete,
				false,
			);
		},
	);
});

test("Plex accepts a terminal page without an unused end cursor", async () => {
	await mockFetch(
		async (_url, init) =>
			json(
				JSON.parse(init.body).query.includes("getReportedIssues")
					? {
							data: {
								reports: {
									nodes: [report()],
									pageInfo: { hasNextPage: false },
								},
							},
						}
					: { data: { reportComments: { nodes: [] } } },
			),
		async () => {
			assert.equal((await client().listReportsPage()).data.complete, true);
		},
	);
});

test("Plex bounds the default and maximum report pages", async () => {
	for (const [limit, size, ok] of [
		[undefined, 26, false],
		[100, 100, true],
		[100, 101, false],
	]) {
		let calls = 0;
		await mockFetch(
			async (_url, init) => {
				calls++;
				return json(
					JSON.parse(init.body).query.includes("getReportedIssues")
						? feed(Array.from({ length: size }, (_, i) => report(`r${i}`)))
						: { data: { reportComments: { nodes: [] } } },
				);
			},
			async () => {
				const result = await client().listReportsPage({ limit });
				assert.equal(result.ok, ok);
				assert.equal(calls, ok ? 101 : 1);
				if (ok) assert.equal(result.data.complete, true);
			},
		);
	}
});

test("Plex normalizes HTTP, auth, network, JSON, schema and partial GraphQL failures", async () => {
	const marker = "provider-private-instruction";
	const failures = [
		() => new Response(marker, { status: 401 }),
		() => new Response(marker, { status: 403 }),
		() => new Response(marker, { status: 500 }),
		() => {
			throw new Error(marker);
		},
		() => new Response(marker),
		() => new Response(null, { status: 204 }),
		() => json({ errors: [{ message: marker }] }),
		() => json({ ...feed([]), errors: [{ message: marker }] }),
		() => json({ data: { reports: { nodes: marker } } }),
	];
	for (const fail of failures) {
		for (const commentsFail of [false, true]) {
			await mockFetch(
				async (_url, init) => {
					if (
						commentsFail &&
						JSON.parse(init.body).query.includes("getReportedIssues")
					)
						return json(feed([report()]));
					return fail();
				},
				async () => {
					const result = await client().listReportsPage();
					assert.equal(result.ok, false);
					assert.equal(result.data, undefined);
					assert.ok(result.error.message);
					assert.equal(JSON.stringify(result).includes(marker), false);
					const status =
						fail === failures[0]
							? 401
							: fail === failures[1]
								? 403
								: fail === failures[2]
									? 500
									: undefined;
					if (status) assert.equal(result.error.status, status);
				},
			);
		}
	}
});

test("Plex page forwards opaque cursors and preserves the array wrapper", async () => {
	const calls = [];
	await mockFetch(
		async (url, init) => {
			assert.equal(url, "https://community.plex.tv/api");
			assert.equal(init.method, "POST");
			assert.equal(new Headers(init.headers).get("X-Plex-Token"), "fixture");
			const body = JSON.parse(init.body);
			calls.push(body);
			return json(
				body.query.includes("getReportedIssues")
					? feed([report()], true, "opaque-next==")
					: { data: { reportComments: { nodes: [] } } },
			);
		},
		async () => {
			const c = client();
			const result = await c.listReportsPage({
				limit: 2,
				after: "opaque-prev==",
			});
			assert.equal(result.ok, true);
			assert.equal(result.data.reports[0].id, "report-1");
			assert.equal(result.data.hasMore, true);
			assert.equal(result.data.nextCursor, "opaque-next==");
			assert.equal(result.data.complete, false);
			assert.deepEqual(calls[0].variables, {
				first: 2,
				after: "opaque-prev==",
			});
			assert.deepEqual(calls[1].variables, { id: "report-1", first: 20 });
			const legacy = await c.listReports();
			assert.equal(legacy.ok, true);
			assert.ok(Array.isArray(legacy.data));
			assert.deepEqual(calls[2].variables, { first: 25, after: null });
		},
	);
});

test("Plex rejects malformed report pages before fetching any comments", async () => {
	for (const payload of [
		feed([report()], true),
		feed([report()], true, ""),
		feed([report()], true, "bad cursor"),
		feed([report()], true, "same-cursor"),
		feed([], true, "next"),
		feed([report(), report()]),
		feed([report("one"), report("two"), report("three")]),
		feed([{ ...report(), id: "" }]),
		feed([{ ...report(), id: " " }]),
		feed([{ ...report(), id: "bad\u0000id" }]),
		feed([report()], false, "same-cursor"),
		feed([{ ...report(), commentCount: -1 }]),
		feed([{ ...report(), commentCount: 1.5 }]),
		feed([{ ...report(), message: null }]),
		feed([report()], false, 42),
		{ data: { reports: { nodes: [] } } },
		{ data: { reports: null } },
	]) {
		let calls = 0;
		await mockFetch(
			async () => {
				calls++;
				return json(payload);
			},
			async () => {
				const result = await client().listReportsPage({
					limit: 2,
					after: "same-cursor",
				});
				assert.equal(result.ok, false, JSON.stringify(payload));
				assert.equal(result.data, undefined);
				assert.equal(calls, 1, "invalid report page must not fan out comments");
			},
		);
	}
});

test("Plex exposes truthful bounded comment coverage, including unknown totals", async () => {
	for (const [total, returned, complete] of [
		[0, 0, true],
		[2, 2, true],
		[20, 20, true],
		[21, 20, false],
		[2, 1, false],
		[2, 0, false],
		[undefined, 0, false],
		[undefined, 20, false],
	]) {
		const node = report();
		node.commentCount = total;
		await mockFetch(
			async (_url, init) =>
				json(
					JSON.parse(init.body).query.includes("getReportedIssues")
						? feed([node])
						: {
								data: {
									reportComments: {
										nodes: Array.from({ length: returned }, (_, i) => ({
											id: `c${i}`,
										})),
									},
								},
							},
				),
			async () => {
				const result = await client().listReportsPage();
				assert.equal(result.ok, true);
				const r = result.data.reports[0];
				assert.deepEqual(r.commentCoverage, {
					limit: 20,
					returned,
					total: total ?? null,
					complete,
				});
				assert.equal(r.commentsComplete, complete);
				assert.equal(result.data.complete, complete);
				assert.equal(
					result.data.hasMore,
					false,
					"report paging is distinct from comment coverage",
				);
				assert.equal(
					r.commentCount,
					total ?? returned,
					"legacy fallback retained, not used as completeness proof",
				);
			},
		);
	}
});

test("Plex fails the whole page on malformed or contradictory comment results", async () => {
	for (const nodes of [
		[{ id: "" }],
		[{ id: " " }],
		[{ id: "bad\u0000id" }],
		[{ id: "duplicate" }, { id: "duplicate" }],
		Array.from({ length: 21 }, (_, i) => ({ id: `c${i}` })),
		[{ id: "c1", message: 42 }],
		[{ id: "c1" }, { id: "c2" }, { id: "c3" }],
		null,
	]) {
		await mockFetch(
			async (_url, init) =>
				json(
					JSON.parse(init.body).query.includes("getReportedIssues")
						? feed([report("report-1", 2)])
						: { data: { reportComments: { nodes } } },
				),
			async () => {
				const result = await client().listReportsPage();
				assert.equal(result.ok, false, JSON.stringify(nodes));
				assert.equal(result.data, undefined);
			},
		);
	}
});

test("Plex rejects invalid pagination inputs before HTTP", async () => {
	let calls = 0;
	await mockFetch(
		async () => {
			calls++;
			return json(feed([]));
		},
		async () => {
			for (const options of [
				{ limit: 0 },
				{ limit: -1 },
				{ limit: 101 },
				{ limit: 1.5 },
				{ limit: Number.NaN },
				{ limit: "2" },
				{ after: "" },
				{ after: " padded" },
				{ after: "line\nfeed" },
				{ after: "opaque\u0000token" },
				{ after: "opaque\u007ftoken" },
				{ after: "x".repeat(2049) },
				{ after: 12 },
				{ after: null },
			]) {
				assert.equal((await client().listReportsPage(options)).ok, false);
			}
			assert.equal(calls, 0);
		},
	);
});
