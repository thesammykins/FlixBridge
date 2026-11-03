import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ArrMcpServer } from "../dist/index.js";
import { mediaReader, serverConfigs } from "../dist/library/media.js";
import { loadRuntimeConfig } from "../dist/runtime-config.js";
import { serviceRegistry } from "../dist/services/registry.js";

const originalEnv = { ...process.env },
	originalFetch = globalThis.fetch;
beforeEach(() => {
	process.env = Object.fromEntries(
		Object.entries(originalEnv).filter(
			([key]) =>
				!/^(?:FLIX_BRIDGE_|SONARR_|RADARR_|SABNZBD_|PLEX_|JELLYFIN_)/.test(key),
		),
	);
});
afterEach(() => {
	process.env = { ...originalEnv };
	globalThis.fetch = originalFetch;
	serviceRegistry.clear();
});
const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { status });

for (const access of [false, true])
	test(`Jellyfin MCP reads use compatible MediaBrowser authorization${access ? " alongside Access" : " without Access"}`, async () => {
		const token = "synthetic-jellyfin-provider";
		Object.assign(process.env, {
			JELLYFIN_URL: "https://jellyfin.invalid/base",
			JELLYFIN_API_KEY: token,
		});
		if (access)
			Object.assign(process.env, {
				JELLYFIN_CF_ACCESS_CLIENT_ID: "synthetic-access-id",
				JELLYFIN_CF_ACCESS_CLIENT_SECRET: "synthetic-access-secret",
			});
		const calls = [];
		globalThis.fetch = async (input, options) => {
			const url = new URL(input),
				headers = new Headers(options.headers);
			calls.push({ url, headers });
			const auth = headers.get("Authorization") ?? "";
			const encoded = /\bToken="([^"]*)"/.exec(auth)?.[1];
			if (
				!auth.startsWith("MediaBrowser ") ||
				decodeURIComponent(encoded ?? "") !==
					(url.pathname.endsWith("viewer-token-check")
						? "viewer-specific-token"
						: token)
			)
				return json({}, 401);
			if (
				access &&
				(headers.get("CF-Access-Client-Id") !== "synthetic-access-id" ||
					headers.get("CF-Access-Client-Secret") !== "synthetic-access-secret")
			)
				return json({}, 403);
			if (url.pathname.endsWith("System/Info"))
				return json({
					ServerName: "Fixture",
					Version: "10.11.0",
					Id: "fixture-server",
				});
			if (url.pathname.endsWith("Users"))
				return json([{ Id: "fixture-user", Name: "Fixture User" }]);
			return json({
				Items: [
					{
						Id: "fixture-movie",
						Name: "Fixture",
						Type: "Movie",
						ProviderIds: { Tmdb: "7" },
						MediaSources: [{ Id: "fixture-copy", Path: "/movies/fixture.mkv" }],
					},
				],
				TotalRecordCount: 1,
				StartIndex: 0,
			});
		};
		const app = new ArrMcpServer();
		app.initialize(await loadRuntimeConfig());
		const status = await app.callTool("system_status", { service: "jellyfin" });
		assert.equal(status.ok, true, JSON.stringify(status));
		const users = await app.callTool("library_list", {
			scope: "users",
			services: ["jellyfin"],
			page: 1,
			pageSize: 1,
		});
		assert.equal(users.ok, true);
		assert.deepEqual(users.data.errors, []);
		const library = await app.callTool("library_list", {
			services: ["jellyfin"],
			page: 1,
			pageSize: 1,
		});
		assert.equal(library.ok, true);
		assert.deepEqual(library.data.errors, []);
		await mediaReader(
			serverConfigs()[0],
			"viewer-specific-token",
		)("viewer-token-check");
		assert.ok(calls.some((call) => call.url.pathname.endsWith("System/Info")));
		assert.ok(calls.some((call) => call.url.pathname.endsWith("Users")));
		assert.ok(calls.some((call) => call.url.pathname.endsWith("Items")));
		for (const call of calls) {
			assert.equal(call.headers.has("X-Emby-Token"), false);
			assert.equal(call.headers.has("X-MediaBrowser-Token"), false);
		}
	});

test("Jellyfin quoted authorization preserves opaque viewer tokens without header/query injection", async () => {
	Object.assign(process.env, {
		JELLYFIN_URL: "https://jellyfin.invalid/base",
		JELLYFIN_API_KEY: "synthetic-owner-token",
	});
	const token = 'synthetic-",+\\\r\n café';
	let captured;
	globalThis.fetch = async (url, options) => {
		captured = { url: new URL(url), headers: new Headers(options.headers) };
		return json({});
	};
	await mediaReader(serverConfigs()[0], token)("System/Info");
	assert.equal(
		captured.headers.get("Authorization"),
		`MediaBrowser Token="${encodeURIComponent(token)}"`,
	);
	assert.equal(
		decodeURIComponent(
			/\bToken="([^"]*)"/.exec(captured.headers.get("Authorization"))[1],
		),
		token,
	);
	assert.equal(captured.url.search, "");
	assert.equal(captured.headers.has("X-Emby-Token"), false);
});

for (const status of [401, 403])
	test(`Jellyfin ${status} remains an error without legacy-auth retries`, async () => {
		Object.assign(process.env, {
			JELLYFIN_URL: "https://jellyfin.invalid/base",
			JELLYFIN_API_KEY: "synthetic-owner-token",
			JELLYFIN_CF_ACCESS_CLIENT_ID: "synthetic-access-id",
			JELLYFIN_CF_ACCESS_CLIENT_SECRET: "synthetic-access-secret",
		});
		const calls = [];
		globalThis.fetch = async (url, options) => {
			calls.push({ url: new URL(url), headers: new Headers(options.headers) });
			return json({}, status);
		};
		const app = new ArrMcpServer();
		app.initialize(await loadRuntimeConfig());
		const result = app.toolResult(
			await app.callTool("system_status", { service: "jellyfin" }),
		);
		assert.equal(result.structuredContent.ok, false);
		assert.equal(result.structuredContent.error.status, status);
		assert.equal(result.structuredContent.data.isHealthy, false);
		assert.deepEqual(
			JSON.parse(result.content[0].text),
			result.structuredContent,
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url.search, "");
		assert.equal(calls[0].headers.has("X-Emby-Token"), false);
		for (const value of [
			"synthetic-owner-token",
			"synthetic-access-id",
			"synthetic-access-secret",
		])
			assert.equal(JSON.stringify(result).includes(value), false);
	});

test("Radarr import_issues uses wanted/missing through dispatcher and public serializer", async () => {
	Object.assign(process.env, {
		RADARR_URL: "https://radarr.invalid/base",
		RADARR_API_KEY: "synthetic-provider",
		RADARR_CF_ACCESS_CLIENT_ID: "route-access-id",
		RADARR_CF_ACCESS_CLIENT_SECRET: "route-access-secret",
	});
	const calls = [];
	globalThis.fetch = async (input, options) => {
		const url = new URL(input),
			headers = new Headers(options.headers);
		calls.push({ url, headers });
		return url.pathname === "/base/api/v3/wanted/missing"
			? json({
					page: 1,
					pageSize: 10,
					totalRecords: 1,
					records: [{ id: 7, title: "Fixture Missing Movie" }],
				})
			: json({}, 404);
	};
	const app = new ArrMcpServer();
	app.initialize(await loadRuntimeConfig());
	const result = app.toolResult(
		await app.callTool("import_issues", { service: "radarr" }),
	);
	assert.equal(result.structuredContent.ok, true, JSON.stringify(result));
	assert.deepEqual(
		JSON.parse(result.content[0].text),
		result.structuredContent,
	);
	assert.deepEqual(result.structuredContent.data.issues, [
		{
			id: 7,
			title: "Fixture Missing Movie",
			reason: "Missing movie file",
			ageMinutes: 0,
		},
	]);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url.pathname, "/base/api/v3/wanted/missing");
	assert.equal(calls[0].headers.get("X-Api-Key"), "synthetic-provider");
	assert.equal(calls[0].headers.get("CF-Access-Client-Id"), "route-access-id");
});

test("1500-title Sonarr small-page listing hydrates only the requested title", async () => {
	Object.assign(process.env, {
		SONARR_URL: "https://sonarr.invalid",
		SONARR_API_KEY: "synthetic-provider",
	});
	const rows = Array.from({ length: 1500 }, (_, index) => ({
		id: index + 1,
		title: `Fixture ${index + 1}`,
		path: `/tv/fixture-${index + 1}`,
		monitored: true,
		status: "continuing",
		tvdbId: index + 1,
		tags: [],
		seasons: [],
		statistics: { totalEpisodeCount: 0, episodeFileCount: 0 },
	}));
	const details = [];
	globalThis.fetch = async (input) => {
		const url = new URL(input);
		if (url.pathname === "/api/v3/series") return json(rows);
		const detail = /^\/api\/v3\/series\/(\d+)$/.exec(url.pathname);
		if (detail) {
			details.push(Number(detail[1]));
			return json(rows[Number(detail[1]) - 1]);
		}
		return json([]);
	};
	const app = new ArrMcpServer();
	app.initialize(await loadRuntimeConfig());
	const result = await app.callTool("library_list", {
		services: ["sonarr"],
		page: 1,
		pageSize: 1,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.data.items.length, 1);
	assert.equal(
		new Set(details).size,
		1,
		"Small output pages must not hydrate all 1500 title/file/episode graphs",
	);
	assert.equal(details[0], 1);
	assert.equal(result.data.items[0].complete, true);
});
