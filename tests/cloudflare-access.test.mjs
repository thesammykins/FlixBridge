import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { redact } from "../dist/approval/redact.js";
import { loadConfigFromEnvOnly } from "../dist/config.js";
import { createInternalError, fetchJson } from "../dist/core.js";
import { verifyRemediationAbsence } from "../dist/execution-outcome.js";
import { ArrMcpServer } from "../dist/index.js";
import {
	executeLibraryAction,
	prepareLibraryAction,
} from "../dist/library/actions.js";
import { arrReader } from "../dist/library/arr.js";
import { mediaReader, serverConfigs } from "../dist/library/media.js";
import { withRemovalAuthority } from "../dist/removal-authority.js";
import { loadRuntimeConfig } from "../dist/runtime-config.js";
import { SabnzbdService } from "../dist/services/downloaders/sabnzbd.js";
import {
	PlexReportsClient,
	plexConfigFromEnv,
} from "../dist/services/plex/reports.js";
import { serviceRegistry } from "../dist/services/registry.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const calls = [];
const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { status });
beforeEach(() => {
	process.env = Object.fromEntries(
		Object.entries(originalEnv).filter(
			([key]) =>
				!/^(?:FLIX_BRIDGE_|SONARR_|RADARR_|SABNZBD_|PLEX_|JELLYFIN_)/.test(key),
		),
	);
	calls.length = 0;
});
afterEach(() => {
	process.env = { ...originalEnv };
	globalThis.fetch = originalFetch;
	serviceRegistry.clear();
});
function fixture(respond) {
	globalThis.fetch = async (input, options) => {
		const call = {
			url: new URL(input),
			method: options.method,
			headers: new Headers(options.headers),
			body: options.body,
			redirect: options.redirect,
			optionKeys: Object.keys(options),
		};
		calls.push(call);
		return respond(call);
	};
}
function env(values) {
	Object.assign(process.env, values);
}
function assertAccess(call, id, secret) {
	assert.equal(call.headers.get("CF-Access-Client-Id"), id);
	assert.equal(call.headers.get("CF-Access-Client-Secret"), secret);
	assert.equal(call.redirect, "manual");
}

test("Access Sonarr discovery, status and bounded queue dispatch retain both auth layers", async () => {
	env({
		SONARR_HOME_URL: "https://sonarr.invalid/base",
		SONARR_HOME_API_KEY: "provider-key",
		SONARR_HOME_API_VERSION: "3",
		SONARR_HOME_CF_ACCESS_CLIENT_ID: "fixture-id.access",
		SONARR_HOME_CF_ACCESS_CLIENT_SECRET: "cfast_fixture-secret",
	});
	fixture(({ url, headers }) => {
		if (
			headers.get("CF-Access-Client-Id") !== "fixture-id.access" ||
			headers.get("CF-Access-Client-Secret") !== "cfast_fixture-secret" ||
			headers.get("X-Api-Key") !== "provider-key"
		)
			return json({}, 403);
		if (url.pathname === "/base/api")
			return json({ current: "v3", deprecated: [] });
		if (url.pathname.endsWith("/system/status"))
			return json({ appName: "Sonarr", version: "4.0.0" });
		return json({ page: 2, pageSize: 1, totalRecords: 0, records: [] });
	});
	const app = new ArrMcpServer();
	app.initialize(await loadConfigFromEnvOnly());
	assert.equal(
		(await app.callTool("system_status", { service: "sonarr-home" })).ok,
		true,
	);
	const queue = await app.callTool("queue_list", {
		service: "sonarr-home",
		page: 2,
		pageSize: 1,
	});
	assert.equal(queue.ok, true);
	assert.equal(queue.data.total, 0);
	assert.equal(calls[0].url.pathname, "/base/api");
	assert.equal(calls.at(-1).url.searchParams.get("pageSize"), "1");
	assert.equal(calls.at(-1).url.searchParams.get("page"), "2");
	for (const call of calls)
		assertAccess(call, "fixture-id.access", "cfast_fixture-secret");
});

test("successful provider echoes and trusted errors hide both Access fields in both MCP forms", async () => {
	const id = "opaque-client+id.access",
		secret = 'cfast_opaque-secret/plus+quote"';
	env({
		SONARR_HOME_URL: "https://sonarr.invalid",
		SONARR_HOME_API_KEY: "provider",
		SONARR_HOME_CF_ACCESS_CLIENT_ID: id,
		SONARR_HOME_CF_ACCESS_CLIENT_SECRET: secret,
	});
	fixture(() =>
		json({
			appName: id,
			version: `${secret} ${encodeURIComponent(id)} ${encodeURIComponent(secret)}`,
		}),
	);
	const app = new ArrMcpServer();
	app.initialize(await loadConfigFromEnvOnly());
	const output = app.toolResult(
		await app.callTool("system_status", { service: "sonarr-home" }),
	);
	const error = app.toolResult({
		ok: false,
		error: createInternalError(`${id} ${secret}`),
	});
	for (const text of [
		JSON.stringify(output),
		JSON.stringify(error),
		JSON.stringify(
			redact({ message: id, headers: { "CF-Access-Client-Id": id } }),
		),
	]) {
		for (const credential of [
			id,
			secret,
			encodeURIComponent(id),
			encodeURIComponent(secret),
			JSON.stringify(secret).slice(1, -1),
		])
			assert.equal(
				text.includes(credential),
				false,
				"Access credential leaked",
			);
	}
	assert.equal(output.structuredContent.ok, true);
	assert.deepEqual(
		JSON.parse(output.content[0].text),
		output.structuredContent,
	);
});

test("Access login HTML is an actionable failure, not API success", async () => {
	env({
		SONARR_HOME_URL: "https://sonarr.invalid",
		SONARR_HOME_API_KEY: "provider",
		SONARR_HOME_CF_ACCESS_CLIENT_ID: "html-id",
		SONARR_HOME_CF_ACCESS_CLIENT_SECRET: "html-secret",
	});
	fixture(
		() =>
			new Response("<!DOCTYPE html><html>Cloudflare Access login</html>", {
				headers: { "Content-Type": "text/html" },
			}),
	);
	const config = await loadConfigFromEnvOnly();
	await assert.rejects(
		fetchJson("https://sonarr.invalid/api/v3/system/status", {
			upstream: config.services["sonarr-home"],
		}),
		{ message: /Cloudflare Access.*Service Auth/ },
	);
	assert.equal(calls.length, 1);
});

test("Access media HTTPS validation is eager even when ARR is configured", async () => {
	env({
		SONARR_URL: "https://sonarr.invalid",
		SONARR_API_KEY: "provider",
		PLEX_URL: "http://plex.invalid",
		PLEX_TOKEN: "plex-provider",
		FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "startup-id",
		FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET: "startup-secret",
	});
	await assert.rejects(loadRuntimeConfig(), /Cloudflare Access.*HTTPS/);
	assert.equal(calls.length, 0);
});

test("unscoped caller headers cannot send Access credentials to arbitrary destinations", async () => {
	fixture(() => json({}));
	await assert.rejects(
		fetchJson("https://unrelated.invalid", {
			headers: {
				"CF-Access-Client-Id": "injected",
				"CF-Access-Client-Secret": "injected-secret",
			},
		}),
	);
	assert.equal(calls.length, 0);
});

for (const [label, status, body, contentType] of [
	["401", 401, "sab-error-private-id sab-error-private-secret", "text/plain"],
	["403", 403, "sab-error-private-id sab-error-private-secret", "text/plain"],
	[
		"HTML login",
		200,
		"<html>Cloudflare login sab-error-private-secret</html>",
		"text/html",
	],
])
	test(`SAB ${label} keeps actionable Access guidance in both public MCP forms`, async () => {
		env({
			RADARR_URL: "https://radarr.invalid",
			RADARR_API_KEY: "provider",
			SABNZBD_URL: "https://sab.invalid",
			SABNZBD_API_KEY: "sab-provider",
			SABNZBD_CF_ACCESS_CLIENT_ID: "sab-error-private-id",
			SABNZBD_CF_ACCESS_CLIENT_SECRET: "sab-error-private-secret",
		});
		fixture(
			() =>
				new Response(body, {
					status,
					headers: { "Content-Type": contentType },
				}),
		);
		const app = new ArrMcpServer();
		app.initialize(await loadConfigFromEnvOnly());
		const output = app.toolResult(
			await app.callTool("system_status", { service: "sabnzbd" }),
		);
		assert.equal(output.isError, true);
		assert.match(
			output.structuredContent.error.message,
			/Cloudflare Access.*Service Auth/,
		);
		assert.equal(
			output.structuredContent.error.status,
			status === 200 ? 403 : status,
		);
		assert.deepEqual(
			JSON.parse(output.content[0].text),
			output.structuredContent,
		);
		assert.equal(
			JSON.stringify(output).includes("sab-error-private-id"),
			false,
		);
		assert.equal(
			JSON.stringify(output).includes("sab-error-private-secret"),
			false,
		);
		assert.equal(calls.length, 1);
	});

test("cached Plex client refreshes Access rotation without replacing replay ownership", async () => {
	env({
		PLEX_URL: "https://plex.invalid",
		PLEX_TOKEN: "plex-provider",
		PLEX_CF_ACCESS_CLIENT_ID: "rotation-first",
		PLEX_CF_ACCESS_CLIENT_SECRET: "rotation-first-secret",
	});
	fixture(() =>
		json({
			MediaContainer: { Metadata: [{ type: "movie", title: "fixture" }] },
		}),
	);
	const app = new ArrMcpServer();
	const first = app.plexClient();
	await first.resolveReportUrl("/library/metadata/7");
	env({
		PLEX_CF_ACCESS_CLIENT_ID: "rotation-second",
		PLEX_CF_ACCESS_CLIENT_SECRET: "rotation-second-secret",
	});
	const second = app.plexClient();
	assert.equal(second, first);
	await second.resolveReportUrl("/library/metadata/8");
	assertAccess(calls[0], "rotation-first", "rotation-first-secret");
	assertAccess(calls[1], "rotation-second", "rotation-second-secret");
});

test("partial instance pair cannot borrow a secret from global fallback", async () => {
	env({
		SONARR_URL: "https://sonarr.invalid",
		SONARR_API_KEY: "provider-key",
		SONARR_CF_ACCESS_CLIENT_ID: "local-id",
		FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "global-id",
		FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET: "global-secret",
	});
	await assert.rejects(loadConfigFromEnvOnly(), /Cloudflare Access/);
	assert.equal(calls.length, 0);
});

test("global Access pair reaches every configured upstream graph, retaining provider auth", async () => {
	env({
		FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "shared-id.access",
		FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET: "shared-secret",
		RADARR_URL: "https://radarr.invalid",
		RADARR_API_KEY: "arr-key",
		SABNZBD_URL: "https://sab.invalid",
		SABNZBD_API_KEY: "sab-key",
		PLEX_URL: "https://plex.invalid",
		PLEX_TOKEN: "plex-key",
		JELLYFIN_URL: "https://jelly.invalid",
		JELLYFIN_API_KEY: "jelly-key",
	});
	fixture(({ url }) => {
		if (url.hostname === "sab.invalid")
			return json({
				queue: { version: "4", paused: false, noofslots: 0, kbpersec: "0" },
			});
		if (url.pathname.includes("library/metadata"))
			return json({
				MediaContainer: { Metadata: [{ type: "movie", title: "fixture" }] },
			});
		if (url.pathname.endsWith("system/status"))
			return json({ appName: "Radarr", version: "5.0.0" });
		if (url.pathname.endsWith("queue"))
			return json({ totalRecords: 0, records: [] });
		return json({});
	});
	const config = await loadConfigFromEnvOnly();
	const app = new ArrMcpServer();
	app.initialize(config);
	assert.equal(
		(await app.callTool("system_status", { service: "radarr" })).ok,
		true,
	);
	assert.equal(
		(
			await app.callTool("queue_list", {
				service: "radarr",
				page: 1,
				pageSize: 1,
			})
		).ok,
		true,
	);
	await (await arrReader("radarr", config.services.radarr))("movie");
	assert.equal(
		(await new SabnzbdService(config.downloaders.sabnzbd).serverStats()).ok,
		true,
	);
	for (const server of serverConfigs()) await mediaReader(server)("identity");
	await new PlexReportsClient(plexConfigFromEnv()).resolveReportUrl(
		"/library/metadata/7",
	);
	for (const call of calls) {
		assertAccess(call, "shared-id.access", "shared-secret");
		if (call.url.hostname === "radarr.invalid")
			assert.equal(call.headers.get("X-Api-Key"), "arr-key");
		if (call.url.hostname === "sab.invalid")
			assert.equal(call.url.searchParams.get("apikey"), "sab-key");
		if (call.url.hostname === "plex.invalid")
			assert.equal(call.headers.get("X-Plex-Token"), "plex-key");
		if (call.url.hostname === "jelly.invalid")
			assert.equal(call.headers.get("X-Emby-Token"), "jelly-key");
	}
});

const baseEnv = {
	RADARR_URL: "https://origin.invalid/radarr",
	RADARR_API_KEY: "provider-key",
};
const globalPair = {
	FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "global-fixture-id",
	FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET: "global-fixture-secret",
};
for (const [name, variables] of [
	[
		"empty global",
		{
			FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "",
			FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET: "present",
		},
	],
	["partial global", { FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "global-partial" }],
	[
		"empty instance",
		{ RADARR_CF_ACCESS_CLIENT_ID: "id", RADARR_CF_ACCESS_CLIENT_SECRET: "" },
	],
	[
		"whitespace",
		{
			RADARR_CF_ACCESS_CLIENT_ID: " id",
			RADARR_CF_ACCESS_CLIENT_SECRET: "secret",
		},
	],
	[
		"header injection",
		{
			RADARR_CF_ACCESS_CLIENT_ID: "id",
			RADARR_CF_ACCESS_CLIENT_SECRET: "secret\r\nInjected: value",
		},
	],
	[
		"conflicting aliases",
		{
			RADARR_CF_ACCESS_CLIENT_ID: "one",
			RADARR_CF_ACCESS_CLIENT_SECRET: "one-secret",
			FLIX_BRIDGE_RADARR_CF_ACCESS_CLIENT_ID: "two",
			FLIX_BRIDGE_RADARR_CF_ACCESS_CLIENT_SECRET: "two-secret",
		},
	],
	[
		"split aliases",
		{
			RADARR_CF_ACCESS_CLIENT_ID: "one",
			FLIX_BRIDGE_RADARR_CF_ACCESS_CLIENT_SECRET: "other-half",
		},
	],
	[
		"invalid global masked by local",
		{
			FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "incomplete",
			RADARR_CF_ACCESS_CLIENT_ID: "valid",
			RADARR_CF_ACCESS_CLIENT_SECRET: "valid-secret",
		},
	],
	[
		"unused malformed media scope",
		{ PLEX_UNUSED_CF_ACCESS_CLIENT_SECRET: "unpaired" },
	],
	[
		"global requires HTTPS",
		{ ...globalPair, RADARR_URL: "http://origin.invalid" },
	],
	[
		"local requires HTTPS",
		{
			RADARR_URL: "http://origin.invalid",
			RADARR_CF_ACCESS_CLIENT_ID: "local",
			RADARR_CF_ACCESS_CLIENT_SECRET: "local-secret",
		},
	],
])
	test(`Access configuration rejects ${name} before network`, async () => {
		env({ ...baseEnv, ...variables });
		await assert.rejects(loadConfigFromEnvOnly(), /Cloudflare Access/);
		assert.equal(calls.length, 0);
	});

test("same-origin instances retain override/global identities, frozen until reconfiguration", async () => {
	env({
		...globalPair,
		SONARR_HOME_TV_URL: "https://origin.invalid/sonarr",
		SONARR_HOME_TV_API_KEY: "sonarr-provider",
		SONARR_HOME_TV_NAME: "sonarr-custom-name",
		FLIX_BRIDGE_SONARR_HOME_TV_CF_ACCESS_CLIENT_ID: "override-fixture-id",
		FLIX_BRIDGE_SONARR_HOME_TV_CF_ACCESS_CLIENT_SECRET:
			"override-fixture-secret",
		...baseEnv,
	});
	fixture(() => json({}));
	const config = await loadConfigFromEnvOnly();
	const one = await arrReader(
			"sonarr-custom-name",
			config.services["sonarr-custom-name"],
		),
		two = await arrReader("radarr", config.services.radarr);
	env({
		FLIX_BRIDGE_CF_ACCESS_CLIENT_ID: "rotated-global",
		FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET: "rotated-global-secret",
	});
	await one("series");
	await two("movie");
	await one("series");
	assertAccess(calls[0], "override-fixture-id", "override-fixture-secret");
	assertAccess(
		calls[1],
		globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_ID,
		globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET,
	);
	assertAccess(calls[2], "override-fixture-id", "override-fixture-secret");
	assert.equal(calls[0].headers.get("X-Api-Key"), "sonarr-provider");
	assert.equal(calls[1].headers.get("X-Api-Key"), "provider-key");
	assert.deepEqual(Object.keys(config.services).sort(), [
		"radarr",
		"sonarr-custom-name",
	]);
	assert.equal(JSON.stringify(config).includes("fixture-secret"), false);
});

test("equal aliases are accepted; no Access preserves HTTP and existing provider auth", async () => {
	env({ ...baseEnv, RADARR_URL: "http://origin.invalid" });
	fixture(() => json({}));
	await (
		await arrReader("radarr", (await loadConfigFromEnvOnly()).services.radarr)
	)("movie");
	assert.equal(calls[0].headers.has("CF-Access-Client-Id"), false);
	assert.equal(calls[0].headers.get("X-Api-Key"), "provider-key");
	env({
		RADARR_URL: "https://origin.invalid",
		RADARR_CF_ACCESS_CLIENT_ID: "equal-id",
		RADARR_CF_ACCESS_CLIENT_SECRET: "equal-secret",
		FLIX_BRIDGE_RADARR_CF_ACCESS_CLIENT_ID: "equal-id",
		FLIX_BRIDGE_RADARR_CF_ACCESS_CLIENT_SECRET: "equal-secret",
	});
	await (
		await arrReader("radarr", (await loadConfigFromEnvOnly()).services.radarr)
	)("movie");
	assertAccess(calls[1], "equal-id", "equal-secret");
});

for (const status of [401, 403])
	test(`Access ${status} never retries global credentials or a weaker Sonarr API family`, async () => {
		env({
			...globalPair,
			SONARR_URL: "https://origin.invalid/sonarr",
			SONARR_API_KEY: "provider",
			SONARR_API_VERSION: "auto",
			SONARR_CF_ACCESS_CLIENT_ID: "specific-id",
			SONARR_CF_ACCESS_CLIENT_SECRET: "specific-secret",
		});
		fixture(() => json({ message: "specific-id specific-secret" }, status));
		const app = new ArrMcpServer();
		app.initialize(await loadConfigFromEnvOnly());
		const result = await app.callTool("system_status", { service: "sonarr" });
		assert.equal(result.ok, false);
		assert.equal(calls.length, 1);
		assertAccess(calls[0], "specific-id", "specific-secret");
		assert.equal(
			JSON.stringify(app.toolResult(result)).includes("specific-secret"),
			false,
		);
	});

for (const location of [
	"https://other.invalid/api",
	"http://origin.invalid/api",
	"https://origin.invalid:444/api",
	"https://user@origin.invalid/api",
	"https://origin.invalid.evil.invalid/api",
])
	test(`Access refuses redirect scope ${location}`, async () => {
		env({ ...baseEnv, ...globalPair });
		fixture(
			() =>
				new Response(null, { status: 302, headers: { Location: location } }),
		);
		const config = (await loadConfigFromEnvOnly()).services.radarr;
		await assert.rejects(
			fetchJson("https://origin.invalid/radarr/api", { upstream: config }),
		);
		assert.equal(calls.length, 1);
	});

test("Access rejects an unrelated initial origin and bounds same-origin read redirects", async () => {
	env({ ...baseEnv, ...globalPair });
	const config = (await loadConfigFromEnvOnly()).services.radarr;
	fixture(() => json({}));
	await assert.rejects(
		fetchJson("https://other.invalid", { upstream: config }),
	);
	assert.equal(calls.length, 0);
	fixture(({ url }) =>
		url.pathname.endsWith("first")
			? new Response(null, {
					status: 307,
					headers: { Location: "/radarr/second" },
				})
			: json({ accepted: true }),
	);
	assert.deepEqual(
		await fetchJson("https://origin.invalid/radarr/first", {
			upstream: config,
		}),
		{ accepted: true },
	);
	for (const call of calls) {
		assertAccess(
			call,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_ID,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET,
		);
		assert.equal(call.optionKeys.includes("upstream"), false);
	}
	calls.length = 0;
	fixture(
		() =>
			new Response(null, {
				status: 302,
				headers: { Location: "/radarr/loop" },
			}),
	);
	await assert.rejects(
		fetchJson("https://origin.invalid/radarr/loop", { upstream: config }),
	);
	assert.equal(calls.length, 6);
});

test("Access keeps mutation redirects non-replayable", async () => {
	env({ ...baseEnv, ...globalPair });
	fixture(
		() =>
			new Response(null, {
				status: 307,
				headers: { Location: "/radarr/other" },
			}),
	);
	await assert.rejects(
		fetchJson("https://origin.invalid/radarr/api/v3/command", {
			method: "POST",
			body: "{}",
			upstream: (await loadConfigFromEnvOnly()).services.radarr,
		}),
		{ message: /Mutation HTTP redirect/ },
	);
	assert.equal(calls.length, 1);
});

test("global Access never reaches Plex cloud, external review endpoints or unscoped webhooks", async () => {
	env({
		...globalPair,
		PLEX_URL: "https://plex.invalid",
		PLEX_TOKEN: "plex-provider",
	});
	fixture(({ url }) =>
		url.hostname === "community.plex.tv"
			? json({
					data: {
						reports: {
							nodes: [],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				})
			: json({}),
	);
	assert.equal(
		(
			await new PlexReportsClient(plexConfigFromEnv()).listReportsPage({
				limit: 1,
			})
		).ok,
		true,
	);
	await fetchJson("https://api.themoviedb.org/3/review", {
		headers: { Authorization: "Bearer external-provider-token" },
	});
	await fetchJson("https://webhook.invalid/notify", {
		method: "POST",
		body: "{}",
	});
	for (const call of calls) {
		assert.equal(call.headers.has("CF-Access-Client-Id"), false);
		assert.equal(call.headers.has("CF-Access-Client-Secret"), false);
	}
	assert.equal(calls[0].headers.get("X-Plex-Token"), "plex-provider");
	assert.equal(
		calls[1].headers.get("Authorization"),
		"Bearer external-provider-token",
	);
});

test("Access credentials never grant destructive authority", async () => {
	env({ ...baseEnv, ...globalPair });
	fixture(() => json({}));
	const config = await loadConfigFromEnvOnly();
	await assert.rejects(
		fetchJson("https://origin.invalid/radarr/api/v3/moviefile/7", {
			method: "DELETE",
			upstream: config.services.radarr,
		}),
		{ message: /Authenticated human approval/ },
	);
	const app = new ArrMcpServer();
	app.initialize(config);
	await assert.rejects(
		app.callTool("remove_content", {
			service: "radarr",
			target: "library",
			ids: [7],
			dryRun: false,
			deleteFiles: true,
		}),
		{ message: /Authenticated human approval/ },
	);
	assert.equal(calls.length, 0);
});

test("approved synthetic file deletion and absence readback keep instance Access context", async () => {
	env({ ...baseEnv, ...globalPair });
	let deleted = false,
		monitored = true;
	const file = {
		id: 70,
		path: "/library/synthetic/file.mkv",
		sizeBytes: 10,
		episodeIds: [],
	};
	const item = {
		service: "radarr",
		id: 7,
		mediaKind: "movie",
		title: "Synthetic",
		path: "/library/synthetic",
		status: "released",
		providerIds: { tmdb: "7" },
		complete: true,
		apiFamily: 3,
		files: [file],
		episodes: [],
		seasons: [],
		tags: [],
		ratings: {},
		monitored: true,
	};
	fixture(({ url, method, body }) => {
		if (method === "DELETE") {
			deleted = true;
			return new Response(null, { status: 204 });
		}
		if (url.pathname.endsWith("/movie"))
			return json({ files: deleted ? [] : [file] });
		if (method === "PUT") monitored = JSON.parse(body).monitored;
		return json({ id: 7, title: item.title, path: item.path, monitored });
	});
	const read = await arrReader(
		"radarr",
		(await loadConfigFromEnvOnly()).services.radarr,
	);
	// Fixed library/watch evidence; real arrReader/core HTTP handles every readback.
	const deps = {
		loadLibrarySnapshot: async () => ({
			complete: true,
			items: [{ ...item, files: (await read("movie")).files }],
		}),
		getWatchEvidence: async () => ({
			complete: true,
			activePlayback: false,
			favourite: false,
			viewers: [{ server: "plex", userId: "fixture-user" }],
		}),
	};
	const input = {
		service: "radarr",
		itemId: 7,
		target: "files",
		ids: [70],
		monitored: false,
		deleteFiles: true,
		users: [{ server: "plex", userId: "fixture-user" }],
	};
	const prepared = await prepareLibraryAction(input, deps);
	const result = await withRemovalAuthority(
		{
			approvalId: "synthetic-only",
			planHash: "0".repeat(64),
			allowed: [
				{
					origin: "https://origin.invalid",
					path: "/radarr/api/v3/moviefile/70",
				},
			],
		},
		() => executeLibraryAction(input, prepared, deps),
	);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.data.verified, true);
	assert.equal(deleted, true);
	assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
	assert.equal(calls.at(-1).url.pathname, "/radarr/api/v3/movie");
	for (const call of calls) {
		assertAccess(
			call,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_ID,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET,
		);
		assert.equal(call.headers.get("X-Api-Key"), "provider-key");
	}
});

test("monitoring prerequisites, mutation and readback retain Access and provider auth", async () => {
	env({ ...baseEnv, ...globalPair });
	let monitored = true;
	const item = {
		service: "radarr",
		id: 7,
		mediaKind: "movie",
		title: "Synthetic",
		path: "/library/synthetic",
		status: "released",
		providerIds: { tmdb: "7" },
		complete: true,
		apiFamily: 3,
		files: [],
		episodes: [],
		seasons: [],
		tags: [],
		ratings: {},
		monitored: true,
	};
	const deps = {
		loadLibrarySnapshot: async () => ({ complete: true, items: [item] }),
		getWatchEvidence: async () => {
			throw new Error("Monitoring does not need viewer fallback");
		},
	};
	fixture(({ method, body }) => {
		if (method === "PUT") monitored = JSON.parse(body).monitored;
		return json({ id: 7, title: item.title, path: item.path, monitored });
	});
	const input = {
		service: "radarr",
		itemId: 7,
		target: "monitoring",
		monitored: false,
		deleteFiles: false,
	};
	const result = await executeLibraryAction(
		input,
		await prepareLibraryAction(input, deps),
		deps,
	);
	assert.equal(result.ok, true);
	assert.equal(result.data.verified, true);
	assert.deepEqual(
		calls.map((x) => x.method),
		["GET", "PUT", "GET"],
	);
	for (const call of calls) {
		assertAccess(
			call,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_ID,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET,
		);
		assert.equal(call.headers.get("X-Api-Key"), "provider-key");
	}
});

test("SAB GET deletion and independent readback retain scoped Access; its redirect cannot replay", async () => {
	env({
		...baseEnv,
		...globalPair,
		SABNZBD_URL: "https://sab.invalid",
		SABNZBD_API_KEY: "sab-provider",
	});
	const config = await loadConfigFromEnvOnly();
	const sab = new SabnzbdService(config.downloaders.sabnzbd);
	let present = true;
	const slot = {
		nzo_id: "fixture-job",
		filename: "Synthetic",
		status: "Paused",
		percentage: "0",
		mb: "1",
		mbleft: "1",
	};
	fixture(({ url }) => {
		if (url.searchParams.get("name") === "delete") {
			present = false;
			return json({ status: true });
		}
		return json({
			queue: {
				slots: present ? [slot] : [],
				kbpersec: "0",
				mb: "1",
				mbleft: "1",
				size: "1 MB",
				sizeleft: "1 MB",
				paused: true,
				noofslots: present ? 1 : 0,
			},
		});
	});
	// Internal authority belongs only to this synthetic fetch fixture; no live service is used.
	const permit = {
		approvalId: "synthetic-test-only",
		planHash: "0".repeat(64),
		allowed: [
			{ origin: "https://sab.invalid", path: "/api", ids: ["fixture-job"] },
		],
	};
	const result = await withRemovalAuthority(permit, () =>
		sab.removeQueueItems(["fixture-job"], false),
	);
	assert.equal(result.ok, true);
	assert.equal(result.data.removed, 1);
	assert.equal(result.data.failed, 0);
	assert.equal(calls.length, 3);
	for (const call of calls) {
		assertAccess(
			call,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_ID,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET,
		);
		assert.equal(call.url.searchParams.get("apikey"), "sab-provider");
	}
	assert.equal(calls[1].url.searchParams.get("del_files"), "0");
	calls.length = 0;
	fixture(
		() =>
			new Response(null, {
				status: 302,
				headers: { Location: "/api?mode=queue&name=delete&value=fixture-job" },
			}),
	);
	await assert.rejects(
		withRemovalAuthority(permit, () =>
			fetchJson(
				"https://sab.invalid/api?mode=queue&name=delete&value=fixture-job",
				{ upstream: config.downloaders.sabnzbd },
			),
		),
		{ message: /Mutation HTTP redirect/ },
	);
	assert.equal(calls.length, 1);
});

test("remediation absence verification retains Access and preserves genuine404 versus auth failure", async () => {
	env({ ...baseEnv, ...globalPair });
	for (const status of [404, 403]) {
		calls.length = 0;
		fixture(() => json({}, status));
		assert.equal(
			await verifyRemediationAbsence({
				preview: { service: "radarr", item: { movieFileId: 7 } },
			}),
			status === 404,
		);
		assert.equal(calls.length, 1);
		assertAccess(
			calls[0],
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_ID,
			globalPair.FLIX_BRIDGE_CF_ACCESS_CLIENT_SECRET,
		);
	}
});
