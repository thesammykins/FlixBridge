import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { ArrMcpServer } from "../dist/index.js";
import { serviceRegistry } from "../dist/services/registry.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const calls = [];
let status = 200;
let api;
let baseUrl;
const app = new ArrMcpServer();
before(async () => {
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_)?(PLEX|JELLYFIN)_/.test(key))
			Reflect.deleteProperty(process.env, key);
	globalThis.fetch = (url, options) => {
		assert.equal(new URL(url).hostname, "127.0.0.1");
		return originalFetch(url, options);
	};
	api = createServer((req, res) => {
		calls.push({ method: req.method, url: new URL(req.url, baseUrl) });
		res.writeHead(status, { "Content-Type": "application/json" });
		const path = new URL(req.url, baseUrl).pathname;
		res.end(
			JSON.stringify(
				path === "/identity"
					? {
							MediaContainer: {
								machineIdentifier: "fixture-plex",
								version: "1.42",
							},
						}
					: path.endsWith("/system/status")
						? { appName: "Radarr", instanceName: "Movies", version: "6.0" }
						: {
								queue: {
									version: "4.5.3",
									paused: true,
									noofslots: 7,
									kbpersec: "12.5",
								},
							},
			),
		);
	});
	await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${api.address().port}`;
	app.initialize({
		services: {},
		downloaders: {
			sabnzbd: { baseUrl, apiKey: "fixture-key", name: "Primary downloads" },
			"custom-downloads": {
				baseUrl,
				apiKey: "fixture-key",
				name: "Custom downloads",
			},
		},
	});
});
after(async () => {
	serviceRegistry.clear();
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	await new Promise((resolve) => api.close(resolve));
});

function assertReadOnlyQueue(call) {
	assert.equal(call.method, "GET");
	assert.equal(call.url.pathname, "/api");
	assert.deepEqual([...call.url.searchParams].sort(), [
		["apikey", "fixture-key"],
		["mode", "queue"],
		["output", "json"],
	]);
}

test("system_status dispatches discovered downloader names to real SAB queue metadata", async () => {
	const listed = await app.callTool("list_services");
	assert.deepEqual(
		listed.data.downloaders.map(({ name }) => name),
		["sabnzbd", "custom-downloads"],
	);
	for (const [service, name] of [
		["sabnzbd", "Primary downloads"],
		["custom-downloads", "Custom downloads"],
	]) {
		const count = calls.length;
		assert.deepEqual(await app.callTool("system_status", { service }), {
			ok: true,
			data: {
				service: name,
				name: "SABnzbd",
				version: "4.5.3",
				isHealthy: true,
				paused: true,
				totalSlots: 7,
				speedKBps: 12.5,
			},
		});
		assert.equal(calls.length, count + 1);
		assertReadOnlyQueue(calls.at(-1));
	}
});

for (const httpStatus of [401, 403]) {
	test(`system_status propagates SAB HTTP ${httpStatus} without mutation or retry`, async () => {
		status = httpStatus;
		try {
			const count = calls.length;
			const result = await app.callTool("system_status", {
				service: "sabnzbd",
			});
			assert.equal(result.ok, false);
			assert.equal(result.error.status, httpStatus);
			assert.equal(result.error.service, "Primary downloads");
			assert.equal(calls.length, count + 1);
			assertReadOnlyQueue(calls.at(-1));
			const envelope = app.toolResult(result);
			assert.equal(envelope.isError, true);
			assert.equal(envelope.structuredContent.error.status, httpStatus);
			assert.deepEqual(
				JSON.parse(envelope.content[0].text),
				envelope.structuredContent,
			);
		} finally {
			status = 200;
		}
	});
}

test("unknown names and non-status tools do not fall through to downloader operations", async () => {
	const count = calls.length;
	for (const [name, args] of [
		["system_status", { service: "missing" }],
		["system_status", { service: "SABNZBD" }],
		["queue_list", { service: "sabnzbd" }],
		["queue_grab", { service: "sabnzbd", ids: [1] }],
		["search", { service: "custom-downloads", query: "fixture" }],
	]) {
		await assert.rejects(app.callTool(name, args), (error) => {
			assert.equal(error.code, -32602);
			assert.match(error.message, /Unknown service/);
			return true;
		});
	}
	assert.equal(calls.length, count);
});

test("ARR and Plex system_status still use their own real HTTP routes", async () => {
	serviceRegistry.register("radarr-test", { baseUrl, apiKey: "fixture-key" });
	for (const name of ["radarr-test", "plex-test"])
		serviceRegistry.registerDownloader(name, {
			baseUrl,
			apiKey: "fixture-key",
		});
	process.env.PLEX_TEST_URL = baseUrl;
	process.env.PLEX_TEST_TOKEN = "fixture-token";
	const arr = await app.callTool("system_status", { service: "radarr-test" });
	assert.deepEqual(arr, {
		ok: true,
		data: {
			service: "radarr-test",
			name: "Movies",
			version: "6.0",
			isHealthy: true,
		},
	});
	assert.equal(calls.at(-1).method, "GET");
	assert.equal(calls.at(-1).url.pathname, "/api/v3/system/status");
	const plex = await app.callTool("system_status", { service: "plex-test" });
	assert.equal(plex.ok, true);
	assert.equal(plex.data.type, "plex");
	assert.equal(plex.data.id, "fixture-plex");
	assert.equal(plex.data.reachable, true);
	assert.equal(calls.at(-1).method, "GET");
	assert.equal(calls.at(-1).url.pathname, "/identity");
});
