import assert from "node:assert/strict";
import { test } from "node:test";
import { RadarrService } from "../dist/services/arr/radarr.js";
import { SonarrService } from "../dist/services/arr/sonarr.js";

const records = (count) =>
	Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		sourceTitle: `Release ${i + 1}`,
		date: "2026-01-02T00:00:00Z",
		eventType: "grabbed",
	}));
const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { status });
const config = { baseUrl: "https://arr.invalid/proxy", apiKey: "fixture" };
const service = (family = 3) =>
	new SonarrService("sonarr-test", {
		...config,
		...(family === 5 ? { apiVersion: 5 } : {}),
	});
async function withHistory(body, run) {
	const original = globalThis.fetch;
	const calls = [];
	try {
		globalThis.fetch = async (url, init) => {
			calls.push(new URL(url));
			assert.equal(init.method, "GET");
			assert.equal(new Headers(init.headers).get("X-Api-Key"), "fixture");
			if (new URL(url).pathname.endsWith("/api"))
				return json({ current: "v5", deprecated: ["v3"] });
			if (new URL(url).pathname.endsWith("/system/status"))
				return json({ appName: "Sonarr", version: "5.0.0" });
			return body instanceof Response ? body.clone() : json(body);
		};
		return await run(calls);
	} finally {
		globalThis.fetch = original;
	}
}

test("history truncation describes whole-result coverage for every ARR family", async () => {
	for (const family of [3, 5]) {
		for (const [body, options, total, truncated] of [
			[{ records: records(2), totalRecords: 3 }, {}, 3, true],
			[
				{ records: records(2), totalRecords: 2 },
				{ page: 2, pageSize: 2 },
				2,
				true,
			],
			[{ records: records(2) }, {}, 2, true],
			[{ records: [], totalRecords: 2 }, {}, 2, true],
			[{ records: [] }, {}, 0, true],
			[{ records: [], totalRecords: 0 }, {}, 0, false],
			[{ records: records(2), totalRecords: 2 }, {}, 2, false],
			[{ records: records(2), totalRecords: 0 }, {}, 0, true],
		]) {
			await withHistory(body, async (calls) => {
				const result = await service(family).historyDetail(options);
				assert.equal(result.ok, true);
				assert.equal(result.data.total, total);
				assert.equal(
					result.data.truncated,
					truncated,
					JSON.stringify({ family, body, options }),
				);
				const url = calls.at(-1);
				assert.equal(url.pathname, `/proxy/api/v${family}/history`);
				assert.equal(
					url.searchParams.has("pageSize"),
					options.pageSize !== undefined,
				);
				assert.equal(url.searchParams.has("page"), options.page !== undefined);
				assert.deepEqual(
					url.searchParams.getAll("includeSubresources"),
					family === 5 ? ["series", "episode"] : [],
				);
			});
		}
	}
});

test("history rejects malformed totals and ambiguous identities", async () => {
	for (const body of [
		{ records: records(1), totalRecords: -1 },
		{ records: records(1), totalRecords: 1.5 },
		{ records: [records(1)[0], records(1)[0]], totalRecords: 2 },
		{ records: [{ ...records(1)[0], id: 0 }], totalRecords: 1 },
	]) {
		await withHistory(body, async () => {
			const result = await service().historyDetail();
			assert.equal(result.ok, false, JSON.stringify(body));
			assert.equal(result.data, undefined);
		});
	}
});

test("history retains v3 since queries and v5 since-array local paging", async () => {
	const date = "2026-01-01T00:00:00Z";
	await withHistory(
		{ records: records(30), totalRecords: 40 },
		async (calls) => {
			const result = await service().historyDetail({
				since: date,
				page: 2,
				pageSize: 30,
			});
			assert.equal(result.data.items.length, 30);
			assert.equal(result.data.truncated, true);
			assert.equal(calls[0].pathname, "/proxy/api/v3/history");
			assert.equal(calls[0].searchParams.get("since"), date);
			assert.equal(calls[0].searchParams.get("page"), "2");
			assert.equal(calls[0].searchParams.get("pageSize"), "30");
		},
	);
	for (const [options, count, first, truncated] of [
		[{ since: date, page: 2, pageSize: 30 }, 15, 31, true],
		[{ since: date, pageSize: 45 }, 45, 1, false],
		[{ since: date }, 20, 1, true],
	]) {
		await withHistory(records(45), async (calls) => {
			const result = await service(5).historyDetail(options);
			assert.equal(result.ok, true);
			assert.equal(result.data.total, 45);
			assert.equal(result.data.items.length, count);
			assert.equal(result.data.items[0].id, first);
			assert.equal(result.data.truncated, truncated);
			const url = calls.at(-1);
			assert.equal(url.pathname, "/proxy/api/v5/history/since");
			assert.equal(url.searchParams.get("date"), date);
			assert.equal(url.searchParams.has("since"), false);
			assert.equal(url.searchParams.has("page"), false);
			assert.equal(url.searchParams.has("pageSize"), false);
			assert.deepEqual(url.searchParams.getAll("includeSubresources"), [
				"series",
				"episode",
			]);
		});
	}
});

test("history HTTP/auth/schema failures stay normalized without family fallback", async () => {
	const marker = "provider-private-instruction";
	for (const family of [3, 5]) {
		for (const body of [
			new Response(marker, { status: 401 }),
			new Response(marker, { status: 403 }),
			new Response(marker, { status: 500 }),
			new Response(marker),
			new Response(null, { status: 204 }),
			{ records: [{ id: marker }], totalRecords: 1 },
			null,
		]) {
			await withHistory(body, async (calls) => {
				const result = await service(family).historyDetail();
				assert.equal(result.ok, false);
				assert.equal(result.data, undefined);
				assert.equal(JSON.stringify(result).includes(marker), false);
				if (body instanceof Response && body.status >= 400)
					assert.equal(result.error.status, body.status);
				assert.equal(
					calls.filter((url) => url.pathname.endsWith("/history")).length,
					1,
				);
			});
		}
	}
	await withHistory({ records: [] }, async () => {
		assert.equal(
			(await service(5).historyDetail({ since: "2026-01-01" })).ok,
			false,
			"v5 since requires an array, not a paged envelope",
		);
	});
});

test("history returns the requested provider page without a hidden 20-item clip", async () => {
	for (const s of [service(), new RadarrService("radarr-test", config)]) {
		await withHistory(
			{ records: records(30), totalRecords: 30 },
			async (calls) => {
				const result = await s.historyDetail({ page: 1, pageSize: 30 });
				assert.equal(result.ok, true);
				assert.equal(result.data.items.length, 30);
				assert.equal(result.data.total, 30);
				assert.equal(result.data.truncated, false);
				assert.equal(calls[0].pathname, "/proxy/api/v3/history");
				assert.equal(calls[0].searchParams.get("pageSize"), "30");
			},
		);
	}
});
