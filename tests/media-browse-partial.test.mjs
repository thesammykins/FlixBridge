import assert from "node:assert/strict";
import { test } from "node:test";
import { ArrMcpServer } from "../dist/index.js";
import { plexIds } from "../dist/library/media.js";
import { loadRuntimeConfig } from "../dist/runtime-config.js";
import { serviceRegistry } from "../dist/services/registry.js";

const jellyGood = (id = "jelly-good", type = "Movie") => ({
	Id: id,
	Name: id,
	Type: type,
	ProviderIds: { Tmdb: "7" },
});
const plexGood = (id = "plex-good") => ({
	ratingKey: id,
	title: id,
	type: "movie",
	Guid: [{ id: "tmdb://7" }, { id: "tmdb://7" }],
});
const plexBad = () => ({
	ratingKey: "plex-conflict",
	title: "not a safe match",
	type: "movie",
	Guid: [{ id: "tmdb://8" }, { id: "tmdb://9" }],
});
async function fixture(t, { jelly = [], plex = [] } = {}) {
	const env = { ...process.env },
		fetch = globalThis.fetch;
	process.env = Object.fromEntries(
		Object.entries(env).filter(
			([key]) =>
				!/^(?:FLIX_BRIDGE_|SONARR_|RADARR_|SABNZBD_|PLEX_|JELLYFIN_)/.test(key),
		),
	);
	Object.assign(process.env, {
		JELLYFIN_URL: "https://jelly.invalid/base",
		JELLYFIN_API_KEY: "synthetic-jelly",
		JELLYFIN_CF_ACCESS_CLIENT_ID: "jelly-access-id",
		JELLYFIN_CF_ACCESS_CLIENT_SECRET: "jelly-access-secret",
		PLEX_URL: "https://plex.invalid/base",
		PLEX_TOKEN: "synthetic-plex",
		PLEX_CF_ACCESS_CLIENT_ID: "plex-access-id",
		PLEX_CF_ACCESS_CLIENT_SECRET: "plex-access-secret",
		SONARR_URL: "https://sonarr.invalid/base",
		SONARR_API_KEY: "synthetic-sonarr",
	});
	const calls = [],
		state = { override: () => undefined };
	globalThis.fetch = async (input, options) => {
		const url = new URL(input),
			headers = new Headers(options.headers);
		calls.push({ url, headers });
		assert.equal(options.method, "GET");
		if (url.hostname === "jelly.invalid") {
			assert.equal(
				headers.get("Authorization"),
				'MediaBrowser Token="synthetic-jelly"',
			);
			assert.equal(headers.get("CF-Access-Client-Id"), "jelly-access-id");
		}
		if (url.hostname === "plex.invalid") {
			assert.equal(headers.get("X-Plex-Token"), "synthetic-plex");
			assert.equal(headers.get("CF-Access-Client-Id"), "plex-access-id");
		}
		const override = state.override(url);
		if (override !== undefined) return override;
		let data;
		if (url.hostname === "jelly.invalid")
			data = { Items: jelly, TotalRecordCount: jelly.length, StartIndex: 0 };
		else if (url.pathname.endsWith("library/sections"))
			data = { MediaContainer: { Directory: [{ key: "1", type: "movie" }] } };
		else if (url.hostname === "plex.invalid")
			data = {
				MediaContainer: {
					size: plex.length,
					totalSize: plex.length,
					offset: 0,
					Metadata: plex,
				},
			};
		else if (url.pathname.endsWith("/series"))
			data = [{ id: 1, title: "ARR", monitored: true }];
		else if (url.pathname.endsWith("/series/1"))
			data = {
				id: 1,
				title: "ARR",
				monitored: true,
				path: "/tv/fixture",
				status: "ended",
				tags: [],
				tvdbId: 7,
				seasons: [],
				statistics: { totalEpisodeCount: 0, episodeFileCount: 0 },
			};
		else data = [];
		return Response.json(data);
	};
	const app = new ArrMcpServer();
	app.initialize(await loadRuntimeConfig());
	t.after(() => {
		process.env = env;
		globalThis.fetch = fetch;
		serviceRegistry.clear();
	});
	return {
		state,
		calls,
		app,
		list: async (args) => {
			const wire = app.toolResult(
				await app.callTool("library_list", { page: 1, pageSize: 1, ...args }),
			);
			assert.deepEqual(
				JSON.parse(wire.content[0].text),
				wire.structuredContent,
			);
			assert.equal(wire.structuredContent.ok, true, JSON.stringify(wire));
			return wire.structuredContent.data;
		},
	};
}
function partial(data) {
	assert.equal(data.complete, false);
	assert.equal(data.pageComplete, false);
	assert.equal(data.coverage.indexComplete, false);
	assert.ok(data.errors.length > 0);
}

test("Jellyfin BoxSet cannot discard valid Movie/Series hits from the same server", async (t) => {
	const f = await fixture(t, {
		jelly: [
			jellyGood("box", "BoxSet"),
			jellyGood("movie"),
			jellyGood("series", "Series"),
		],
	});
	const data = await f.list({ services: ["jellyfin"] });
	assert.deepEqual(
		data.items.map(({ id }) => id),
		["movie"],
	);
	assert.equal(data.total, 2);
	assert.equal(data.hasMore, true);
	partial(data);
	assert.equal(data.errors[0].count, 1);
	assert.match(data.errors[0].message, /unexpected media kind/i);
});

test("Plex conflicting provider GUIDs exclude that item but preserve unrelated valid hits", async (t) => {
	const f = await fixture(t, {
		plex: [plexGood("first"), plexBad(), plexGood("second")],
	});
	const data = await f.list({ services: ["plex"], page: 2 });
	assert.deepEqual(
		data.items.map(({ id }) => id),
		["second"],
	);
	assert.equal(data.total, 2);
	partial(data);
	assert.equal(data.errors[0].count, 1);
	assert.match(data.errors[0].message, /Conflicting Plex GUIDs/);
	assert.throws(
		() => plexIds(plexBad()),
		(error) =>
			error.kind === "internal" && error.message === "Conflicting Plex GUIDs",
	);
	assert.deepEqual(plexIds(plexGood()), { tmdb: "7" });
});

test("repeated unsupported records produce a bounded counted diagnostic, not empty healthy data", async (t) => {
	const f = await fixture(t, {
		jelly: Array.from({ length: 20 }, (_, index) =>
			jellyGood(`box-${index}`, "BoxSet"),
		),
	});
	const data = await f.list({ services: ["jellyfin"] });
	assert.deepEqual(data.items, []);
	assert.equal(data.total, 0);
	partial(data);
	assert.equal(data.errors.length, 1);
	assert.equal(data.errors[0].count, 20);
});

test("Plex unsupported kinds cannot be mislabelled as valid movies", async (t) => {
	const f = await fixture(t, {
		plex: [{ ...plexGood("episode"), type: "episode" }, plexGood("movie")],
	});
	const data = await f.list({ services: ["plex"] });
	assert.deepEqual(
		data.items.map(({ id }) => id),
		["movie"],
	);
	partial(data);
});

test("partial hits from both media servers survive alongside the complete ARR page", async (t) => {
	const f = await fixture(t, {
		jelly: [jellyGood(), jellyGood("box", "BoxSet")],
		plex: [plexBad(), plexGood()],
	});
	const data = await f.list({
		services: ["jellyfin", "plex", "sonarr"],
		pageSize: 10,
	});
	assert.deepEqual(
		data.items.map(({ service, id }) => [service, id]),
		[
			["jellyfin", "jelly-good"],
			["plex", "plex-good"],
			["sonarr", 1],
		],
	);
	assert.equal(data.total, 3);
	partial(data);
	assert.equal(data.errors.length, 2);
});

test("healthy media browsing retains complete flags without weakening strict identity checks", async (t) => {
	const f = await fixture(t, { jelly: [jellyGood()], plex: [plexGood()] });
	const data = await f.list({ services: ["jellyfin", "plex"], pageSize: 10 });
	assert.equal(data.items.length, 2);
	assert.equal(data.complete, true);
	assert.equal(data.pageComplete, true);
	assert.equal(data.coverage.indexComplete, true);
	assert.deepEqual(data.errors, []);
});

for (const mode of ["auth", "duplicate", "malformed"])
	test(`provider-level ${mode} failure remains explicit; unrelated services survive`, async (t) => {
		const f = await fixture(t, {
			jelly: [jellyGood()],
			plex: mode === "duplicate" ? [plexGood(), plexGood()] : [plexGood()],
		});
		if (mode !== "duplicate")
			f.state.override = (url) =>
				url.hostname === "plex.invalid"
					? mode === "auth"
						? new Response(null, { status: 401 })
						: Response.json({ wrong: true })
					: undefined;
		const data = await f.list({ services: ["jellyfin", "plex"], pageSize: 10 });
		assert.deepEqual(
			data.items.map(({ service }) => service),
			["jellyfin"],
		);
		partial(data);
		assert.equal(data.errors.length, 1);
	});
