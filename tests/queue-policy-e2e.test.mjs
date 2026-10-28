import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Real stdio/HTTP/owned-state boundaries; all upstream data is synthetic.
async function fixture(t, options = {}) {
	const directory = await realpath(
		await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "queue-policy-e2e-")),
	);
	const service = options.service ?? "sonarr";
	const policy = options.policy ?? {
		version: 1,
		services: [service],
		downloadRoots: ["/downloads"],
		maxItems: 50,
	};
	const state = {
		rows: [
			{
				id: 7,
				title: "Synthetic rejected completion",
				status: "completed",
				size: 100,
				sizeleft: 0,
				trackedDownloadStatus: "warning",
				trackedDownloadState: "importBlocked",
				statusMessages: [
					{ title: "Import blocked", messages: ["Rejected mapping"] },
				],
				seriesId: 11,
				episodeId: 111,
				seasonNumber: 1,
				movieId: 11,
				downloadClient: "SABnzbd",
				downloadId: "synthetic-job",
				protocol: "usenet",
				outputPath: "/downloads/synthetic-job",
			},
		],
		deletions: [],
		unknownRows: [],
		requests: [],
		manualCandidates: [],
		deleteStatus: 204,
		libraryRoot: "/library",
		rootStatus: 200,
		queueStatusAfterDelete: 200,
		libraryPaths: [{ id: 11, path: "/library/synthetic-title" }],
		totalOverride: undefined,
	};
	const upstream = createServer((req, res) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const url = new URL(req.url, "http://fixture.invalid");
			const body = Buffer.concat(chunks).toString("utf8");
			state.requests.push({
				method: req.method,
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
			});
			if (req.method === "DELETE") {
				state.deletions.push({ method: req.method, url: url.href, body });
				if (state.deleteStatus !== 204) {
					res.writeHead(state.deleteStatus).end("synthetic upstream failure");
					return;
				}
				const id = Number(url.pathname.split("/").at(-1));
				const selected = state.rows.find((row) => row.id === id);
				if (selected)
					state.rows = state.rows.filter(
						(row) => row.downloadId !== selected.downloadId,
					);
				if (selected)
					state.unknownRows = state.unknownRows.filter(
						(row) => row.downloadId !== selected.downloadId,
					);
				res.writeHead(204).end();
				return;
			}
			res.setHeader("Content-Type", "application/json");
			if (url.pathname === "/base/api/v3/queue") {
				if (state.deletions.length && state.queueStatusAfterDelete !== 200) {
					res
						.writeHead(state.queueStatusAfterDelete)
						.end("synthetic readback failure");
					return;
				}
				const includeUnknown =
					service === "sonarr"
						? "includeUnknownSeriesItems"
						: "includeUnknownMovieItems";
				const visible = [
					...state.rows,
					...(url.searchParams.get(includeUnknown) === "true"
						? state.unknownRows
						: []),
				];
				res.end(
					JSON.stringify({
						records: visible,
						totalRecords: state.totalOverride ?? visible.length,
					}),
				);
			} else if (url.pathname === "/base/api/v3/rootfolder") {
				if (state.rootStatus !== 200) {
					res
						.writeHead(state.rootStatus)
						.end(
							JSON.stringify({ message: "synthetic-private-provider-detail" }),
						);
					return;
				}
				res.end(
					JSON.stringify([{ id: 1, path: state.libraryRoot, freeSpace: 1000 }]),
				);
			} else if (url.pathname === "/base/api/v3/manualimport") {
				res.end(JSON.stringify(state.manualCandidates));
			} else if (
				["/base/api/v3/series", "/base/api/v3/movie"].includes(url.pathname)
			) {
				res.end(JSON.stringify(state.libraryPaths));
			} else {
				res
					.writeHead(404)
					.end(JSON.stringify({ message: "synthetic route not implemented" }));
			}
		});
	});
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	let client;
	const connect = async () => {
		client = new Client({ name: "queue-policy-e2e", version: "1" });
		const env = {
			PATH: process.env.PATH,
			HOME: directory,
			[`${service.toUpperCase()}_URL`]: `http://127.0.0.1:${upstream.address().port}/base`,
			[`${service.toUpperCase()}_API_KEY`]: "synthetic-policy-provider-value",
			FLIX_BRIDGE_STATE_DIR: directory,
		};
		if (options.enabled !== false)
			env.FLIX_BRIDGE_QUEUE_DISCARD_POLICY = JSON.stringify(policy);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [process.env.FLIXBRIDGE_TEST_ENTRY ?? resolve("dist/index.js")],
			env,
			stderr: "pipe",
		});
		transport.stderr?.resume();
		await client.connect(transport);
	};
	t.after(async () => {
		await client?.close();
		await new Promise((done) => upstream.close(done));
		await rm(directory, { recursive: true, force: true });
	});
	await connect();
	const call = async (name, args) => {
		const response = await client.callTool({ name, arguments: args });
		const text = JSON.parse(response.content[0].text);
		assert.deepEqual(text, response.structuredContent);
		return text;
	};
	const args = {
		service,
		target: "queue",
		ids: [7],
		manualImport: false,
		allowManualRemoval: true,
		removeFromClient: true,
		deleteFiles: false,
		blocklist: false,
		addImportExclusion: false,
		removeFromDownloader: false,
	};
	const preview = async (overrides = {}) => {
		const result = await call("remove_content", {
			...args,
			...overrides,
			dryRun: true,
		});
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(typeof result.data.confirmationToken, "string");
		return result.data.confirmationToken;
	};
	return {
		state,
		args,
		call,
		preview,
		async restart() {
			await client.close();
			await connect();
		},
	};
}

test("operator policy permits exact rejected queue discard through real MCP without human credentials", async (t) => {
	const f = await fixture(t);
	const confirmationToken = await f.preview();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletions.length, 1);
	const actual = f.state.deletions[0];
	const url = new URL(actual.url);
	assert.equal(url.pathname, "/base/api/v3/queue/7");
	assert.deepEqual(Object.fromEntries(url.searchParams), {
		removeFromClient: "true",
		blocklist: "false",
		skipRedownload: "false",
		changeCategory: "false",
	});
	assert.equal(actual.body, "");
	const remaining = await f.call("queue_list", {
		service: "sonarr",
		page: 1,
		pageSize: 100,
	});
	assert.equal(remaining.ok, true);
	assert.equal(remaining.data.total, 0);
	assert.equal(remaining.data.truncated, false);
});

test("operator-enabled bypassApproval runs exact queue maintenance without approval or confirmation tokens", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(result.data.approvalMode, "operator-policy-direct");
	assert.equal(result.data.queueRemovalVerified, true);
	assert.equal(result.data.sourceCleanupVerified, false);
	assert.equal(result.data.policyClaimIds.length, 1);
	assert.equal(f.state.deletions.length, 1);
});

test("direct eligibility retains normalized provider authentication failures without leaking bodies", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	f.state.rootStatus = 401;
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.status, 401);
	assert.equal(
		JSON.stringify(result).includes("synthetic-private-provider-detail"),
		false,
	);
	assert.equal(f.state.deletions.length, 0);
});

test("policy previews expose authentication failure instead of presenting it only as human-approval need", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	f.state.rootStatus = 401;
	const result = await f.call("remove_content", { ...f.args, dryRun: true });
	assert.equal(result.ok, true);
	assert.equal(result.data.queueDiscardPolicy?.eligible, false);
	assert.equal(result.data.queueDiscardPolicy?.error?.status, 401);
	assert.equal(f.state.deletions.length, 0);
});

test("direct execution keeps normalized DELETE failures and truthful consumed-claim status", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	f.state.deleteStatus = 403;
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.status, 403);
	assert.equal(result.data.policyClaimState, "consumed");
	assert.equal(result.data.policyClaimIds.length, 1);
	assert.equal(f.state.deletions.length, 1);
});

test("failed final readback remains visible alongside an earlier DELETE failure", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	f.state.deleteStatus = 403;
	f.state.queueStatusAfterDelete = 401;
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.status, 403);
	assert.equal(
		result.data.failureCauses.some((error) => error.status === 403),
		true,
	);
	assert.equal(
		result.data.failureCauses.some((error) => error.status === 401),
		true,
	);
	assert.equal(result.data.queueRemovalVerified, false);
	assert.equal(f.state.deletions.length, 1);
});

test("direct bypass is disabled without operator opt-in and cannot broaden to library removal", async (t) => {
	const disabled = await fixture(t);
	const denied = await disabled.call("remove_content", {
		...disabled.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(denied.ok, false);
	assert.equal(disabled.state.requests.length, 0);
	const enabled = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	const library = await enabled.call("remove_content", {
		...enabled.args,
		target: "library",
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(library.ok, false);
	assert.equal(enabled.state.requests.length, 0);
});

test("direct bypass retains read-only preview and the default token-required execution mode", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	const discovery = await f.call("list_services", {});
	assert.equal(discovery.data.queueDiscardPolicy.allowDirectExecution, true);
	const preview = await f.call("remove_content", {
		...f.args,
		dryRun: true,
		bypassApproval: true,
	});
	assert.equal(preview.ok, true);
	assert.equal(preview.data.mode, "dry_run");
	assert.equal(f.state.deletions.length, 0);
	const missing = await f.call("remove_content", { ...f.args, dryRun: false });
	assert.equal(missing.ok, false);
	assert.match(missing.error.message, /confirmationToken/);
	assert.equal(f.state.deletions.length, 0);
});

test("direct bypass rejects mixed tokens, human IDs and destructive option escalation before HTTP", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	for (const override of [
		{ confirmationToken: "not-consent" },
		{ approvalId: "00000000-0000-4000-8000-000000000001" },
		{ deleteFiles: true },
		{ blocklist: true },
		{ removeFromDownloader: true },
		{ manualImport: true },
	]) {
		const result = await f.call("remove_content", {
			...f.args,
			...override,
			dryRun: false,
			bypassApproval: true,
		});
		assert.equal(result.ok, false, JSON.stringify(override));
	}
	assert.equal(f.state.requests.length, 0);
});

test("direct Radarr execution is token-free while healthy downloads remain protected", async (t) => {
	const f = await fixture(t, {
		service: "radarr",
		policy: {
			version: 1,
			services: ["radarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletions.length, 1);
	const healthy = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	healthy.state.rows[0].status = "downloading";
	healthy.state.rows[0].sizeleft = 75;
	const denied = await healthy.call("remove_content", {
		...healthy.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(denied.ok, false);
	assert.equal(healthy.state.deletions.length, 0);
});

test("direct mode does not retry an uncertain write after a fresh process without tokens", async (t) => {
	const f = await fixture(t, {
		policy: {
			version: 1,
			services: ["sonarr"],
			downloadRoots: ["/downloads"],
			maxItems: 50,
			allowDirectExecution: true,
		},
	});
	f.state.deleteStatus = 503;
	const first = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(first.ok, false);
	assert.equal(f.state.deletions.length, 1);
	await f.restart();
	const replay = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		bypassApproval: true,
	});
	assert.equal(replay.ok, false);
	assert.equal(f.state.deletions.length, 1);
});

test("Radarr operator policy uses the same explicit query-bound queue contract", async (t) => {
	const f = await fixture(t, { service: "radarr" });
	const confirmationToken = await f.preview();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletions.length, 1);
	const actual = f.state.deletions[0];
	assert.equal(
		new URL(actual.url).searchParams.get("removeFromClient"),
		"true",
	);
	assert.equal(new URL(actual.url).searchParams.get("blocklist"), "false");
	assert.equal(actual.body, "");
});

test("disabled policy cannot be enabled by caller-supplied authority fields", async (t) => {
	const f = await fixture(t, { enabled: false });
	const confirmationToken = await f.preview();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
		unattended: true,
		autoApprove: true,
		queueDiscardPolicy: { version: 1, enabled: true },
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

for (const status of ["downloading", "paused", "queued", "unknown"]) {
	test(`healthy or unknown ${status} state is never unattended-discard authority`, async (t) => {
		const f = await fixture(t);
		f.state.rows[0] = {
			...f.state.rows[0],
			status,
			sizeleft: 75,
			trackedDownloadStatus: "ok",
			trackedDownloadState: "downloading",
		};
		const confirmationToken = await f.preview();
		const result = await f.call("remove_content", {
			...f.args,
			dryRun: false,
			confirmationToken,
		});
		assert.equal(result.ok, false);
		assert.equal(f.state.deletions.length, 0);
	});
}

test("one healthy sibling prevents discarding its shared physical download", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		episodeId: 112,
		status: "downloading",
		sizeleft: 75,
		trackedDownloadStatus: "ok",
		trackedDownloadState: "downloading",
	});
	const confirmationToken = await f.preview({ ids: [7, 8] });
	const result = await f.call("remove_content", {
		...f.args,
		ids: [7, 8],
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

test("unselected completed sibling cannot be silently included in a source-download deletion", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({ ...f.state.rows[0], id: 8, episodeId: 112 });
	const confirmationToken = await f.preview();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

for (const service of ["sonarr", "radarr"]) {
	test(`${service} policy includes unknown-title rows before excluding a healthy shared sibling`, async (t) => {
		const f = await fixture(t, { service });
		f.state.unknownRows.push({
			...f.state.rows[0],
			id: 8,
			seriesId: null,
			episodeId: null,
			movieId: null,
			status: "downloading",
			sizeleft: 75,
			trackedDownloadStatus: "ok",
			trackedDownloadState: "downloading",
		});
		const confirmationToken = await f.preview();
		const result = await f.call("remove_content", {
			...f.args,
			dryRun: false,
			confirmationToken,
		});
		assert.equal(result.ok, false);
		assert.equal(f.state.deletions.length, 0);
		assert.equal(f.state.unknownRows.length, 1);
		const key =
			service === "sonarr"
				? "includeUnknownSeriesItems"
				: "includeUnknownMovieItems";
		assert.ok(
			f.state.requests.some((request) => request.query[key] === "true"),
			"advertised total from a default filtered queue is not whole-download coverage",
		);
	});
}

for (const target of ["library", "files", "season", "downloader_queue"]) {
	test(`queue policy does not grant human-gated ${target} authority`, async (t) => {
		const f = await fixture(t);
		const confirmationToken = await f.preview();
		const result = await f.call("remove_content", {
			...f.args,
			target,
			itemId: 11,
			seasonNumbers: [1],
			downloader: "sabnzbd",
			dryRun: false,
			confirmationToken,
		});
		assert.equal(result.ok, false);
		assert.equal(f.state.deletions.length, 0);
	});
}

test("material target drift after preview cannot be replaced with a newly prepared target", async (t) => {
	const f = await fixture(t);
	const confirmationToken = await f.preview();
	f.state.rows[0].outputPath = "/downloads/different-job";
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

test("partial authoritative coverage discovered after preview prevents deletion", async (t) => {
	const f = await fixture(t);
	const confirmationToken = await f.preview();
	f.state.totalOverride = 2;
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

test("a source path overlapping an authoritative library root is not queue-discard scope", async (t) => {
	const f = await fixture(t);
	f.state.libraryRoot = "/downloads/library";
	f.state.rows[0].outputPath = "/downloads/library/fixture";
	const confirmationToken = await f.preview();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

test("a valid safe manual import prevents unattended discard", async (t) => {
	const f = await fixture(t);
	f.state.rows[0].trackedDownloadState = "importPending";
	f.state.rows[0].trackedDownloadStatus = "ok";
	f.state.rows[0].statusMessages = [];
	f.state.manualCandidates = [
		{
			id: 10,
			path: "/downloads/synthetic-job/file.mkv",
			series: { id: 11 },
			episodes: [{ id: 111 }],
			seasonNumber: 1,
			downloadId: "synthetic-job",
			rejections: [],
		},
	];
	const importPreview = await f.call("manual_import", {
		service: "sonarr",
		ids: [7],
		dryRun: true,
	});
	assert.equal(importPreview.ok, true, JSON.stringify(importPreview));
	assert.equal(
		importPreview.data.preview.summary.safe,
		1,
		JSON.stringify(importPreview),
	);
	const confirmationToken = await f.preview();
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

test("an unknown preview token cannot be substituted by a freshly generated preview", async (t) => {
	const f = await fixture(t);
	const result = await f.call("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken: "not-a-real-reviewed-token",
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletions.length, 0);
});

test("concurrent distinct previews cannot claim the same physical download twice", async (t) => {
	const f = await fixture(t);
	const tokens = [await f.preview(), await f.preview()];
	const results = await Promise.all(
		tokens.map((confirmationToken) =>
			f.call("remove_content", { ...f.args, dryRun: false, confirmationToken }),
		),
	);
	assert.equal(
		results.filter((result) => result.ok).length,
		1,
		JSON.stringify(results),
	);
	assert.equal(f.state.deletions.length, 1);
});

test("uncertain shared-job DELETE is not retried by a sibling or a new process/fresh preview", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({ ...f.state.rows[0], id: 8, episodeId: 112 });
	f.state.deleteStatus = 503;
	const args = { ...f.args, ids: [7, 8] };
	const confirmationToken = await f.preview({ ids: [7, 8] });
	await f.call("remove_content", { ...args, dryRun: false, confirmationToken });
	assert.equal(
		f.state.deletions.length,
		1,
		"uncertain source job must not receive an automatic sibling retry",
	);
	await f.restart();
	const freshToken = await f.preview({ ids: [7, 8] });
	const replay = await f.call("remove_content", {
		...args,
		dryRun: false,
		confirmationToken: freshToken,
	});
	assert.equal(replay.ok, false);
	assert.equal(
		f.state.deletions.length,
		1,
		"durable consumed job reservation must survive process restart and a new token",
	);
});
