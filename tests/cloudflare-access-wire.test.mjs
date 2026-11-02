import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const entry = process.env.FLIXBRIDGE_TEST_ENTRY ?? resolve("dist/index.js");
function isolatedEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) =>
				!/^(?:FLIX_BRIDGE_|SONARR_|RADARR_|SABNZBD_|PLEX_|JELLYFIN_|NODE_OPTIONS$|NODE_TLS_REJECT_UNAUTHORIZED$)/.test(
					key,
				),
		),
	);
}

test("stdio MCP authenticates ARR and modern Jellyfin HTTPS reads independently and redacts both response forms", async (t) => {
	const directory = await mkdtemp(
		join(process.env.TMPDIR ?? tmpdir(), "cloudflare-wire-"),
	);
	t.after(() => rm(directory, { recursive: true, force: true }));
	const key = join(directory, "fixture-key.pem"),
		cert = join(directory, "fixture-cert.pem");
	// Ephemeral loopback-only identity; no production key and no disabled TLS checks.
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			key,
			"-out",
			cert,
			"-days",
			"1",
			"-subj",
			"/CN=127.0.0.1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
		],
		{ stdio: "ignore" },
	);
	const expected = {
		sonarr: {
			id: "wire-sonarr-id.access",
			secret: "cfast_wire-sonarr-secret",
			api: "wire-sonarr-provider",
		},
		radarr: {
			id: "wire-radarr-id.access",
			secret: "cfast_wire-radarr-secret",
			api: "wire-radarr-provider",
		},
		jellyfin: {
			id: "wire-jellyfin-id.access",
			secret: "cfast_wire-jellyfin-secret",
			api: "wire-jellyfin-provider",
		},
	};
	const requests = [];
	let partialJellyfin = false;
	const titles = Array.from({ length: 1500 }, (_, index) => ({
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
	const upstream = createServer(
		{ key: await readFile(key), cert: await readFile(cert) },
		(req, res) => {
			const url = new URL(req.url, "https://127.0.0.1"),
				service = url.pathname.split("/")[1],
				credentials = expected[service];
			requests.push({ url, headers: req.headers });
			res.setHeader("Content-Type", "application/json");
			if (
				!credentials ||
				req.headers["cf-access-client-id"] !== credentials.id ||
				req.headers["cf-access-client-secret"] !== credentials.secret ||
				(service === "jellyfin"
					? req.headers.authorization !==
						`MediaBrowser Token="${encodeURIComponent(credentials.api)}"`
					: req.headers["x-api-key"] !== credentials.api)
			) {
				res.writeHead(403).end(
					JSON.stringify({
						message: "Fixture requires both independent auth layers",
					}),
				);
				return;
			}
			if (service === "jellyfin") {
				if (url.pathname.endsWith("System/Info"))
					res.end(
						JSON.stringify({
							Id: "fixture-server",
							ServerName: "Fixture",
							Version: credentials.secret,
						}),
					);
				else if (url.pathname.endsWith("Users"))
					res.end(
						JSON.stringify([{ Id: "fixture-user", Name: "Fixture User" }]),
					);
				else if (url.pathname.endsWith("Items"))
					res.end(
						JSON.stringify(
							partialJellyfin
								? {
										Items: [
											{ Id: "fixture-box", Name: "Excluded", Type: "BoxSet" },
											{
												Id: "fixture-movie",
												Name: "Available",
												Type: "Movie",
												ProviderIds: { Tmdb: "7" },
											},
										],
										TotalRecordCount: 2,
										StartIndex: 0,
									}
								: { Items: [], TotalRecordCount: 0, StartIndex: 0 },
						),
					);
				else res.writeHead(404).end("{}");
				return;
			}
			if (url.pathname === "/sonarr/api/v3/series")
				res.end(JSON.stringify(titles));
			else if (url.pathname === "/sonarr/api/v3/series/1")
				res.end(JSON.stringify(titles[0]));
			else if (
				[
					"/sonarr/api/v3/tag",
					"/sonarr/api/v3/episodefile",
					"/sonarr/api/v3/episode",
				].includes(url.pathname)
			)
				res.end("[]");
			else if (url.pathname.endsWith("system/status"))
				res.end(
					JSON.stringify({
						appName: service === "sonarr" ? "Sonarr" : "Radarr",
						version: credentials.secret,
					}),
				);
			else if (
				url.pathname.endsWith("queue") ||
				url.pathname === "/radarr/api/v3/wanted/missing"
			)
				res.end(
					JSON.stringify({
						page: 1,
						pageSize: 1,
						totalRecords: 0,
						records: [],
					}),
				);
			else res.writeHead(404).end("{}");
		},
	);
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	t.after(
		() =>
			new Promise((resolveClose) => {
				upstream.closeAllConnections();
				upstream.close(resolveClose);
			}),
	);
	const origin = `https://127.0.0.1:${upstream.address().port}`;
	const env = {
		...isolatedEnv(),
		NODE_EXTRA_CA_CERTS: cert,
		FLIX_BRIDGE_DEBUG: "1",
	};
	for (const [name, pair] of Object.entries(expected)) {
		const prefix = name.toUpperCase();
		Object.assign(env, {
			[`${prefix}_URL`]: `${origin}/${name}`,
			[`${prefix}_API_KEY`]: pair.api,
			[`${prefix}_CF_ACCESS_CLIENT_ID`]: pair.id,
			[`${prefix}_CF_ACCESS_CLIENT_SECRET`]: pair.secret,
		});
	}
	const client = new Client({
		name: "cloudflare-installed-wire",
		version: "1.0.0",
	});
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [entry],
		env,
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	t.after(() => client.close());
	await client.connect(transport);
	let expectedReadCalls = 0;
	for (const service of Object.keys(expected)) {
		const reads = [["system_status", { service }]];
		if (service === "jellyfin")
			reads.push(
				[
					"library_list",
					{ scope: "users", services: [service], page: 1, pageSize: 1 },
				],
				["library_list", { services: [service], page: 1, pageSize: 1 }],
			);
		else reads.push(["queue_list", { service, page: 1, pageSize: 1 }]);
		if (service === "radarr") reads.push(["import_issues", { service }]);
		for (const [name, args] of reads) {
			expectedReadCalls++;
			const result = await client.callTool({ name, arguments: args });
			assert.notEqual(result.isError, true, JSON.stringify(result));
			assert.equal(result.structuredContent.ok, true);
			if (name === "library_list")
				assert.deepEqual(result.structuredContent.data.errors, []);
			assert.deepEqual(
				JSON.parse(result.content[0].text),
				result.structuredContent,
			);
			const wire = JSON.stringify(result);
			for (const pair of Object.values(expected))
				for (const value of [pair.id, pair.secret])
					assert.equal(
						wire.includes(value),
						false,
						"Credential leaked through MCP",
					);
		}
	}
	assert.equal(requests.length, expectedReadCalls);
	const jellyfinRequests = requests.filter((request) =>
		request.url.pathname.startsWith("/jellyfin/"),
	);
	assert.equal(jellyfinRequests.length, 3);
	for (const request of jellyfinRequests) {
		assert.equal(request.headers["x-emby-token"], undefined);
		assert.equal(request.headers["x-mediabrowser-token"], undefined);
		assert.equal(request.url.searchParams.has("ApiKey"), false);
		assert.equal(request.url.searchParams.has("api_key"), false);
	}
	assert.ok(
		requests.some(
			(request) => request.url.pathname === "/radarr/api/v3/wanted/missing",
		),
	);
	const beforeBrowse = requests.length;
	const page = await client.callTool({
		name: "library_list",
		arguments: { services: ["sonarr"], page: 1, pageSize: 1 },
	});
	assert.equal(page.structuredContent.ok, true, JSON.stringify(page));
	assert.deepEqual(JSON.parse(page.content[0].text), page.structuredContent);
	assert.equal(page.structuredContent.data.total, 1500);
	assert.equal(page.structuredContent.data.items.length, 1);
	assert.equal(page.structuredContent.data.items[0].complete, true);
	assert.equal(page.structuredContent.data.complete, false);
	assert.equal(page.structuredContent.data.pageComplete, true);
	assert.equal(page.structuredContent.data.coverage.indexComplete, true);
	assert.deepEqual(
		requests.slice(beforeBrowse).map(({ url }) => url.pathname),
		[
			"/sonarr/api/v3/series",
			"/sonarr/api/v3/tag",
			"/sonarr/api/v3/series/1",
			"/sonarr/api/v3/episodefile",
			"/sonarr/api/v3/episode",
		],
	);
	const beforeDeniedMutation = requests.length;
	partialJellyfin = true;
	const partial = await client.callTool({
		name: "library_list",
		arguments: { services: ["jellyfin"], page: 1, pageSize: 1 },
	});
	assert.equal(partial.structuredContent.ok, true);
	assert.deepEqual(
		JSON.parse(partial.content[0].text),
		partial.structuredContent,
	);
	assert.deepEqual(
		partial.structuredContent.data.items.map(({ id }) => id),
		["fixture-movie"],
	);
	assert.equal(partial.structuredContent.data.total, 1);
	assert.equal(partial.structuredContent.data.complete, false);
	assert.equal(partial.structuredContent.data.pageComplete, false);
	assert.equal(partial.structuredContent.data.coverage.indexComplete, false);
	assert.equal(partial.structuredContent.data.errors[0].count, 1);
	assert.equal(requests.length, beforeDeniedMutation + 1);
	const beforeFinalDeniedMutation = requests.length;
	for (const request of requests.filter((request) =>
		request.url.pathname.endsWith("queue"),
	)) {
		assert.equal(request.url.searchParams.get("pageSize"), "1");
		assert.equal(
			request.url.searchParams.get("includeUnknownSeriesItems") ??
				request.url.searchParams.get("includeUnknownMovieItems"),
			"true",
		);
	}
	const denied = await client.callTool({
		name: "remove_content",
		arguments: {
			service: "radarr",
			target: "library",
			ids: [7],
			dryRun: false,
			deleteFiles: true,
		},
	});
	assert.equal(denied.isError, true);
	assert.match(
		denied.structuredContent.error.message,
		/Authenticated human approval/,
	);
	assert.equal(requests.length, beforeFinalDeniedMutation);
	assert.match(
		stderr,
		/Registered service/,
		"Startup/debug stderr must actually be captured",
	);
	for (const pair of Object.values(expected))
		for (const value of [pair.id, pair.secret])
			assert.equal(
				stderr.includes(value),
				false,
				"Credential leaked to debug/startup stderr",
			);
});

test("actual CLI startup rejects malformed Access configuration without credential disclosure", () => {
	const id = "startup-wire-private-id.access";
	const env = {
		...isolatedEnv(),
		SONARR_URL: "https://unused.invalid",
		SONARR_API_KEY: "synthetic-provider",
		SONARR_CF_ACCESS_CLIENT_ID: id,
	};
	const result = spawnSync(process.execPath, [entry], {
		env,
		encoding: "utf8",
		timeout: 10000,
	});
	assert.notEqual(result.status, 0);
	assert.equal(result.error, undefined);
	assert.match(result.stderr, /Cloudflare Access/);
	assert.equal(`${result.stdout}${result.stderr}`.includes(id), false);
});
