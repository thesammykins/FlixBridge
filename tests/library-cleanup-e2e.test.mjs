import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ApprovalStore } from "../dist/approval/store.js";
import { ArrMcpServer } from "../dist/index.js";

async function setup(t, series = false) {
	const original = { ...process.env };
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_|SONARR_|RADARR_|PLEX_|JELLYFIN_|TMDB_)/.test(key))
			delete process.env[key];
	const state = await realpath(
		await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "library-cleanup-")),
	);
	process.env.FLIX_BRIDGE_STATE_DIR = state;
	process.env.FLIX_BRIDGE_APPROVAL_ACTORS = "test-human";
	let item = {
		id: 1,
		title: "Synthetic library",
		path: "/media/synthetic",
		monitored: true,
		status: series ? "ended" : "released",
		added: "2000-01-01T00:00:00Z",
		tags: [],
		ratings: { imdb: { value: 3, votes: 1000 } },
		...(series
			? {
					tvdbId: 100,
					seasons: [
						{ seasonNumber: 1, monitored: true },
						{ seasonNumber: 2, monitored: true },
					],
				}
			: { tmdbId: 100, hasFile: true, movieFile: { id: 21 } }),
	};
	let episodes = series
		? [1, 2].map((n) => ({
				id: 10 + n,
				seriesId: 1,
				seasonNumber: n,
				episodeNumber: 1,
				title: `Episode ${n}`,
				airDateUtc: "2001-01-01T00:00:00Z",
				hasFile: true,
				episodeFileId: 20 + n,
				monitored: true,
			}))
		: [];
	let files = (series ? [1, 2] : [1]).map((n) => ({
		id: 20 + n,
		...(series ? { seriesId: 1 } : { movieId: 1 }),
		path: `/media/synthetic/${n}.mkv`,
		size: 1000,
	}));
	const writes = [];
	const favouriteSeasons = new Set();
	let protectAfterFileDelete = false;
	let monitorReadbackFailure = false;
	const api = createServer(async (req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		const path = url.pathname;
		let body = "";
		for await (const chunk of req) body += chunk;
		const json = (value, status = 200) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(value));
		};
		if (req.method !== "GET")
			writes.push({
				method: req.method,
				path,
				body: body ? JSON.parse(body) : null,
			});
		const type = series ? "series" : "movie";
		if (path === "/base/api/v3/tag") return json([{ id: 1, label: "keep" }]);
		if (path === `/base/api/v3/${type}`) return json(item ? [{ id: 1 }] : []);
		if (path === `/base/api/v3/${type}/1`) {
			if (req.method === "PUT") {
				item = JSON.parse(body);
				return json(item);
			}
			if (req.method === "DELETE") {
				item = null;
				files = [];
				return json({});
			}
			if (!item) return json({}, 404);
			return json(monitorReadbackFailure ? { ...item, monitored: true } : item);
		}
		if (path === "/base/api/v3/episode/monitor" && req.method === "PUT") {
			const update = JSON.parse(body);
			episodes = episodes.map((e) =>
				update.episodeIds.includes(e.id)
					? { ...e, monitored: update.monitored }
					: e,
			);
			return json({});
		}
		if (path === "/base/api/v3/episode") return json(episodes);
		if (path === `/base/api/v3/${series ? "episodefile" : "moviefile"}`)
			return json(files);
		if (
			path.startsWith(
				`/base/api/v3/${series ? "episodefile" : "moviefile"}/`,
			) &&
			req.method === "DELETE"
		) {
			const id = Number(path.split("/").at(-1));
			files = files.filter((f) => f.id !== id);
			if (protectAfterFileDelete) item = { ...item, tags: [1] };
			episodes = episodes.map((e) =>
				e.episodeFileId === id ? { ...e, episodeFileId: 0, hasFile: false } : e,
			);
			if (!series) {
				item = { ...item, hasFile: false, movieFile: undefined };
			}
			return json({});
		}
		if (path === "/jelly/System/Info")
			return json({
				Id: "synthetic-jelly-server",
				ServerName: "Synthetic",
				Version: "10.10",
			});
		if (path === "/jelly/Users/alice")
			return json({ Id: "alice", Name: "Synthetic human" });
		if (path === "/jelly/Auth/Providers" || path === "/jelly/Sessions")
			return json([]);
		if (path === "/jelly/Users/alice/Items") {
			const user = {
				Played: true,
				PlayCount: 1,
				PlaybackPositionTicks: 0,
				IsFavorite: false,
				LastPlayedDate: "2002-01-01T00:00:00Z",
			};
			const rows =
				url.searchParams.get("IncludeItemTypes") === "Episode"
					? episodes.map((e) => ({
							Id: `ep-${e.id}`,
							Name: e.title,
							Type: "Episode",
							SeriesId: "root",
							ParentIndexNumber: e.seasonNumber,
							IndexNumber: e.episodeNumber,
							MediaSources: files
								.filter((file) => file.id === e.episodeFileId)
								.map((file) => ({ Id: `source-${file.id}`, Path: file.path })),
							UserData: user,
						}))
					: url.searchParams.get("IncludeItemTypes") === "Season"
						? item.seasons.map((season) => ({
								Id: `season-${season.seasonNumber}`,
								Name: "Synthetic season",
								Type: "Season",
								SeriesId: "root",
								IndexNumber: season.seasonNumber,
								UserData: {
									...user,
									IsFavorite: favouriteSeasons.has(season.seasonNumber),
								},
							}))
						: [
								{
									Id: "root",
									Name: "Synthetic",
									Type: series ? "Series" : "Movie",
									ProviderIds: series ? { Tvdb: "100" } : { Tmdb: "100" },
									MediaSources: series
										? undefined
										: files.map((file) => ({
												Id: `source-${file.id}`,
												Path: file.path,
											})),
									UserData: user,
								},
							];
			return json({
				Items: rows,
				TotalRecordCount: rows.length,
				StartIndex: 0,
			});
		}
		return json({ message: "unhandled synthetic route" }, 404);
	});
	api.listen(0, "127.0.0.1");
	await once(api, "listening");
	const origin = `http://127.0.0.1:${api.address().port}`;
	const name = series ? "sonarr" : "radarr";
	process.env[series ? "SONARR_URL" : "RADARR_URL"] = `${origin}/base`;
	process.env[series ? "SONARR_API_KEY" : "RADARR_API_KEY"] =
		"synthetic-arr-769d49";
	process.env.JELLYFIN_URL = `${origin}/jelly`;
	process.env.JELLYFIN_API_KEY = "synthetic-jelly-ec7c10";
	const server = new ArrMcpServer();
	server.initialize({
		services: {
			[name]: { baseUrl: `${origin}/base`, apiKey: "synthetic-arr-769d49" },
		},
	});
	t.after(async () => {
		await new Promise((r) => api.close(r));
		await rm(state, { recursive: true, force: true });
		process.env = original;
	});
	const execute = async (args) => {
		const request = await server.callTool("request_approval", {
			tool: "remove_content",
			arguments: args,
		});
		assert.equal(request.ok, true, JSON.stringify(request));
		const store = new ApprovalStore(state);
		await store.decide(
			{
				requestId: request.data.id,
				planHash: request.data.planHash,
				actor: "test-human",
				decision: "yes",
				nonce: randomUUID(),
			},
			true,
		);
		const result = await server.callTool("remove_content", {
			...args,
			dryRun: false,
			approvalId: request.data.id,
		});
		return { result, approval: await store.get(request.data.id) };
	};
	return {
		server,
		execute,
		writes,
		name,
		get item() {
			return item;
		},
		get episodes() {
			return episodes;
		},
		get files() {
			return files;
		},
		driftFile() {
			files = files.map((file) => ({
				...file,
				path: "/media/synthetic/replacement.mkv",
			}));
		},
		driftAllFileIds() {
			files = files.map((file) => ({ ...file, id: file.id + 100 }));
			episodes = episodes.map((episode) => ({
				...episode,
				episodeFileId: episode.episodeFileId + 100,
			}));
		},
		favouriteSeason(number) {
			favouriteSeasons.add(number);
		},
		protectTag() {
			item = { ...item, tags: [1] };
		},
		protectTagAfterNextFileDelete() {
			protectAfterFileDelete = true;
		},
		protectSeason() {
			favouriteSeasons.add(1);
		},
		failMonitoring() {
			monitorReadbackFailure = true;
		},
	};
}

test("approved movie-file cleanup verifies unmonitoring before deletion and keeps ARR metadata", async (t) => {
	const f = await setup(t);
	const { result, approval } = await f.execute({
		service: f.name,
		target: "files",
		itemId: 1,
		ids: [21],
		deleteFiles: true,
		users: [{ server: "jellyfin", userId: "alice" }],
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(approval.state, "completed");
	assert.equal(f.item.monitored, false);
	assert.equal(f.files.length, 0);
	assert.deepEqual(
		f.writes.map((w) => w.method),
		["PUT", "DELETE"],
	);
});

test("approved watched-season cleanup removes only that season and preserves later monitoring", async (t) => {
	const f = await setup(t, true);
	const { result, approval } = await f.execute({
		service: f.name,
		target: "season",
		ids: [1],
		seasonNumbers: [1],
		deleteFiles: true,
		users: [{ server: "jellyfin", userId: "alice" }],
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(approval.state, "completed");
	assert.equal(f.item.monitored, true);
	assert.equal(f.item.seasons[0].monitored, false);
	assert.equal(f.item.seasons[1].monitored, true);
	assert.equal(f.episodes[0].monitored, false);
	assert.equal(f.episodes[1].monitored, true);
	assert.deepEqual(
		f.files.map((f) => f.id),
		[22],
	);
	assert.deepEqual(
		f.writes.map((w) => [w.method, w.path]),
		[
			["PUT", "/base/api/v3/series/1"],
			["PUT", "/base/api/v3/episode/monitor"],
			["DELETE", "/base/api/v3/episodefile/21"],
		],
	);
});

test("actual Jellyfin sibling-season favourites do not broaden approved season-one scope", async (t) => {
	const f = await setup(t, true);
	f.favouriteSeason(2);
	const { result, approval } = await f.execute({
		service: f.name,
		target: "season",
		ids: [1],
		seasonNumbers: [1],
		deleteFiles: true,
		users: [{ server: "jellyfin", userId: "alice" }],
	});
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.equal(approval.state, "completed");
	assert.deepEqual(
		f.files.map((file) => file.id),
		[22],
	);
	assert.equal(f.item.seasons[1].monitored, true);
});

test("a replacement file installed immediately after the durable claim is never adopted or deleted", async (t) => {
	const f = await setup(t);
	const claim = ApprovalStore.prototype.claim;
	ApprovalStore.prototype.claim = async function (...args) {
		const result = await claim.apply(this, args);
		f.driftFile();
		return result;
	};
	try {
		const { result, approval } = await f.execute({
			service: f.name,
			target: "files",
			itemId: 1,
			ids: [21],
			deleteFiles: true,
			users: [{ server: "jellyfin", userId: "alice" }],
		});
		assert.equal(result.ok, false);
		assert.equal(approval.state, "uncertain");
		assert.equal(f.writes.length, 0);
		assert.equal(f.files.length, 1);
	} finally {
		ApprovalStore.prototype.claim = claim;
	}
});

for (const drift of ["driftAllFileIds", "driftFile", "protectSeason"]) {
	test(`whole-title deletion rejects post-claim ${drift} while title and file counts remain unchanged`, async (t) => {
		const f = await setup(t, true);
		const claim = ApprovalStore.prototype.claim;
		ApprovalStore.prototype.claim = async function (...args) {
			const result = await claim.apply(this, args);
			f[drift]();
			return result;
		};
		try {
			const { result, approval } = await f.execute({
				service: f.name,
				target: "library",
				ids: [1],
				deleteFiles: true,
				manualImport: false,
				users: [{ server: "jellyfin", userId: "alice" }],
			});
			assert.equal(result.ok, false);
			assert.notEqual(approval.state, "completed");
			assert.equal(f.writes.length, 0);
			assert.equal(f.files.length, 2);
			assert.notEqual(f.item, null);
		} finally {
			ApprovalStore.prototype.claim = claim;
		}
	});
}
test("whole-title deletion still executes an unchanged human-approved complete file manifest", async (t) => {
	const f = await setup(t, true);
	const { result, approval } = await f.execute({
		service: f.name,
		target: "library",
		ids: [1],
		deleteFiles: true,
		manualImport: false,
		users: [{ server: "jellyfin", userId: "alice" }],
	});
	assert.equal(result.ok, true);
	assert.equal(approval.state, "completed");
	assert.equal(f.item, null);
	assert.equal(f.files.length, 0);
});

for (const afterFirstFile of [false, true]) {
	test(`rule-protected tag drift ${afterFirstFile ? "during the batch" : "after claim"} stops file cleanup`, async (t) => {
		const f = await setup(t, afterFirstFile);
		const evaluationTime = new Date().toISOString();
		const users = [{ server: "jellyfin", userId: "alice" }];
		const rule = {
			services: [f.name],
			users,
			target: afterFirstFile ? "show" : "movie",
			action: "unmonitor-delete-files",
			minSizeBytes: 1,
			minAddedAgeDays: 30,
			watchGraceDays: 7,
			minInactiveDays: 14,
			protectedTags: ["keep"],
			maxCount: 1,
			maxBytes: 10000,
		};
		await f.server.callTool("retention_rules", {
			operation: "create",
			id: "tag-protection",
			name: "Tag protection",
			rule,
			evaluationTime,
		});
		await f.server.callTool("retention_rules", {
			operation: "revise",
			id: "tag-protection",
			expectedVersion: 1,
			enabled: true,
			evaluationTime,
		});
		const claim = ApprovalStore.prototype.claim;
		if (afterFirstFile) f.protectTagAfterNextFileDelete();
		else
			ApprovalStore.prototype.claim = async function (...args) {
				const result = await claim.apply(this, args);
				f.protectTag();
				return result;
			};
		try {
			const { result, approval } = await f.execute({
				service: f.name,
				target: "files",
				itemId: 1,
				ids: afterFirstFile ? [21, 22] : [21],
				deleteFiles: true,
				users,
				allowUnsupportedFavourites: false,
				watchedPolicy: "all-selected",
				retentionRuleId: "tag-protection",
				retentionRuleVersion: 2,
			});
			assert.equal(result.ok, false);
			assert.notEqual(approval.state, "completed");
			assert.equal(f.files.length, 1);
			assert.equal(
				f.writes.filter((write) => write.method === "DELETE").length,
				afterFirstFile ? 1 : 0,
			);
		} finally {
			ApprovalStore.prototype.claim = claim;
		}
	});
}

test("the actual interval CLI deduplicates pending and rejected human requests without deleting", async (t) => {
	const f = await setup(t);
	const now = Date.now();
	const at = new Date(now).toISOString();
	const rule = {
		services: [f.name],
		users: [{ server: "jellyfin", userId: "alice" }],
		target: "movie",
		action: "unmonitor-delete-files",
		minSizeBytes: 1,
		minAddedAgeDays: 30,
		watchGraceDays: 7,
		minInactiveDays: 14,
		protectedTags: [],
		maxCount: 1,
		maxBytes: 10000,
		intervalHours: 1,
	};
	await f.server.callTool("retention_rules", {
		operation: "create",
		id: "old-movies",
		name: "Old movies",
		rule,
		evaluationTime: at,
	});
	await f.server.callTool("retention_rules", {
		operation: "revise",
		id: "old-movies",
		expectedVersion: 1,
		enabled: true,
		evaluationTime: at,
	});
	const env = Object.fromEntries(
		[
			"PATH",
			"RADARR_URL",
			"RADARR_API_KEY",
			"JELLYFIN_URL",
			"JELLYFIN_API_KEY",
			"FLIX_BRIDGE_STATE_DIR",
			"FLIX_BRIDGE_APPROVAL_ACTORS",
		].map((key) => [key, process.env[key]]),
	);
	const run = async (time) =>
		JSON.parse(
			(
				await promisify(execFile)(
					process.execPath,
					[
						"dist/cli.js",
						"run-due",
						"--request-approval",
						"--at",
						new Date(time).toISOString(),
					],
					{ env, timeout: 15000 },
				)
			).stdout,
		);
	const first = await run(now);
	assert.equal(first.ok, true);
	assert.equal(first.data[0].status, "completed");
	const request = first.data[0].result.requests[0].data;
	assert.equal(request.state, "pending");
	assert.equal(request.newRequest, true);
	assert.deepEqual((await run(now)).data, []);
	const pending = (await run(now + 3600000)).data[0].result.requests[0].data;
	assert.equal(pending.id, request.id);
	assert.equal(pending.newRequest, false);
	const store = new ApprovalStore();
	await store.decide(
		{
			requestId: request.id,
			planHash: request.planHash,
			actor: "test-human",
			decision: "no",
			nonce: randomUUID(),
		},
		true,
	);
	const rejected = (await run(now + 7200000)).data[0].result.requests[0].data;
	assert.equal(rejected.id, request.id);
	assert.equal(rejected.state, "rejected");
	assert.equal(rejected.newRequest, false);
	await assert.rejects(
		promisify(execFile)(
			process.execPath,
			["dist/cli.js", "execute", "--request", request.id],
			{ env, timeout: 15000 },
		),
		(error) => error.code === 1,
	);
	assert.equal((await store.get(request.id)).state, "rejected");
	assert.equal(f.writes.length, 0);
	assert.equal(f.files.length, 1);
});

test("monitoring readback failure consumes approval and stops before deleting any file", async (t) => {
	const f = await setup(t);
	f.failMonitoring();
	const { result, approval } = await f.execute({
		service: f.name,
		target: "files",
		itemId: 1,
		ids: [21],
		deleteFiles: true,
		users: [{ server: "jellyfin", userId: "alice" }],
	});
	assert.equal(result.ok, false);
	assert.equal(approval.state, "uncertain");
	assert.equal(f.files.length, 1);
	assert.ok(!f.writes.some((w) => w.method === "DELETE"));
});
