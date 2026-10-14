import assert from "node:assert/strict";
import { RadarrService } from "../../src/services/arr/radarr.js";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import type { SonarrApiPolicy } from "../../src/services/base.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

// Synthetic fixtures derived from Sonarr/Sonarr develop
// 57816c149d02f95543973fefb4780c4495f8121c: Sonarr.Http/ApiInfoResource.cs,
// Api.V5/System/SystemResource.cs and Queue/QueueResource.cs. Not live captures.
const status = { appName: "Sonarr", version: "5.0.0-fixture" };
const discovery = { current: "v5", deprecated: ["v3"] };
const json = (value: unknown) => new Response(JSON.stringify(value));
const service = (apiVersion?: SonarrApiPolicy, name = "sonarr-fixture") =>
	new SonarrService(name, {
		baseUrl: "https://sonarr.example/proxy/",
		apiKey: "fixture-key",
		apiVersion,
	});
async function mock(fn: typeof fetch, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = fn;
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}

await describe("Sonarr per-instance API contracts", [
	test("auto validates authenticated discovery and verifies v5 status before routing", async () => {
		const paths: string[] = [];
		await mock(
			async (input, init) => {
				const url = new URL(String(input));
				paths.push(url.pathname);
				assert.equal(
					new Headers(init?.headers).get("X-Api-Key"),
					"fixture-key",
				);
				assert.equal(url.searchParams.has("apikey"), false);
				return json(url.pathname === "/proxy/api" ? discovery : status);
			},
			async () => {
				const result = await service("auto").systemStatus();
				assert.equal(result.ok, true);
				assert.deepEqual(paths, [
					"/proxy/api",
					"/proxy/api/v5/system/status",
					"/proxy/api/v5/system/status",
				]);
				assert.equal(result.data?.api?.configuredPolicy, "auto");
				assert.equal(result.data?.api?.current, "v5");
				assert.deepEqual(result.data?.api?.verifiedFamilies, [5]);
			},
		);
	}),
	test("v5 queue preserves plural media identities and repeated subresource keys", async () => {
		await mock(
			async (input) => {
				const url = new URL(String(input));
				if (url.pathname.endsWith("/api")) return json(discovery);
				if (url.pathname.endsWith("/system/status")) return json(status);
				assert.equal(url.pathname, "/proxy/api/v5/queue");
				assert.deepEqual(url.searchParams.getAll("includeSubresources"), [
					"series",
					"episodes",
				]);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 7,
							title: "Season pack",
							status: "downloading",
							seriesId: 2,
							episodeIds: [3, 4],
							seasonNumbers: [1],
							episodesWithFilesCount: 1,
							isFullSeason: true,
							size: 100,
							sizeLeft: 0,
							timeLeft: null,
							errorMessage: null,
							series: null,
							episodes: null,
						},
					],
				});
			},
			async () => {
				const result = await service(5).queueList();
				assert.equal(result.ok, true);
				assert.deepEqual(result.data?.items[0]?.episodeIds, [3, 4]);
				assert.deepEqual(result.data?.items[0]?.seasonNumbers, [1]);
				assert.equal(result.data?.items[0]?.seriesId, 2);
				assert.equal(result.data?.items[0]?.isFullSeason, true);
				assert.equal(result.data?.items[0]?.episodesWithFilesCount, 1);
				assert.equal(result.data?.items[0]?.episodeId, undefined);
				assert.equal(result.data?.items[0]?.progressPct, 100);
				assert.equal(result.data?.truncated, false);
			},
		);
	}),
	test("explicit v5 fails closed for unported workflows before side effects", async () => {
		const methods: string[] = [];
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				methods.push(`${init?.method ?? "GET"} ${path}`);
				return json(
					path.endsWith("/api")
						? discovery
						: path.endsWith("/system/status")
							? status
							: { records: [] },
				);
			},
			async () => {
				const s = service(5);
				const result = await s.importIssues();
				assert.equal(result.ok, false);
				assert.match(result.error?.message ?? "", /not ported.*importIssues/i);
				assert.equal((await s.queueDiagnostics(true)).ok, false);
				assert.equal((await s.prepareRemoval("queue", [1])).ok, false);
				assert.ok(
					methods.every(
						(method) => !method.includes("/v3/") && method.startsWith("GET "),
					),
				);
			},
		);
	}),
	test("legacy app v5 still uses v3 without discovery and explicit3 never probes v5", async () => {
		const paths: string[] = [];
		await mock(
			async (input) => {
				const path = new URL(String(input)).pathname;
				paths.push(path);
				return json(path.endsWith("/api") ? discovery : status);
			},
			async () => {
				assert.equal(
					(await service().systemStatus()).data?.api?.configuredPolicy,
					"legacy",
				);
				assert.deepEqual(paths, ["/proxy/api/v3/system/status"]);
				paths.length = 0;
				assert.equal((await service(3).systemStatus()).ok, true);
				assert.deepEqual(paths, [
					"/proxy/api",
					"/proxy/api/v3/system/status",
					"/proxy/api/v3/system/status",
				]);
			},
		);
	}),
	test("reviewed v5 basic reads use matching contracts, including nullable DTO fields", async () => {
		const paths: string[] = [];
		await mock(
			async (input) => {
				const url = new URL(String(input));
				paths.push(url.pathname);
				if (url.pathname.endsWith("/api")) return json(discovery);
				assert.ok(url.pathname.startsWith("/proxy/api/v5/"));
				if (url.pathname.endsWith("/system/status")) return json(status);
				if (url.pathname.endsWith("/rootfolder"))
					return json([
						{ id: 1, path: "/library", freeSpace: 9, isEmpty: false },
					]);
				if (url.pathname.endsWith("/qualityprofile"))
					return json([{ id: 2, name: "Fixture" }]);
				if (url.pathname.endsWith("/series/lookup"))
					return json([
						{ tvdbId: 11, title: "Show", overview: null, imdbId: null },
					]);
				if (url.pathname.endsWith("/series"))
					return json([
						{ id: 7, title: "Show", qualityProfileId: 2, statistics: null },
					]);
				if (url.pathname.endsWith("/episode")) {
					assert.deepEqual(url.searchParams.getAll("includeSubresources"), [
						"episodeFile",
					]);
					return json([
						{
							id: 3,
							seasonNumber: 1,
							episodeNumber: 2,
							episodeFileId: 8,
							episodeFile: null,
							hasFile: true,
							endTime: null,
							grabDate: null,
						},
					]);
				}
				if (url.pathname.endsWith("/history")) {
					assert.deepEqual(url.searchParams.getAll("includeSubresources"), [
						"series",
						"episode",
					]);
					return json({
						totalRecords: 1,
						records: [
							{
								id: 1,
								sourceTitle: null,
								quality: null,
								date: "2026-01-01T00:00:00Z",
								eventType: "grabbed",
							},
						],
					});
				}
				if (url.pathname.endsWith("/queue"))
					return json({ totalRecords: 0, records: [] });
				throw new Error("Unexpected fixture route");
			},
			async () => {
				const s = service(5);
				assert.equal(
					(await s.rootFolderList()).data?.folders[0]?.path,
					"/library",
				);
				assert.equal(
					(await s.listQualityProfiles()).data?.totalLibraryItems,
					1,
				);
				assert.equal(
					(await s.lookupLibraryItem("Show")).data?.matches[0]?.id,
					7,
				);
				assert.equal(
					(await s.lookupEpisodeFile(7, 1, 2)).data?.matches[0]?.episodeFileId,
					8,
				);
				assert.equal((await s.historyDetail()).data?.total, 1);
				assert.equal((await s.search("Show")).data?.results[0]?.foreignId, 11);
				assert.equal((await s.queueDiagnostics()).data?.totalQueueItems, 0);
				assert.equal(paths.filter((path) => path.endsWith("/api")).length, 1);
			},
		);
	}),
	test("v5 manual import uses downloadIds and message text, retaining reason codes", async () => {
		await mock(
			async (input) => {
				const url = new URL(String(input));
				if (url.pathname.endsWith("/api")) return json(discovery);
				if (url.pathname.endsWith("/system/status")) return json(status);
				assert.ok(url.pathname.startsWith("/proxy/api/v5/"));
				if (url.pathname.endsWith("/queue"))
					return json({
						totalRecords: 1,
						records: [
							{
								id: 1,
								title: "Show",
								status: "warning",
								seriesId: 2,
								episodeIds: [3],
								seasonNumbers: [1],
								episodesWithFilesCount: 0,
								isFullSeason: false,
								sizeLeft: 0,
								downloadId: "download",
								outputPath: "/downloads/show",
							},
						],
					});
				assert.equal(url.pathname, "/proxy/api/v5/manualimport");
				assert.deepEqual(url.searchParams.getAll("downloadIds"), ["download"]);
				assert.equal(url.searchParams.has("downloadId"), false);
				return json([
					{
						id: 1,
						path: "/downloads/show/file.mkv",
						series: { id: 2 },
						seasonNumber: 1,
						episodes: [{ id: 3 }],
						rejections: [
							{
								reason: "sample",
								message: "File may be a sample",
								type: "permanent",
							},
						],
					},
				]);
			},
			async () => {
				const result = await service(5).previewManualImport([1]);
				assert.equal(result.ok, true);
				assert.equal(result.data?.apiFamily, 5);
				assert.equal(result.data?.items[0]?.safeToImport, false);
				assert.deepEqual(
					result.data?.items[0]?.candidates[0]?.rejectionReasons,
					["File may be a sample"],
				);
				assert.deepEqual(result.data?.items[0]?.candidates[0]?.rejections, [
					{
						reason: "sample",
						message: "File may be a sample",
						type: "permanent",
					},
				]);
			},
		);
	}),
	test("manual command execution keeps the preview family after discovery expiry", async () => {
		const s = service("auto");
		let posted = false;
		let changed = false;
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		const writes: string[] = [];
		try {
			await mock(
				async (input, init) => {
					const url = new URL(String(input));
					if (url.pathname.endsWith("/api"))
						return json(
							changed ? { current: "v3", deprecated: ["v5"] } : discovery,
						);
					assert.ok(url.pathname.startsWith("/proxy/api/v5/"));
					if (url.pathname.endsWith("/system/status")) return json(status);
					if (init?.method === "POST") {
						writes.push(url.pathname);
						assert.equal(url.pathname, "/proxy/api/v5/command");
						const command = JSON.parse(String(init.body));
						assert.equal(command.name, "ManualImport");
						assert.equal(command.importMode, "auto");
						assert.deepEqual(command.files[0].episodeIds, [3, 4]);
						assert.equal(command.files[0].downloadId, "download");
						posted = true;
						return json({ id: 42 });
					}
					if (url.pathname.endsWith("/command/42"))
						return json({ id: 42, status: "completed" });
					if (url.pathname.endsWith("/manualimport"))
						return json([
							{
								id: 1,
								path: "/downloads/show/file.mkv",
								series: { id: 2 },
								seasonNumber: 1,
								episodes: [{ id: 3 }, { id: 4 }],
								rejections: [],
								downloadId: "download",
								quality: { quality: { id: 1 } },
								languages: [{ id: 1, name: "English" }],
							},
						]);
					if (/\/episode\/[34]$/.test(url.pathname)) {
						const id = Number(url.pathname.split("/").at(-1));
						return json({
							id,
							seriesId: 2,
							seasonNumber: 1,
							hasFile: posted,
							episodeFileId: posted ? id + 10 : 0,
						});
					}
					return json({
						totalRecords: posted ? 0 : 1,
						records: posted
							? []
							: [
									{
										id: 1,
										title: "Show",
										status: "completed",
										seriesId: 2,
										episodeIds: [3, 4],
										seasonNumbers: [1],
										episodesWithFilesCount: 0,
										isFullSeason: false,
										sizeLeft: 0,
										downloadId: "download",
										outputPath: "/downloads/show",
									},
								],
					});
				},
				async () => {
					const preview = await s.previewManualImport([1]);
					assert.ok(preview.data);
					assert.equal(preview.data.apiFamily, 5);
					assert.equal(preview.data.summary.safe, 1);
					changed = true;
					now += 6 * 60 * 1000;
					const result = await s.executeManualImport(preview.data);
					assert.equal(result.data?.imported, 1);
					assert.deepEqual(writes, ["/proxy/api/v5/command"]);
				},
			);
		} finally {
			Date.now = originalNow;
		}
	}),
	test("v5 full profile PUT and readback remain in one verified family", async () => {
		let put = false;
		const paths: string[] = [];
		const full = {
			id: 7,
			title: "Show",
			qualityProfileId: 2,
			language: { id: 8, name: "Japanese" },
			seasonType: "aired",
			malIds: [123],
			seasons: [{ seasonNumber: 1, monitored: true }],
		};
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				paths.push(path);
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				assert.equal(path, "/proxy/api/v5/series/7");
				if (init?.method === "PUT") {
					put = true;
					assert.deepEqual(JSON.parse(String(init.body)), {
						...full,
						qualityProfileId: 3,
					});
					return new Response(null, { status: 204 });
				}
				return json({ ...full, qualityProfileId: put ? 3 : 2 });
			},
			async () => {
				assert.equal(
					(await service(5).updateQualityProfile(7, 3)).data?.updated,
					true,
				);
				assert.equal(
					paths.filter((path) => path.endsWith("/series/7")).length,
					3,
				);
			},
		);
	}),
	test("v5 add obtains required language and seasonType from exact lookup, never defaults", async () => {
		const lookup = {
			tvdbId: 11,
			title: "Source title",
			language: { id: 8, name: "Japanese" },
			seasonType: "aired",
			seasons: [{ seasonNumber: 1 }],
			images: [],
		};
		for (const variant of [
			lookup,
			{ ...lookup, language: null },
			{ ...lookup, language: { id: 999, name: "Fake" } },
			{ ...lookup, seasonType: "" },
			{ ...lookup, tvdbId: 99 },
		]) {
			let posts = 0;
			await mock(
				async (input, init) => {
					const url = new URL(String(input));
					if (url.pathname.endsWith("/api")) return json(discovery);
					if (url.pathname.endsWith("/system/status")) return json(status);
					assert.ok(url.pathname.startsWith("/proxy/api/v5/"));
					if (url.pathname.endsWith("/series/lookup")) {
						assert.equal(url.searchParams.get("term"), "tvdb:11");
						return json([variant]);
					}
					if (init?.method === "POST") {
						posts++;
						assert.equal(url.pathname, "/proxy/api/v5/series");
						const body = JSON.parse(String(init.body));
						assert.deepEqual(body.language, lookup.language);
						assert.equal(body.seasonType, lookup.seasonType);
						assert.deepEqual(body.seasons, lookup.seasons);
						assert.equal(body.title, lookup.title);
						assert.equal(body.qualityProfileId, 2);
						assert.equal(body.rootFolderPath, "/library");
						assert.equal(body.addOptions.searchForMissingEpisodes, false);
						return json({ id: 7, title: lookup.title });
					}
					throw new Error("Unexpected route");
				},
				async () => {
					const result = await service(5).addNew({
						foreignId: 11,
						title: "User title",
						qualityProfileId: 2,
						rootFolderPath: "/library",
					});
					assert.equal(result.ok, variant === lookup);
					assert.equal(posts, variant === lookup ? 1 : 0);
				},
			);
		}
	}),
	test("library statistics validates the v5 resource and never synthesizes a legacy scan", async () => {
		// Api.V5/Statistics/*Resource.cs at the pinned source revision above.
		const counts = {
			seriesCount: 2,
			monitoredSeriesCount: 1,
			completedSeriesCount: 0,
			continuingSeriesCount: 1,
			endedSeriesCount: 1,
			upcomingSeriesCount: 0,
			deletedSeriesCount: 0,
			standardSeriesCount: 2,
			dailySeriesCount: 0,
			animeSeriesCount: 0,
			seasonCount: 3,
			completedSeasonCount: 0,
			totalEpisodeCount: 10,
			monitoredEpisodeCount: 5,
			downloadedEpisodeCount: 4,
			missingEpisodeCount: 1,
			unairedEpisodeCount: 5,
			episodeFileCount: 4,
			sizeOnDisk: 1000,
			qualityProfileStatistics: [
				{
					qualityProfileId: 2,
					name: "Fixture",
					seriesCount: 2,
					episodeFileCount: 4,
					sizeOnDisk: 1000,
				},
			],
			qualityStatistics: [
				{
					quality: {
						id: 1,
						name: "SDTV",
						resolution: 480,
						source: "television",
					},
					episodeFileCount: 4,
					sizeOnDisk: 1000,
				},
			],
			tagStatistics: [
				{
					tagId: 1,
					label: "fixture",
					seriesCount: 2,
					episodeFileCount: 4,
					sizeOnDisk: 1000,
				},
			],
		};
		for (const body of [
			counts,
			{},
			{ ...counts, seriesCount: -1 },
			{ ...counts, tagStatistics: [{}] },
		]) {
			const paths: string[] = [];
			await mock(
				async (input) => {
					const path = new URL(String(input)).pathname;
					paths.push(path);
					return json(
						path.endsWith("/api")
							? discovery
							: path.endsWith("/system/status")
								? status
								: body,
					);
				},
				async () => {
					const result = await service(5).libraryStatistics();
					assert.equal(result.ok, body === counts);
					if (body === counts)
						assert.deepEqual(result.data, {
							service: "sonarr-fixture",
							apiFamily: 5,
							statistics: counts,
						});
					assert.equal(paths.at(-1), "/proxy/api/v5/statistics");
				},
			);
		}
		await mock(
			async () => {
				throw new Error("Legacy statistics must not make requests");
			},
			async () => {
				assert.equal((await service().libraryStatistics()).ok, false);
				assert.equal((await service(3).libraryStatistics()).ok, false);
				assert.equal(
					(
						await new RadarrService("radarr-fixture", {
							baseUrl: "https://radarr.example",
							apiKey: "fixture-key",
						}).libraryStatistics()
					).ok,
					false,
				);
			},
		);
	}),
	test("schema failures in reviewed reads are errors, not empty healthy results", async () => {
		for (const method of [
			"search",
			"lookupLibraryItem",
			"historyDetail",
			"listQualityProfiles",
			"previewManualImport",
		] as const) {
			await mock(
				async (input) => {
					const path = new URL(String(input)).pathname;
					if (path.endsWith("/api")) return json(discovery);
					if (path.endsWith("/system/status")) return json(status);
					if (path.endsWith("/qualityprofile"))
						return json([{ id: 2, name: "Fixture" }]);
					if (path.endsWith("/queue"))
						return json({
							totalRecords: 1,
							records: [
								{
									id: 1,
									title: "Show",
									status: "warning",
									sizeLeft: 0,
									episodeIds: [],
									seasonNumbers: [],
									episodesWithFilesCount: 0,
									isFullSeason: false,
									downloadId: "download",
								},
							],
						});
					return json({ message: "Wrong schema" });
				},
				async () => {
					const s = service(5);
					const result =
						method === "search"
							? await s.search("Show")
							: method === "lookupLibraryItem"
								? await s.lookupLibraryItem("Show")
								: method === "historyDetail"
									? await s.historyDetail()
									: method === "listQualityProfiles"
										? await s.listQualityProfiles()
										: await s.previewManualImport([1]);
					assert.equal(result.ok, false, method);
				},
			);
		}
	}),
	test("status advertises reviewed routing separately from verified families", async () => {
		await mock(
			async (input) =>
				json(
					new URL(String(input)).pathname.endsWith("/api") ? discovery : status,
				),
			async () => {
				const pinned = await service(5).systemStatus();
				assert.equal(
					pinned.data?.api?.effectiveOperations.previewManualImport,
					5,
				);
				assert.equal(
					pinned.data?.api?.effectiveOperations.prepareRemoval,
					"unsupported",
				);
				assert.equal(
					pinned.data?.api?.effectiveOperations.libraryStatistics,
					5,
				);
				const auto = await service("auto").systemStatus();
				assert.equal(auto.data?.api?.effectiveOperations.prepareRemoval, 3);
				assert.deepEqual(auto.data?.api?.verifiedFamilies, [5]);
			},
		);
	}),
	test("discovery errors and failed status verification never downgrade or mutate", async () => {
		const badDiscovery = [
			{ supportedVersions: [3, 5] },
			{ current: "v5", deprecated: "v3" },
			{ current: "v4", deprecated: [] },
			{ current: "v5", deprecated: [3] },
		];
		for (const bad of badDiscovery) {
			const calls: string[] = [];
			await mock(
				async (input, init) => {
					calls.push(
						`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`,
					);
					return json(bad);
				},
				async () => {
					assert.equal(
						(await service("auto").updateQualityProfile(7, 3)).ok,
						false,
					);
					assert.deepEqual(calls, ["GET /proxy/api"]);
				},
			);
		}
		for (const failure of [
			new Response("", { status: 401 }),
			new Response("", { status: 404 }),
			new Response("<html>login</html>"),
			json({ appName: "Radarr", version: "5" }),
			json({ appName: "Sonarr", version: null }),
		]) {
			const paths: string[] = [];
			await mock(
				async (input) => {
					const path = new URL(String(input)).pathname;
					paths.push(path);
					return path.endsWith("/api") ? json(discovery) : failure.clone();
				},
				async () => {
					assert.equal(
						(await service("auto").updateQualityProfile(7, 3)).ok,
						false,
					);
					assert.deepEqual(paths, [
						"/proxy/api",
						"/proxy/api/v5/system/status",
					]);
				},
			);
		}
		for (const failure of [
			new Response("", { status: 401 }),
			new Response("<html>login</html>"),
		]) {
			const paths: string[] = [];
			await mock(
				async (input) => {
					paths.push(new URL(String(input)).pathname);
					return failure.clone();
				},
				async () => {
					assert.equal((await service(3).queueList()).ok, false);
					assert.deepEqual(paths, ["/proxy/api"]);
				},
			);
		}
	}),
	test("successful discovery deduplicates concurrency, expires lazily, and isolates exact instances", async () => {
		const counts = new Map<string, number>();
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		try {
			await mock(
				async (input, init) => {
					const url = new URL(String(input));
					const key = `${new Headers(init?.headers).get("X-Api-Key")} ${url.pathname}`;
					counts.set(key, (counts.get(key) ?? 0) + 1);
					await Promise.resolve();
					return json(
						url.pathname.endsWith("/api")
							? discovery
							: url.pathname.endsWith("/system/status")
								? status
								: { totalRecords: 0, records: [] },
					);
				},
				async () => {
					const a = service("auto", "sonarr-a");
					const b = new SonarrService("sonarr-b", {
						baseUrl: "https://sonarr.example/proxy/",
						apiKey: "other-key",
						apiVersion: 3,
					});
					const results = await Promise.all([
						a.queueList(),
						a.queueList(),
						a.queueList(),
						b.queueList(),
						b.queueList(),
					]);
					assert.ok(results.every((result) => result.ok));
					assert.equal(counts.get("fixture-key /proxy/api"), 1);
					assert.equal(counts.get("other-key /proxy/api"), 1);
					assert.equal(
						counts.get("fixture-key /proxy/api/v5/system/status"),
						1,
					);
					assert.equal(counts.get("other-key /proxy/api/v3/system/status"), 1);
					await a.queueList();
					assert.equal(counts.get("fixture-key /proxy/api"), 1);
					now += 6 * 60 * 1000;
					await a.queueList();
					assert.equal(counts.get("fixture-key /proxy/api"), 2);
					assert.equal(counts.get("other-key /proxy/api"), 1);
				},
			);
		} finally {
			Date.now = originalNow;
		}
	}),
	test("mixed legacy Sonarr and Radarr instances never inherit another instance's v5 route", async () => {
		const calls: string[] = [];
		await mock(
			async (input, init) => {
				const url = new URL(String(input));
				calls.push(`${url.host}${url.pathname}`);
				if (url.pathname.endsWith("/api")) return json(discovery);
				if (url.pathname.endsWith("/system/status")) return json(status);
				assert.equal(
					new Headers(init?.headers).get("X-Api-Key"),
					"fixture-key",
				);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Old",
							status: "downloading",
							size: 100,
							sizeleft: 30,
							episodeId: null,
							seasonNumber: null,
						},
					],
				});
			},
			async () => {
				const a = service(5);
				const legacy = new SonarrService("sonarr-old", {
					baseUrl: "https://old.example/base",
					apiKey: "fixture-key",
				});
				const radarr = new RadarrService("radarr-fixture", {
					baseUrl: "https://radarr.example/base/",
					apiKey: "fixture-key",
				});
				const [, old, movie] = await Promise.all([
					a.systemStatus(),
					legacy.queueList(),
					radarr.queueList(),
				]);
				assert.equal(old.data?.items[0]?.progressPct, 70);
				assert.equal(movie.data?.mediaKind, "movie");
				assert.ok(calls.includes("old.example/base/api/v3/queue"));
				assert.ok(calls.includes("radarr.example/base/api/v3/queue"));
				assert.ok(
					!calls.some((call) =>
						/old.example.*v5|radarr.example.*v5/.test(call),
					),
				);
			},
		);
	}),
	test("ambiguous PUT failure has no retry, family fallback, or readback success", async () => {
		for (const failure of ["auth", "timeout", "network"]) {
			let puts = 0;
			const calls: string[] = [];
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					calls.push(`${init?.method ?? "GET"} ${path}`);
					if (path.endsWith("/api")) return json(discovery);
					if (path.endsWith("/system/status")) return json(status);
					if (init?.method === "PUT") {
						puts++;
						if (failure === "auth") return new Response(null, { status: 401 });
						if (failure === "timeout")
							throw new DOMException("Timeout fixture", "AbortError");
						throw new Error("Transport fixture");
					}
					return json({ id: 7, qualityProfileId: 2 });
				},
				async () => {
					assert.equal(
						(await service("auto").updateQualityProfile(7, 3)).ok,
						false,
					);
					assert.equal(puts, 1);
					assert.equal(calls.length, 4);
					assert.ok(calls.every((call) => !call.includes("/v3/")));
				},
			);
		}
	}),
	test("reviewed v5 queue grabs and search commands submit exact bodies once", async () => {
		const writes: Array<{ path: string; body: unknown }> = [];
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				assert.equal(init?.method, "POST");
				assert.equal(
					new Headers(init?.headers).get("X-Api-Key"),
					"fixture-key",
				);
				writes.push({
					path,
					body: init?.body ? JSON.parse(String(init.body)) : null,
				});
				return new Response(null, { status: 204 });
			},
			async () => {
				const s = service(5);
				assert.equal((await s.queueGrab([1])).ok, true);
				assert.equal((await s.queueGrab([1, 2])).ok, true);
				assert.equal((await s.triggerSearch(7)).ok, true);
				assert.deepEqual(writes, [
					{ path: "/proxy/api/v5/queue/grab/1", body: null },
					{ path: "/proxy/api/v5/queue/grab/bulk", body: { ids: [1, 2] } },
					{
						path: "/proxy/api/v5/command",
						body: { name: "SeriesSearch", seriesId: 7 },
					},
				]);
			},
		);
	}),
	test("import route plans bind the exact instance and cannot be changed after preview", async () => {
		let posts = 0;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				if (init?.method === "POST") {
					posts++;
					return json({ id: 42 });
				}
				if (path.endsWith("/command/42"))
					return json({ id: 42, status: "completed" });
				if (path.endsWith("/manualimport"))
					return json([
						{
							id: 1,
							path: "/downloads/show/file.mkv",
							series: { id: 2 },
							seasonNumber: 1,
							episodes: [{ id: 3 }],
							rejections: [],
						},
					]);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Show",
							status: "completed",
							sizeLeft: 0,
							episodeIds: [3],
							seasonNumbers: [1],
							episodesWithFilesCount: 0,
							isFullSeason: false,
							seriesId: 2,
							downloadId: "download",
							outputPath: "/downloads/show",
						},
					],
				});
			},
			async () => {
				const a = service("auto");
				const b = service("auto");
				const preview = await a.previewManualImport([1]);
				assert.ok(preview.data);
				assert.equal((await b.executeManualImport(preview.data)).ok, false);
				preview.data.apiFamily = 3;
				assert.equal((await a.executeManualImport(preview.data)).ok, false);
				assert.equal(posts, 0);
			},
		);
	}),
	test("auto removal keeps a frozen v3 plan and rejects another instance's preparation", async () => {
		let deleted = false;
		const writes: string[] = [];
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				if (init?.method === "DELETE") {
					writes.push(path);
					deleted = true;
					return new Response(null, { status: 204 });
				}
				assert.equal(path, "/proxy/api/v3/queue");
				return json({
					totalRecords: deleted ? 0 : 1,
					records: deleted
						? []
						: [
								{
									id: 1,
									title: "Show",
									status: "completed",
									downloadId: "download",
									outputPath: "/downloads/show",
									seriesId: 2,
									episodeId: 3,
									seasonNumber: 1,
								},
							],
				});
			},
			async () => {
				const a = service("auto");
				const b = service("auto");
				const prep = await a.prepareRemoval("queue", [1]);
				assert.ok(prep.data);
				assert.equal(prep.data.apiFamily, 3);
				assert.equal(prep.data.targets[0]?.seriesId, 2);
				assert.deepEqual(prep.data.targets[0]?.episodeIds, [3]);
				assert.equal(
					(await b.executeRemoval(prep.data, { attemptManualImport: false }))
						.ok,
					false,
				);
				assert.equal(
					(await a.executeRemoval(prep.data, { attemptManualImport: false }))
						.data?.removed,
					1,
				);
				assert.deepEqual(writes, ["/proxy/api/v3/queue/1"]);
			},
		);
	}),
	test("plural queue identities survive diagnostics and internal preparation without choosing an episode", async () => {
		await mock(
			async (input) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Pack",
							status: "warning",
							sizeLeft: 0,
							seriesId: 2,
							episodeIds: [3, 4],
							seasonNumbers: [1],
							episodesWithFilesCount: 1,
							isFullSeason: true,
							errorMessage: "sample",
							downloadId: "download",
						},
					],
				});
			},
			async () => {
				const result = await service(5).queueDiagnostics();
				assert.deepEqual(result.data?.issuesAnalyzed[0]?.episodeIds, [3, 4]);
				assert.deepEqual(result.data?.issuesAnalyzed[0]?.seasonNumbers, [1]);
				assert.equal(result.data?.issuesAnalyzed[0]?.episodeId, undefined);
				assert.equal(result.data?.issuesAnalyzed[0]?.episodesWithFilesCount, 1);
				assert.equal(result.data?.issuesAnalyzed[0]?.isFullSeason, true);
			},
		);
	}),
	test("verified status does not turn a later wrong-app status into healthy Sonarr", async () => {
		let reads = 0;
		await mock(
			async (input) => {
				const path = new URL(String(input)).pathname;
				return json(
					path.endsWith("/api")
						? discovery
						: ++reads === 1
							? status
							: { appName: "Radarr", version: "5.0" },
				);
			},
			async () => {
				assert.equal((await service(5).systemStatus()).ok, false);
			},
		);
	}),
	test("v5 history since uses the array contract and date query, with truthful paging", async () => {
		await mock(
			async (input) => {
				const url = new URL(String(input));
				if (url.pathname.endsWith("/api")) return json(discovery);
				if (url.pathname.endsWith("/system/status")) return json(status);
				assert.equal(url.pathname, "/proxy/api/v5/history/since");
				assert.equal(url.searchParams.get("date"), "2026-01-01T00:00:00Z");
				assert.equal(url.searchParams.has("since"), false);
				assert.equal(url.searchParams.has("page"), false);
				assert.deepEqual(url.searchParams.getAll("includeSubresources"), [
					"series",
					"episode",
				]);
				return json(
					[1, 2].map((id) => ({
						id,
						sourceTitle: `Release ${id}`,
						date: "2026-01-02T00:00:00Z",
						eventType: "grabbed",
					})),
				);
			},
			async () => {
				const result = await service(5).historyDetail({
					since: "2026-01-01T00:00:00Z",
					page: 2,
					pageSize: 1,
				});
				assert.equal(result.ok, true);
				assert.equal(result.data?.total, 2);
				assert.equal(result.data?.items[0]?.id, 2);
				assert.equal(result.data?.truncated, true);
			},
		);
	}),
	test("v5 queue rejects legacy casing and retains full-snapshot guards", async () => {
		for (const body of [
			{ totalRecords: 3, records: [] },
			{ records: [] },
			{
				totalRecords: 1,
				records: [
					{
						id: 1,
						title: "Show",
						status: "completed",
						sizeleft: 0,
						episodeIds: [3],
						seasonNumbers: [1],
						episodesWithFilesCount: 0,
						isFullSeason: false,
					},
				],
			},
		]) {
			await mock(
				async (input) => {
					const path = new URL(String(input)).pathname;
					return json(
						path.endsWith("/api")
							? discovery
							: path.endsWith("/system/status")
								? status
								: body,
					);
				},
				async () => {
					const s = service(5);
					const queue = await s.queueList();
					if (body.records.length) assert.equal(queue.ok, false);
					else assert.equal(queue.data?.truncated, true);
					assert.equal((await s.queueDiagnostics()).ok, false);
					assert.equal((await s.previewManualImport([1])).ok, false);
				},
			);
		}
	}),
	test("manual command transport failure does not replay or fall back to v3", async () => {
		let posts = 0;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/api")) return json(discovery);
				assert.ok(path.startsWith("/proxy/api/v5/"));
				if (path.endsWith("/system/status")) return json(status);
				if (path.endsWith("/episode/3"))
					return json({
						id: 3,
						seriesId: 2,
						seasonNumber: 1,
						hasFile: false,
						episodeFileId: 0,
					});
				if (init?.method === "POST") {
					posts++;
					assert.equal(path, "/proxy/api/v5/command");
					throw new DOMException("Timeout fixture", "AbortError");
				}
				if (path.endsWith("/manualimport"))
					return json([
						{
							id: 1,
							path: "/downloads/show/file.mkv",
							series: { id: 2 },
							seasonNumber: 1,
							episodes: [{ id: 3 }],
							rejections: [],
							downloadId: "download",
						},
					]);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Show",
							status: "completed",
							seriesId: 2,
							episodeIds: [3],
							seasonNumbers: [1],
							episodesWithFilesCount: 0,
							isFullSeason: false,
							sizeLeft: 0,
							downloadId: "download",
							outputPath: "/downloads/show",
						},
					],
				});
			},
			async () => {
				const s = service(5);
				const preview = await s.previewManualImport([1]);
				assert.ok(preview.data);
				const result = await s.executeManualImport(preview.data);
				assert.equal(result.data?.imported, 0);
				assert.equal(result.data?.failed, 1);
				assert.equal(posts, 1);
			},
		);
	}),
	test("full-object profile updates reject a mismatched target identity before PUT", async () => {
		let puts = 0;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				if (init?.method === "PUT") puts++;
				return json({ id: 99, qualityProfileId: 2 });
			},
			async () => {
				assert.equal((await service(5).updateQualityProfile(7, 3)).ok, false);
				assert.equal(puts, 0);
			},
		);
	}),
	test("discovery cache cannot stay fresh because the wall clock moved backwards", async () => {
		const originalNow = Date.now;
		let now = originalNow();
		Date.now = () => now;
		let discoveries = 0;
		try {
			await mock(
				async (input) => {
					const path = new URL(String(input)).pathname;
					if (path.endsWith("/api")) {
						discoveries++;
						return json(discovery);
					}
					return json(status);
				},
				async () => {
					const s = service(5);
					assert.equal((await s.systemStatus()).ok, true);
					now -= 1000;
					assert.equal((await s.systemStatus()).ok, true);
					assert.equal(discoveries, 2);
				},
			);
		} finally {
			Date.now = originalNow;
		}
	}),
]);
if (process.argv[1]?.endsWith("sonarr-api.test.ts")) testRunner.printSummary();
