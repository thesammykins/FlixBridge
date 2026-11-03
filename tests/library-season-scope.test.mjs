import assert from "node:assert/strict";
import { test } from "node:test";
import {
	executeLibraryAction,
	prepareLibraryAction,
} from "../dist/library/actions.js";
import { withRemovalAuthority } from "../dist/removal-authority.js";

const users = [{ server: "jellyfin", userId: "alice" }];
const input = {
	service: "sonarr",
	target: "season",
	itemId: 1,
	seasonNumbers: [1],
	deleteFiles: true,
	users,
};

function fixture(t) {
	const env = { ...process.env };
	const fetch = globalThis.fetch;
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_|SONARR_|RADARR_|PLEX_|JELLYFIN_)/.test(key))
			delete process.env[key];
	process.env.SONARR_URL = "http://127.0.0.1:19876";
	process.env.SONARR_API_KEY = "synthetic";
	t.after(() => {
		process.env = env;
		globalThis.fetch = fetch;
	});
	const item = {
		service: "sonarr",
		id: 1,
		mediaKind: "series",
		title: "Scoped series",
		providerIds: { tvdb: "100" },
		path: "/media/series",
		sizeBytes: 300,
		status: "ended",
		monitored: true,
		tags: [],
		ratings: [],
		apiFamily: 3,
		complete: true,
		seasons: [1, 2].map((seasonNumber) => ({ seasonNumber, monitored: true })),
		episodes: [11, 12, 21].map((id) => ({
			id,
			seasonNumber: Math.floor(id / 10),
			episodeNumber: id % 10,
			title: `Episode ${id}`,
			monitored: true,
			fileId: id + 100,
		})),
		files: [11, 12, 21].map((id) => ({
			id: id + 100,
			path: `/media/series/${id}.mkv`,
			sizeBytes: 100,
			episodeIds: [id],
		})),
	};
	const state = {
		rootFavourite: false,
		favouriteSeasons: new Set([2]),
		favouriteEpisodes: new Set(),
		unknownEpisodes: new Set(),
		unwatchedEpisodes: new Set(),
		activeEpisodes: new Set(),
		calls: [],
		deleted: [],
		onRead: () => {},
	};
	const deps = {
		loadLibrarySnapshot: async () => ({
			items: [structuredClone(item)],
			complete: true,
			errors: [],
			observedAt: "2026-01-01T00:00:00Z",
		}),
		getWatchEvidence: async (scope, selectedUsers, seasonNumber) => {
			state.onRead(state.calls.length);
			const episodes = scope.episodes.filter(
				(e) => seasonNumber === undefined || e.seasonNumber === seasonNumber,
			);
			const seasons =
				seasonNumber === undefined
					? scope.seasons.map((s) => s.seasonNumber)
					: [seasonNumber];
			state.calls.push({
				seasonNumber,
				seasons,
				episodeIds: episodes.map((e) => e.id),
				libraryFileIds: scope.files.map((f) => f.id),
				fileIds: scope.files
					.filter((f) => episodes.some((e) => e.fileId === f.id))
					.map((f) => f.id),
			});
			const complete =
				episodes.length > 0 &&
				episodes.every(
					(e) =>
						!state.unknownEpisodes.has(e.id) &&
						scope.files.some(
							(f) => f.id === e.fileId && f.episodeIds.includes(e.id),
						),
				);
			return {
				complete,
				activePlayback: episodes.some((e) => state.activeEpisodes.has(e.id)),
				favourite:
					state.rootFavourite ||
					seasons.some((s) => state.favouriteSeasons.has(s)) ||
					episodes.some((e) => state.favouriteEpisodes.has(e.id)),
				favouriteSupported: true,
				viewers: selectedUsers.map((user) => ({
					...user,
					status: complete ? "watched" : "unknown",
					episodes: episodes.map((e) => ({
						seasonNumber: e.seasonNumber,
						episodeNumber: e.episodeNumber,
						status: state.unknownEpisodes.has(e.id)
							? "unknown"
							: state.unwatchedEpisodes.has(e.id)
								? "unwatched"
								: "watched",
					})),
					copies: episodes
						.filter((e) => scope.files.some((f) => f.id === e.fileId))
						.map((e) => ({ arrFileId: e.fileId })),
				})),
				blockers: complete ? [] : ["Selected copy/watch coverage incomplete"],
			};
		},
	};
	globalThis.fetch = async (url, options = {}) => {
		const path = new URL(url).pathname;
		const method = options.method ?? "GET";
		const json = (data) => new Response(JSON.stringify(data), { status: 200 });
		if (path === "/api/v3/series/1") {
			if (method === "PUT") {
				const update = JSON.parse(options.body);
				item.monitored = update.monitored;
				item.seasons = update.seasons;
			}
			return json(item);
		}
		if (path === "/api/v3/episode/monitor" && method === "PUT") {
			const update = JSON.parse(options.body);
			for (const e of item.episodes)
				if (update.episodeIds.includes(e.id)) e.monitored = update.monitored;
			return json({});
		}
		if (path === "/api/v3/episode" && method === "GET")
			return json(item.episodes);
		if (path.startsWith("/api/v3/episodefile/") && method === "DELETE") {
			const id = Number(path.split("/").at(-1));
			state.deleted.push(id);
			item.files = item.files.filter((f) => f.id !== id);
			for (const e of item.episodes) if (e.fileId === id) e.fileId = undefined;
			return json({});
		}
		throw new Error(`Unexpected synthetic request: ${method} ${url}`);
	};
	const execute = async (args = input) => {
		const prepared = await prepareLibraryAction(args, deps);
		return withRemovalAuthority(
			{
				approvalId: "synthetic-approval",
				planHash: "a".repeat(64),
				allowed: prepared.plan.files.map((f) => ({
					origin: process.env.SONARR_URL,
					path: `/api/v3/episodefile/${f.id}`,
				})),
			},
			() => executeLibraryAction(args, prepared, deps),
		);
	};
	return { state, deps, item, execute };
}

test("selected season prepares and deletes every file despite favourite/unknown sibling season", async (t) => {
	const f = fixture(t);
	f.state.unknownEpisodes.add(21);
	const result = await f.execute();
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.deepEqual(f.state.deleted, [111, 112]);
	assert.deepEqual(
		f.state.calls.map((c) => c.seasons),
		[[1], [1], [1], [1]],
	);
	assert.deepEqual(
		f.state.calls.map((c) => c.episodeIds),
		[[11, 12], [11, 12], [11, 12], [12]],
	);
	assert.deepEqual(
		f.state.calls.map((c) => c.fileIds),
		[[111, 112], [111, 112], [111, 112], [112]],
	);
	assert.equal(f.item.seasons[1].monitored, true);
	assert.equal(f.item.episodes[2].monitored, true);
});

for (const protection of [
	"unknown",
	"season favourite",
	"episode favourite",
	"root favourite",
	"active",
]) {
	test(`${protection} in the selected season blocks preparation`, async (t) => {
		const f = fixture(t);
		if (protection === "unknown") f.state.unknownEpisodes.add(11);
		if (protection === "season favourite") f.state.favouriteSeasons.add(1);
		if (protection === "episode favourite") f.state.favouriteEpisodes.add(11);
		if (protection === "root favourite") f.state.rootFavourite = true;
		if (protection === "active") f.state.activeEpisodes.add(11);
		await assert.rejects(prepareLibraryAction(input, f.deps), {
			message: /evidence.*protected/i,
		});
		assert.deepEqual(f.state.deleted, []);
	});
}

test("multi-season cleanup requires every selected season and every approved episode", async (t) => {
	const f = fixture(t);
	const args = { ...input, seasonNumbers: [1, 2] };
	await assert.rejects(prepareLibraryAction(args, f.deps), {
		message: /evidence.*protected/i,
	});
	f.state.favouriteSeasons.clear();
	f.state.unknownEpisodes.add(21);
	await assert.rejects(prepareLibraryAction(args, f.deps), {
		message: /evidence.*protected/i,
	});
	f.state.unknownEpisodes.clear();
	f.state.unwatchedEpisodes.add(21);
	await assert.rejects(prepareLibraryAction(args, f.deps), {
		message: /watched every approved episode/i,
	});
	f.state.unwatchedEpisodes.clear();
	f.state.calls.length = 0;
	const result = await f.execute(args);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.deepEqual(f.state.deleted, [111, 112, 121]);
	assert.ok(f.state.calls.every((c) => c.seasonNumber === undefined));
	assert.ok(f.state.calls.every((c) => JSON.stringify(c.seasons) === "[1,2]"));
	assert.deepEqual(
		f.state.calls.map((c) => c.episodeIds),
		[[11, 12, 21], [11, 12, 21], [11, 12, 21], [12, 21], [21]],
	);
});

test("explicit files scope excludes unrelated episodes but keeps selected-season favourites and copy aliases", async (t) => {
	const f = fixture(t);
	f.state.unknownEpisodes.add(12);
	f.state.favouriteEpisodes.add(12);
	const args = {
		...input,
		target: "files",
		ids: [111],
		seasonNumbers: undefined,
	};
	const result = await f.execute(args);
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.deepEqual(f.state.deleted, [111]);
	assert.ok(
		f.state.calls.every((c) => JSON.stringify(c.episodeIds) === "[11]"),
	);
	assert.ok(
		f.state.calls.every(
			(c) => JSON.stringify(c.libraryFileIds) === "[111,112,121]",
		),
	);
	f.state.favouriteSeasons.add(1);
	await assert.rejects(prepareLibraryAction({ ...args, ids: [112] }, f.deps), {
		message: /evidence.*protected/i,
	});
});

test("per-delete scope cannot silently lose an approved episode whose season coordinates changed", async (t) => {
	const f = fixture(t);
	f.state.onRead = (call) => {
		if (call === 1) f.item.episodes[0].seasonNumber = 2;
	};
	const result = await f.execute();
	assert.equal(result.ok, false);
	assert.deepEqual(f.state.deleted, []);
});

for (const protection of [
	"unknown",
	"season favourite",
	"episode favourite",
	"root favourite",
	"active",
]) {
	test(`per-delete refresh stops when selected remaining scope becomes ${protection}`, async (t) => {
		const f = fixture(t);
		f.state.onRead = (call) => {
			if (call !== 3) return;
			if (protection === "unknown") f.state.unknownEpisodes.add(12);
			if (protection === "season favourite") f.state.favouriteSeasons.add(1);
			if (protection === "episode favourite") f.state.favouriteEpisodes.add(12);
			if (protection === "root favourite") f.state.rootFavourite = true;
			if (protection === "active") f.state.activeEpisodes.add(12);
		};
		const result = await f.execute();
		assert.equal(result.ok, false);
		assert.equal(result.data.partial, true);
		assert.deepEqual(f.state.deleted, [111]);
		assert.deepEqual(f.state.calls.at(-1).episodeIds, [12]);
	});
}
