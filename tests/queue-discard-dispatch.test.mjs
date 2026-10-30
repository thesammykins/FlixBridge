import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalStore } from "../dist/approval/store.js";
import { createInternalError } from "../dist/core.js";
import { ArrMcpServer } from "../dist/index.js";
import { serviceRegistry } from "../dist/services/registry.js";

async function fixture(t, service = "sonarr") {
	const env = { ...process.env };
	const fetch = globalThis.fetch;
	for (const key of Object.keys(process.env))
		if (/SONARR|RADARR|SABNZBD|PLEX|JELLYFIN|FLIX_BRIDGE/.test(key))
			delete process.env[key];
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "discard-dispatch-")),
	);
	process.env.FLIX_BRIDGE_STATE_DIR = directory;
	process.env.FLIX_BRIDGE_QUEUE_DISCARD_POLICY = JSON.stringify({
		version: 1,
		services: [service],
		downloadRoots: ["/downloads"],
		maxItems: 50,
	});
	process.env[`${service.toUpperCase()}_URL`] = "http://fixture.invalid/base";
	process.env[`${service.toUpperCase()}_API_KEY`] = "synthetic-key";
	const row = {
		id: 7,
		title: "Rejected",
		status: "completed",
		size: 100,
		sizeleft: 0,
		trackedDownloadState: "importBlocked",
		trackedDownloadStatus: "warning",
		seriesId: 11,
		movieId: 11,
		episodeId: 111,
		seasonNumber: 1,
		downloadClient: "SABnzbd",
		downloadId: "job",
		outputPath: "/downloads/job",
	};
	const state = {
		rows: [row],
		deletes: [],
		candidates: [],
		roots: [{ id: 1, path: "/library" }],
		libraryPaths: [],
		unknownRows: [],
		deleteStatus: 204,
	};
	globalThis.fetch = async (input, options) => {
		const url = new URL(input);
		assert.equal(url.origin, "http://fixture.invalid");
		if (options.method === "DELETE") {
			state.deletes.push({ url, body: options.body });
			if (state.deleteStatus === 204)
				state.rows = state.rows.filter(
					(r) =>
						r.downloadId !==
						state.rows.find(
							(r) => r.id === Number(url.pathname.split("/").at(-1)),
						)?.downloadId,
				);
			return new Response(null, { status: state.deleteStatus });
		}
		if (url.pathname.endsWith("/queue")) {
			const unknownFlag =
				service === "sonarr"
					? "includeUnknownSeriesItems"
					: "includeUnknownMovieItems";
			const rows = [
				...state.rows,
				...(url.searchParams.get(unknownFlag) === "true"
					? state.unknownRows
					: []),
			];
			return Response.json({
				records: rows,
				totalRecords: state.total ?? rows.length,
			});
		}
		if (url.pathname.endsWith("/series") || url.pathname.endsWith("/movie"))
			return Response.json(state.libraryPaths);
		if (url.pathname.endsWith("/rootfolder")) return Response.json(state.roots);
		if (url.pathname.endsWith("/manualimport"))
			return state.importStatus
				? new Response(null, { status: state.importStatus })
				: Response.json(state.candidates);
		throw new Error(`Unexpected request ${url.pathname}`);
	};
	serviceRegistry.clear();
	const app = new ArrMcpServer();
	app.initialize({
		services: {
			[service]: {
				baseUrl: "http://fixture.invalid/base",
				apiKey: "synthetic-key",
			},
		},
	});
	t.after(async () => {
		serviceRegistry.clear();
		globalThis.fetch = fetch;
		process.env = env;
		await rm(directory, { recursive: true, force: true });
	});
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
	const preview = async (extra = {}) => {
		const result = await app.callTool("remove_content", {
			...args,
			...extra,
			dryRun: true,
		});
		assert.equal(result.ok, true, JSON.stringify(result));
		return result.data.confirmationToken;
	};
	return { app, state, args, preview, directory };
}

for (const change of [
	{ status: "downloading" },
	{ status: "paused" },
	{ status: "queued" },
	{ status: "unknown" },
	{ trackedDownloadStatus: "ok" },
	{ trackedDownloadStatus: "mystery" },
	{ trackedDownloadState: "downloading" },
	{ sizeleft: 0.1 },
	{ downloadId: undefined },
	{ downloadClient: undefined },
	{ outputPath: "/downloads-other/job" },
	{ outputPath: "/downloads/../library/job" },
	{ outputPath: "/library/job" },
	{ outputPath: "/downloads" },
	{ outputPath: "relative/job" },
])
	test(`unknown, healthy or unsafe queue evidence denied: ${JSON.stringify(change)}`, async (t) => {
		const f = await fixture(t);
		Object.assign(f.state.rows[0], change);
		await denied(f);
	});
test("incomplete or ambiguous queue coverage cannot authorize discard", async (t) => {
	const f = await fixture(t);
	for (const total of [0, 2]) {
		f.state.total = total;
		const result = await f.app.callTool("remove_content", {
			...f.args,
			dryRun: true,
		});
		assert.equal(result.ok, false);
	}
	delete f.state.total;
	f.state.rows.push({ ...f.state.rows[0] });
	assert.equal(
		(await f.app.callTool("remove_content", { ...f.args, dryRun: true })).ok,
		false,
	);
	assert.equal(f.state.deletes.length, 0);
});
test("failed or malformed manual import inspection is unknown and blocks discard", async (t) => {
	const f = await fixture(t);
	f.state.importStatus = 503;
	await denied(f);
	f.state.importStatus = undefined;
	f.state.candidates = { bad: true };
	await denied(f);
});
test("safe uniquely mapped manual imports retain their source", async (t) => {
	const f = await fixture(t);
	f.state.candidates = [
		{
			id: 1,
			path: "/downloads/job/file.mkv",
			downloadId: "job",
			series: { id: 11 },
			seasonNumber: 1,
			episodes: [{ id: 111 }],
			rejections: [],
			quality: { quality: { id: 1 } },
		},
	];
	const service = serviceRegistry.get("sonarr");
	assert.equal(
		(await service.previewManualImport([7])).data.items[0].safeToImport,
		true,
	);
	await denied(f);
});
test("unselected same-job sibling is never silently widened", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({ ...f.state.rows[0], id: 8, episodeId: 112 });
	await denied(f);
});
test("policy manual import inspection may exceed the ordinary five second timeout", async (t) => {
	const f = await fixture(t);
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		if (new URL(input).pathname.endsWith("/manualimport"))
			await new Promise((resolve) => setTimeout(resolve, 5100));
		return fetch(input, options);
	};
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: true,
	});
	assert.equal(
		result.data.queueDiscardPolicy?.eligible,
		true,
		JSON.stringify(result.data.queueDiscardPolicy),
	);
	assert.equal(f.state.deletes.length, 0);
});

test("policy candidate inspection retains its finite configured timeout", async (t) => {
	const f = await fixture(t);
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		if (new URL(input).pathname.endsWith("/manualimport"))
			await new Promise((resolve) => setTimeout(resolve, 1200));
		return fetch(input, options);
	};
	const result = await f.app.callTool("remove_content", {
		...f.args,
		queueTimeoutMs: 1000,
		dryRun: true,
	});
	assert.equal(result.data.queueDiscardPolicy?.eligible, false);
	assert.match(
		result.data.queueDiscardPolicy.error.message,
		/timeout after 1000ms/,
	);
	assert.equal(f.state.deletes.length, 0);
	await assert.rejects(readFile(join(f.directory, "queue-discard.json")), {
		code: "ENOENT",
	});
});

test("complete library path inventory above ordinary HTTP budget remains usable only for policy safety reads", async (t) => {
	const f = await fixture(t);
	f.state.libraryPaths = [
		{
			id: 11,
			path: "/library/synthetic-title",
			providerMetadata: "x".repeat(9 * 1024 * 1024),
		},
	];
	const preview = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: true,
	});
	assert.equal(
		preview.data.queueDiscardPolicy?.eligible,
		true,
		JSON.stringify(preview.data.queueDiscardPolicy),
	);
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken: preview.data.confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletes.length, 1);
	const { arrReader } = await import("../dist/library/arr.js");
	const read = await arrReader("sonarr", {
		baseUrl: "http://fixture.invalid/base",
		apiKey: "synthetic-key",
	});
	await assert.rejects(
		read("series"),
		(error) => error.message === "HTTP response exceeds size limit",
	);
});

for (const invalidInventory of [
	[{ id: 11, path: "relative/path" }],
	[
		{ id: 11, path: "/library/one" },
		{ id: 11, path: "/library/two" },
	],
])
	test("larger inventory budget does not waive path or identity validation", async (t) => {
		const f = await fixture(t);
		f.state.libraryPaths = invalidInventory.map((item, index) => ({
			...item,
			providerMetadata: index === 0 ? "x".repeat(9 * 1024 * 1024) : "",
		}));
		const preview = await f.app.callTool("remove_content", {
			...f.args,
			dryRun: true,
		});
		assert.equal(preview.data.queueDiscardPolicy?.eligible, false);
		assert.equal(f.state.deletes.length, 0);
	});

for (const failure of [401, "oversized"])
	test(`inventory failure after preview blocks execution before a claim: ${failure}`, async (t) => {
		const f = await fixture(t);
		f.state.libraryPaths = [
			{
				id: 11,
				path: "/library/synthetic-title",
				providerMetadata: "x".repeat(9 * 1024 * 1024),
			},
		];
		const confirmationToken = await f.preview();
		const fetch = globalThis.fetch;
		globalThis.fetch = async (input, options) => {
			if (new URL(input).pathname.endsWith("/series")) {
				if (failure === 401) return new Response(null, { status: 401 });
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(64 * 1024 * 1024 + 1));
							controller.close();
						},
					}),
				);
			}
			return fetch(input, options);
		};
		await assert.rejects(
			f.app.callTool("remove_content", {
				...f.args,
				dryRun: false,
				confirmationToken,
			}),
			(error) =>
				failure === 401
					? error.status === 401
					: error.message === "HTTP response exceeds size limit",
		);
		assert.equal(f.state.deletes.length, 0);
		await assert.rejects(
			readFile(join(f.directory, "queue-discard.json"), "utf8"),
			{ code: "ENOENT" },
		);
	});

test("reversed sibling IDs retain exact policy eligibility and execute one physical removal", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({ ...f.state.rows[0], id: 8, episodeId: 112 });
	const args = { ...f.args, ids: [8, 7] };
	const preview = await f.app.callTool("remove_content", {
		...args,
		dryRun: true,
	});
	assert.equal(preview.data.queueDiscardPolicy?.eligible, true);
	const result = await f.app.callTool("remove_content", {
		...args,
		dryRun: false,
		confirmationToken: preview.data.confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletes.length, 1);
	assert.equal(f.state.rows.length, 0);
});

test("one physical shared download is deleted once and uncertain attempt cannot retry a sibling or fresh preview", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({ ...f.state.rows[0], id: 8, episodeId: 112 });
	f.state.deleteStatus = 503;
	const confirmationToken = await f.preview({ ids: [7, 8] });
	const result = await f.app.callTool("remove_content", {
		...f.args,
		ids: [7, 8],
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(result.data.executionState, "uncertain");
	assert.equal(f.state.deletes.length, 1);
	const fresh = await f.preview({ ids: [7, 8] });
	const replay = await f.app.callTool("remove_content", {
		...f.args,
		ids: [7, 8],
		dryRun: false,
		confirmationToken: fresh,
	});
	assert.equal(replay.ok, false);
	assert.match(JSON.stringify(replay), /consumed|replay/);
	assert.equal(f.state.deletes.length, 1);
});
test("two independent physical jobs execute without binding volatile ETA", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "job2",
		outputPath: "/downloads/job2",
	});
	const confirmationToken = await f.preview({ ids: [7, 8] });
	f.state.rows[0].estimatedCompletionTime = "2099-01-01T00:00:00Z";
	const result = await f.app.callTool("remove_content", {
		...f.args,
		ids: [7, 8],
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletes.length, 2);
});
test("original preview binds policy, instance configuration and literal source path", async (t) => {
	const f = await fixture(t);
	for (const drift of [
		() => {
			f.state.rows[0].outputPath = "/downloads/job/";
		},
		() => {
			process.env.SONARR_API_KEY = "rotated-synthetic-key";
		},
		() => {
			const p = JSON.parse(process.env.FLIX_BRIDGE_QUEUE_DISCARD_POLICY);
			p.maxItems--;
			process.env.FLIX_BRIDGE_QUEUE_DISCARD_POLICY = JSON.stringify(p);
		},
	]) {
		const confirmationToken = await f.preview();
		drift();
		await assert.rejects(
			f.app.callTool("remove_content", {
				...f.args,
				dryRun: false,
				confirmationToken,
			}),
			(error) => /changed|preparation/.test(error.message),
		);
		assert.equal(f.state.deletes.length, 0);
	}
});
test("per-DELETE boundary revalidates a later original job after the first deletion", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "job2",
		outputPath: "/downloads/job2",
	});
	const confirmationToken = await f.preview({ ids: [7, 8] });
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		const response = await fetch(input, options);
		if (options.method === "DELETE")
			f.state.rows[0].trackedDownloadState = "downloading";
		return response;
	};
	const result = await f.app.callTool("remove_content", {
		...f.args,
		ids: [7, 8],
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(result.data.executionState, "partial");
	assert.equal(f.state.deletes.length, 1);
});

async function denied(f, overrides = {}) {
	const confirmationToken = await f.preview(overrides);
	let result;
	try {
		result = await f.app.callTool("remove_content", {
			...f.args,
			...overrides,
			dryRun: false,
			confirmationToken,
		});
	} catch (error) {
		assert.match(error.message, /policy|approval|token|Options|IDs|dry run/i);
	}
	if (result) assert.equal(result.ok, false, JSON.stringify(result));
	assert.equal(f.state.deletes.length, 0);
}

test("trailing source separator binds literally but cannot authorize the download root itself", async (t) => {
	const f = await fixture(t);
	f.state.rows[0].outputPath = "/downloads/";
	await denied(f);
});

test("operator download roots may end with a separator and contain nested source directories", async (t) => {
	const f = await fixture(t);
	process.env.FLIX_BRIDGE_QUEUE_DISCARD_POLICY = JSON.stringify({
		version: 1,
		services: ["sonarr"],
		downloadRoots: ["/downloads/"],
		maxItems: 50,
	});
	f.state.rows[0].outputPath = "/downloads/job/";
	const confirmationToken = await f.preview();
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletes.length, 1);
});

test("healthy physical sibling with a trailing separator alias stays protected", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "other-job",
		outputPath: "/downloads/job/",
		status: "downloading",
		trackedDownloadState: "downloading",
	});
	await denied(f);
});
test("source deletion cannot encompass a healthy nested queue download", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "healthy-nested-job",
		outputPath: "/downloads/job/nested",
		status: "downloading",
		trackedDownloadState: "downloading",
	});
	await denied(f);
});
test("all configured ARR library roots protect source paths, not only selected service roots", async (t) => {
	const f = await fixture(t);
	process.env.RADARR_URL = "http://fixture.invalid/other";
	process.env.RADARR_API_KEY = "synthetic-other";
	serviceRegistry.register("radarr", {
		baseUrl: "http://fixture.invalid/other",
		apiKey: "synthetic-other",
	});
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) =>
		new URL(input).pathname === "/other/api/v3/rootfolder"
			? Response.json([{ id: 1, path: "/downloads/job" }])
			: fetch(input, options);
	await denied(f);
});
for (const service of ["sonarr", "radarr"])
	test(`${service} unresolved-title active siblings omitted by default queue totals block discard`, async (t) => {
		const f = await fixture(t, service);
		f.state.unknownRows.push({
			...f.state.rows[0],
			id: 8,
			seriesId: undefined,
			movieId: undefined,
			status: "downloading",
			trackedDownloadState: "downloading",
			trackedDownloadStatus: "ok",
		});
		await denied(f);
	});
test("registered library paths outside ARR configured root folders remain protected", async (t) => {
	const f = await fixture(t);
	f.state.libraryPaths = [{ id: 11, path: "/downloads/job" }];
	await denied(f);
});
test("untouched independent jobs remain repairable after a batch boundary failure", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "job2",
		outputPath: "/downloads/job2",
	});
	const confirmationToken = await f.preview({ ids: [7, 8] });
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		const response = await fetch(input, options);
		if (options.method === "DELETE")
			f.state.rows[0].trackedDownloadState = "downloading";
		return response;
	};
	assert.equal(
		(
			await f.app.callTool("remove_content", {
				...f.args,
				ids: [7, 8],
				dryRun: false,
				confirmationToken,
			})
		).ok,
		false,
	);
	globalThis.fetch = fetch;
	f.state.rows[0].trackedDownloadState = "importBlocked";
	const fresh = await f.preview({ ids: [8] });
	const result = await f.app.callTool("remove_content", {
		...f.args,
		ids: [8],
		dryRun: false,
		confirmationToken: fresh,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(f.state.deletes.length, 2);
});
test("public queue listing includes unresolved-title rows instead of advertising a filtered whole queue", async (t) => {
	const f = await fixture(t);
	f.state.unknownRows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "unknown-job",
		outputPath: "/downloads/unknown-job",
	});
	const result = await f.app.callTool("queue_list", {
		service: "sonarr",
		page: 1,
		pageSize: 1000,
	});
	assert.equal(result.data.total, 2);
	assert.equal(result.data.includesUnknownItems, true);
});
test("filtered queue disappearance is not policy verification if unresolved rows remain", async (t) => {
	const f = await fixture(t);
	const confirmationToken = await f.preview();
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		if (options.method === "DELETE") {
			f.state.deletes.push({ url: new URL(input), body: options.body });
			f.state.unknownRows = f.state.rows;
			f.state.rows = [];
			return new Response(null, { status: 204 });
		}
		return fetch(input, options);
	};
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(result.data.queueRemovalVerified, false);
	assert.equal(result.data.executionState, "uncertain");
	assert.equal(f.state.deletes.length, 1);
});
test("executor exceptions before any DELETE leave untouched jobs unreserved with truthful requested/verified fields", async (t) => {
	const f = await fixture(t);
	const confirmationToken = await f.preview();
	serviceRegistry.get("sonarr").executeRemoval = async () => {
		throw new Error("synthetic executor crash");
	};
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(result.data.queueRemovalRequested, true);
	assert.equal(result.data.queueRemovalVerified, false);
	assert.equal(result.data.filesDeletionRequested, false);
	assert.equal(result.data.filesDeletionVerified, false);
	assert.equal(result.data.sourceCleanupRequested, true);
	assert.equal(result.data.sourceCleanupVerified, false);
	assert.equal(result.data.executionState, "uncertain");
	assert.equal(f.state.deletes.length, 0);
	assert.deepEqual(result.data.policyClaimIds, []);
	assert.equal(result.data.policyClaimState, "none");
	assert.equal(result.error.message.includes("claim consumed"), false);
	await assert.rejects(
		readFile(join(f.directory, "queue-discard.json"), "utf8"),
		{ code: "ENOENT" },
	);
});
test("a later persisted but unacknowledged claim remains unknown despite an earlier confirmed claim", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "job-two",
		outputPath: "/downloads/job-two",
	});
	f.args.ids = [7, 8];
	const confirmationToken = await f.preview();
	const claim = ApprovalStore.prototype.claimPolicy;
	let calls = 0;
	ApprovalStore.prototype.claimPolicy = async function (...args) {
		const record = await claim.apply(this, args);
		if (++calls === 2)
			throw createInternalError(
				"Synthetic failure after durable claim publication",
			);
		return record;
	};
	t.after(() => {
		ApprovalStore.prototype.claimPolicy = claim;
	});
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(f.state.deletes.length, 1);
	assert.equal(result.data.policyClaimIds.length, 1);
	assert.equal(
		JSON.parse(await readFile(join(f.directory, "queue-discard.json"), "utf8"))
			.records.length,
		2,
	);
	assert.equal(result.data.policyClaimState, "unknown");
});

test("outcome storage failure preserves per-target execution and complete readback observations", async (t) => {
	const f = await fixture(t);
	f.state.rows.push({
		...f.state.rows[0],
		id: 8,
		downloadId: "job-two",
		outputPath: "/downloads/job-two",
	});
	f.args.ids = [7, 8];
	const confirmationToken = await f.preview();
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		if (options.method === "DELETE" && new URL(input).pathname.endsWith("/8")) {
			f.state.deletes.push({ url: new URL(input), body: options.body });
			return new Response(null, { status: 403 });
		}
		return fetch(input, options);
	};
	const finish = ApprovalStore.prototype.finish;
	ApprovalStore.prototype.finish = async () => {
		throw createInternalError("Synthetic outcome storage unavailable");
	};
	t.after(() => {
		ApprovalStore.prototype.finish = finish;
	});
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, false);
	assert.equal(result.data.policyResultFinalizationVerified, false);
	assert.equal(result.data.executionState, "uncertain");
	assert.equal(f.state.deletes.length, 2);
	assert.equal(
		result.data.result?.details?.find((item) => item.id === 7)?.status,
		"removed",
	);
	assert.equal(
		result.data.result?.details?.find((item) => item.id === 8)?.status,
		"failed",
	);
	assert.equal(result.data.queueReadback?.complete, true);
	assert.deepEqual(result.data.queueReadback?.absentIds, [7]);
	assert.equal(result.error.message, "Synthetic outcome storage unavailable");
	assert.equal(
		result.data.failureCauses.some((error) => error.status === 403),
		true,
	);
});

test("another ARR instance sharing a healthy physical job blocks single-service discard", async (t) => {
	const f = await fixture(t);
	process.env.RADARR_URL = "http://fixture.invalid/other";
	process.env.RADARR_API_KEY = "synthetic-other";
	serviceRegistry.register("radarr", {
		baseUrl: "http://fixture.invalid/other",
		apiKey: "synthetic-other",
	});
	const fetch = globalThis.fetch;
	globalThis.fetch = async (input, options) =>
		new URL(input).pathname === "/other/api/v3/queue"
			? Response.json({
					records: [
						{
							...f.state.rows[0],
							id: 91,
							status: "downloading",
							trackedDownloadState: "downloading",
						},
					],
					totalRecords: 1,
				})
			: fetch(input, options);
	await denied(f);
});
test("policy ledger binds protected-library evidence by hash without copying unrelated library paths", async (t) => {
	const f = await fixture(t);
	f.state.libraryPaths = [
		{ id: 11, path: "/private-unrelated-library/synthetic-title" },
	];
	const confirmationToken = await f.preview();
	const result = await f.app.callTool("remove_content", {
		...f.args,
		dryRun: false,
		confirmationToken,
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	const text = await readFile(join(f.directory, "queue-discard.json"), "utf8");
	assert.equal(text.includes("private-unrelated-library"), false);
	const record = JSON.parse(text).records[0];
	assert.match(
		record.plan.manifest.manifest.protectedLibraryPathsHash,
		/^[a-f0-9]{64}$/,
	);
	assert.equal(record.plan.manifest.rows[0].outputPath, "/downloads/job");
});

for (const service of ["sonarr", "radarr"])
	test(`bounded policy executes ${service} original preview with truthful source cleanup evidence`, async (t) => {
		const f = await fixture(t, service);
		const confirmationToken = await f.preview();
		const result = await f.app.callTool("remove_content", {
			...f.args,
			dryRun: false,
			confirmationToken,
		});
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(f.state.deletes.length, 1);
		assert.deepEqual(Object.fromEntries(f.state.deletes[0].url.searchParams), {
			removeFromClient: "true",
			blocklist: "false",
			skipRedownload: "false",
			changeCategory: "false",
		});
		assert.equal(f.state.deletes[0].body, undefined);
		assert.equal(result.data.authority, "queue-discard-policy");
		assert.equal(result.data.queueRemovalVerified, true);
		assert.equal(result.data.sourceCleanupRequested, true);
		assert.equal(result.data.sourceCleanupVerified, false);
		assert.equal(result.data.filesDeletionVerified, false);
		assert.equal(result.data.executionState, "completed");
		const ledger = JSON.parse(
			await readFile(join(f.directory, "queue-discard.json"), "utf8"),
		);
		assert.equal(ledger.records[0].state, "completed");
		assert.equal(ledger.records[0].actor, undefined);
	});
