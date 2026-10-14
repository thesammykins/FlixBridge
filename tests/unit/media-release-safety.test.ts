import assert from "node:assert/strict";
import { RadarrService } from "../../src/services/arr/radarr.js";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import { SabnzbdService } from "../../src/services/downloaders/sabnzbd.js";
import {
	executeRemediation,
	mintRemoveToken,
	planRemediation,
} from "../../src/services/plex/remediation.js";
import {
	type PlexReport,
	PlexReportsClient,
} from "../../src/services/plex/reports.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

const json = (body: unknown) => new Response(JSON.stringify(body));
async function mock(fn: typeof fetch, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = fn;
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}
const sabSlot = {
	nzo_id: "fixture-nzo",
	filename: "Example",
	percentage: "0",
	mb: "1",
	mbleft: "1",
};
const sabQueue = (slots = [sabSlot], total = slots.length) => ({
	queue: { slots, size: "1", sizeleft: "1", paused: false, noofslots: total },
});
const sab = () =>
	new SabnzbdService({ baseUrl: "https://sab.example", apiKey: "fixture-key" });

await describe("Release media safety", [
	test("SAB incomplete snapshots cannot prove deletion or missing targets", async () => {
		const responses = [sabQueue(), { status: true }, sabQueue([], 10)];
		await mock(
			async () => json(responses.shift()),
			async () => {
				const result = await sab().removeQueueItems([sabSlot.nzo_id]);
				assert.equal(result.data?.removed, 0);
				assert.equal(result.data?.failed, 1);
			},
		);
		await mock(
			async () => json(sabQueue([], 10)),
			async () => {
				assert.equal((await sab().prepareRemoval([sabSlot.nzo_id])).ok, false);
				assert.equal(
					(await sab().removeQueueItems([sabSlot.nzo_id])).ok,
					false,
				);
			},
		);
	}),
	test("SAB refuses repaired or multi-target downloader IDs before I/O", async () => {
		let calls = 0;
		await mock(
			async () => {
				calls++;
				return json(sabQueue());
			},
			async () => {
				for (const id of [" fixture-nzo ", "fixture-nzo,other", "", 1.5]) {
					assert.equal((await sab().prepareRemoval([id])).ok, false);
					assert.equal((await sab().removeQueueItems([id])).ok, false);
				}
				assert.equal(calls, 0);
			},
		);
	}),
	test("ARR configured URL base survives reads and writes", async () => {
		for (const Service of [SonarrService, RadarrService]) {
			for (const baseUrl of [
				"https://arr.example/proxy",
				"https://arr.example/proxy/",
			]) {
				const paths: string[] = [];
				await mock(
					async (input) => {
						paths.push(new URL(String(input)).pathname);
						return json({ totalRecords: 0, records: [] });
					},
					async () => {
						const s = new Service("arr-test", {
							baseUrl,
							apiKey: "fixture-key",
						});
						await s.queueList();
						await s.queueGrab([1]);
						assert.deepEqual(paths, [
							"/proxy/api/v3/queue",
							"/proxy/api/v3/queue/grab/1",
						]);
					},
				);
			}
		}
	}),
	test("Sonarr queue DELETE encodes explicit scalar safety flags in query", async () => {
		let deletes = 0;
		await mock(
			async (input, init) => {
				if (init?.method === "DELETE") {
					deletes++;
					const url = new URL(String(input));
					assert.equal(url.searchParams.get("removeFromClient"), "false");
					assert.equal(url.searchParams.get("blocklist"), "false");
					assert.equal(url.searchParams.get("skipRedownload"), "false");
					assert.equal(url.searchParams.get("changeCategory"), "false");
					assert.equal(init.body, undefined);
					return json({});
				}
				return json({
					totalRecords: deletes ? 0 : 1,
					records: deletes
						? []
						: [{ id: 1, title: "Show", status: "completed" }],
				});
			},
			async () => {
				const s = new SonarrService("sonarr-test", {
					baseUrl: "https://arr.example",
					apiKey: "fixture-key",
				});
				const prep = await s.prepareRemoval("queue", [1]);
				assert.ok(prep.data);
				const result = await s.executeRemoval(prep.data, {
					attemptManualImport: false,
					removeFromClient: false,
					blocklist: false,
				});
				assert.equal(result.data?.removed, 1);
				assert.equal(deletes, 1);
			},
		);
	}),
	test("ambiguous DELETE timeout is never automatically replayed", async () => {
		let deletes = 0;
		await mock(
			async (_input, init) => {
				if (init?.method === "DELETE") {
					deletes++;
					return new Promise<Response>((_resolve, reject) =>
						init.signal?.addEventListener(
							"abort",
							() => reject(new DOMException("aborted", "AbortError")),
							{ once: true },
						),
					);
				}
				return json({
					totalRecords: 1,
					records: [{ id: 1, title: "Show", status: "completed" }],
				});
			},
			async () => {
				const s = new SonarrService("sonarr-test", {
					baseUrl: "https://arr.example",
					apiKey: "fixture-key",
				});
				const prep = await s.prepareRemoval("queue", [1]);
				assert.ok(prep.data);
				const result = await s.executeRemoval(prep.data, {
					attemptManualImport: false,
					queueTimeoutMs: 1000,
				});
				assert.equal(result.data?.removed, 0);
				assert.equal(deletes, 1);
			},
		);
	}),
	test("manual import binds candidate media, episodes, download and path to queue evidence", async () => {
		const queueRecord = {
			id: 1,
			title: "Show",
			status: "completed",
			downloadId: "download",
			outputPath: "/downloads/show",
			seriesId: 2,
			episodeId: 3,
			seasonNumber: 1,
		};
		const candidate = {
			id: 10,
			path: "/downloads/show/file.mkv",
			series: { id: 2 },
			seasonNumber: 1,
			episodes: [{ id: 3 }],
			rejections: [],
		};
		for (const change of [
			{ series: { id: 999 } },
			{ episodes: [{ id: 99 }] },
			{ seasonNumber: 2 },
			{ downloadId: "other" },
			{ path: "/downloads/show-other/file.mkv" },
			{ path: "/downloads/show/../other/file.mkv" },
		]) {
			await mock(
				async (input) =>
					json(
						new URL(String(input)).pathname.endsWith("manualimport")
							? [{ ...candidate, ...change }]
							: { totalRecords: 1, records: [queueRecord] },
					),
				async () => {
					assert.equal(
						(
							await new SonarrService("sonarr-test", {
								baseUrl: "https://arr.example",
								apiKey: "fixture-key",
							}).previewManualImport([1])
						).data?.summary.safe,
						0,
						JSON.stringify(change),
					);
				},
			);
		}
		await mock(
			async (input) =>
				json(
					new URL(String(input)).pathname.endsWith("manualimport")
						? [
								{
									id: 2,
									path: "/unrelated/file.mkv",
									movie: { id: 999 },
									rejections: [],
								},
							]
						: { totalRecords: 1, records: [{ ...queueRecord, movieId: 10 }] },
				),
			async () => {
				assert.equal(
					(
						await new RadarrService("radarr-test", {
							baseUrl: "https://arr.example",
							apiKey: "fixture-key",
						}).previewManualImport([1])
					).data?.summary.safe,
					0,
				);
			},
		);
	}),
	test("manual import re-previews and refuses changed or ambiguous execution plans", async () => {
		for (const drift of ["path", "mapping", "ambiguity", "queue", "warning"]) {
			const s = new RadarrService("radarr-test", {
				baseUrl: "https://arr.example",
				apiKey: "fixture-key",
			});
			let changed = false;
			let posts = 0;
			const record = {
				id: 1,
				title: "Movie",
				status: "completed",
				downloadId: "download",
				outputPath: "/downloads/movie",
				movieId: 10,
			};
			const candidate = {
				id: 2,
				path: "/downloads/movie/file.mkv",
				movie: { id: 10 },
				rejections: [],
			};
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (init?.method === "POST") {
						posts++;
						return json({ id: 42 });
					}
					if (path.endsWith("manualimport"))
						return json(
							changed && drift === "ambiguity"
								? [candidate, { ...candidate, id: 3 }]
								: [
										{
											...candidate,
											...(changed && drift === "path"
												? { path: "/downloads/movie/new.mkv" }
												: {}),
											...(changed && drift === "mapping"
												? { movie: { id: 20 } }
												: {}),
										},
									],
						);
					if (path.endsWith("/command/42"))
						return json({ id: 42, status: "completed" });
					return json({
						totalRecords: 1,
						records: [
							{
								...record,
								...(changed && drift === "queue"
									? { downloadId: "changed" }
									: {}),
								...(changed && drift === "warning"
									? { errorMessage: "sample" }
									: {}),
							},
						],
					});
				},
				async () => {
					const preview = await s.previewManualImport([1]);
					assert.ok(preview.data);
					assert.equal(preview.data.summary.safe, 1);
					changed = true;
					const result = await s.executeManualImport(preview.data);
					assert.equal(posts, 0, drift);
					assert.equal(result.data?.imported ?? 0, 0);
				},
			);
		}
	}),
	test("completed manual import requires matching library file evidence after queue clearance", async () => {
		for (const verified of [false, true]) {
			const s = new RadarrService("radarr-test", {
				baseUrl: "https://arr.example",
				apiKey: "fixture-key",
			});
			let posts = 0;
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (init?.method === "POST") {
						posts++;
						return json({ id: 42 });
					}
					if (path.endsWith("/command/42"))
						return json({ id: 42, status: "completed" });
					if (path.endsWith("/movie/10"))
						return json({
							id: 10,
							hasFile: verified && posts > 0,
							movieFile: verified && posts > 0 ? { id: 99 } : undefined,
						});
					if (path.endsWith("manualimport"))
						return json([
							{
								id: 2,
								path: "/downloads/movie/file.mkv",
								movie: { id: 10 },
								rejections: [],
							},
						]);
					return json({
						totalRecords: posts ? 0 : 1,
						records: posts
							? []
							: [
									{
										id: 1,
										title: "Movie",
										status: "completed",
										downloadId: "download",
										outputPath: "/downloads/movie",
										movieId: 10,
									},
								],
					});
				},
				async () => {
					const preview = await s.previewManualImport([1]);
					assert.ok(preview.data);
					assert.equal(preview.data.summary.safe, 1);
					const result = await s.executeManualImport(preview.data);
					assert.equal(result.data?.imported, verified ? 1 : 0);
					assert.equal(posts, 1);
				},
			);
		}
	}),
	test("pending manual import is explicit and cannot be submitted again", async () => {
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		let posts = 0;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (init?.method === "POST") {
					posts++;
					return json({ id: 42 });
				}
				if (path.endsWith("/command/42"))
					return json({ id: 42, status: "queued" });
				if (path.endsWith("/movie/10")) return json({ id: 10, hasFile: false });
				if (path.endsWith("manualimport"))
					return json([
						{
							id: 2,
							path: "/downloads/movie/file.mkv",
							movie: { id: 10 },
							rejections: [],
						},
					]);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Movie",
							status: "completed",
							downloadId: "download",
							outputPath: "/downloads/movie",
							movieId: 10,
						},
					],
				});
			},
			async () => {
				const preview = await s.previewManualImport([1]);
				assert.ok(preview.data);
				const result = await s.executeManualImport(preview.data);
				const detail = result.data?.results[0] as {
					pending?: boolean;
					commandId?: number;
					message?: string;
				};
				assert.equal(detail.pending, true);
				assert.equal(detail.commandId, 42);
				assert.match(detail.message ?? "", /Pending/);
				const again = await s.previewManualImport([1]);
				assert.ok(again.data);
				await s.executeManualImport(again.data);
				assert.equal(posts, 1);
			},
		);
	}),
	test("Plex destructive plans reject fuzzy, duplicate and cross-instance targets", async () => {
		const report: PlexReport = {
			id: "safety-report",
			message: "Broken",
			url: "server://fixture/library/metadata/1",
			date: "2026-01-01",
			comments: [],
			commentCount: 0,
		};
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		const item = {
			id: 10,
			title: "Movie",
			year: 2020,
			hasFile: true,
			movieFile: { id: 99 },
		};
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		for (const items of [
			[{ ...item, title: "Movie sequel" }],
			[{ ...item, year: 2021 }],
			[item, { ...item, id: 11 }],
		]) {
			await mock(
				async (input) =>
					json(
						new URL(String(input)).pathname.includes("metadata")
							? {
									MediaContainer: {
										Metadata: [{ type: "movie", title: "Movie", year: 2020 }],
									},
								}
							: items,
					),
				async () => {
					const plan = await planRemediation(
						client,
						report,
						"remove_and_regrab",
						s.serviceName,
						[s],
					);
					assert.equal(plan.ok, false, JSON.stringify(items));
				},
			);
		}
		await mock(
			async (input) =>
				json(
					new URL(String(input)).pathname.includes("metadata")
						? {
								MediaContainer: {
									Metadata: [{ type: "movie", title: "Movie", year: 2020 }],
								},
							}
						: [item],
				),
			async () => {
				const other = new RadarrService("radarr-other", {
					baseUrl: "https://arr-other.example",
					apiKey: "fixture-key",
				});
				assert.equal(
					(
						await planRemediation(
							client,
							report,
							"remove_and_regrab",
							undefined,
							[s, other],
						)
					).ok,
					false,
				);
				assert.equal(
					(
						await planRemediation(
							client,
							report,
							"remove_and_regrab",
							s.serviceName,
							[s, other],
						)
					).ok,
					true,
				);
			},
		);
	}),
	test("Plex pending reports refuse destructive preview and replay before I/O", async () => {
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		const report: PlexReport = {
			id: "pending-report",
			message: "Broken",
			url: "server://fixture/library/metadata/1",
			date: "2026-01-01",
			comments: [
				{ id: "p", message: "Pending: removed file and triggered re-grab" },
			],
			commentCount: 1,
		};
		let calls = 0;
		await mock(
			async (input) => {
				calls++;
				return json(
					new URL(String(input)).pathname.includes("metadata")
						? {
								MediaContainer: {
									Metadata: [{ type: "movie", title: "Movie", year: 2020 }],
								},
							}
						: [
								{
									id: 10,
									title: "Movie",
									year: 2020,
									hasFile: true,
									movieFile: { id: 99 },
								},
							],
				);
			},
			async () => {
				assert.equal(
					(
						await planRemediation(
							client,
							report,
							"remove_and_regrab",
							s.serviceName,
							[s],
						)
					).ok,
					false,
				);
				for (const action of [
					"remove_and_regrab",
					"re_search",
					"add_or_upgrade",
					"comment_only",
				] as const)
					assert.equal(
						(
							await executeRemediation(
								client,
								report,
								{ action, service: s.serviceName },
								[s],
							)
						).ok,
						false,
					);
				assert.equal(calls, 0);
			},
		);
	}),
	test("Plex accepted or partial remediation cannot replay a stale report snapshot", async () => {
		for (const commentOk of [false, true]) {
			const report: PlexReport = {
				id: "stale-report",
				message: "Broken",
				url: "server://fixture/library/metadata/1",
				date: "2026-01-01",
				comments: [],
				commentCount: 0,
			};
			const client = new PlexReportsClient({
				baseUrl: "https://plex.example",
				token: "fixture-token",
			});
			const s = new RadarrService("radarr-test", {
				baseUrl: "https://arr.example",
				apiKey: "fixture-key",
			});
			let deletes = 0;
			let searches = 0;
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (init?.method === "DELETE") {
						deletes++;
						return json({});
					}
					if (path.endsWith("/command")) {
						searches++;
						return json({ id: 42 });
					}
					if (path === "/api")
						return commentOk
							? json({
									data: {
										createReportComment: {
											id: "c",
											message: "Pending: regrab",
										},
									},
								})
							: new Response("{}", { status: 500 });
					return json(
						path.includes("metadata")
							? {
									MediaContainer: {
										Metadata: [{ type: "movie", title: "Movie", year: 2020 }],
									},
								}
							: [
									{
										id: 10,
										title: "Movie",
										year: 2020,
										hasFile: true,
										movieFile: { id: 99 },
									},
								],
					);
				},
				async () => {
					const plan = await planRemediation(
						client,
						report,
						"remove_and_regrab",
						s.serviceName,
						[s],
					);
					assert.ok(plan.data);
					const token = mintRemoveToken(report.id, plan.data);
					const result = await executeRemediation(
						client,
						report,
						{
							action: "remove_and_regrab",
							service: s.serviceName,
							confirmationToken: token,
						},
						[s],
					);
					assert.equal(result.ok, commentOk);
					assert.equal(deletes, 1);
					assert.equal(searches, 1);
					if (!result.ok) assert.match(result.error.message, /Partial failure/);
					const replay = await executeRemediation(
						client,
						report,
						{ action: "re_search", service: s.serviceName },
						[s],
					);
					assert.equal(replay.ok, false);
					assert.equal(searches, 1);
				},
			);
		}
	}),
	test("Plex plan uses one resolved metadata identity throughout matching", async () => {
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		const report: PlexReport = {
			id: "metadata-drift",
			message: "Broken",
			url: "server://fixture/library/metadata/1",
			date: "2026-01-01",
			comments: [],
			commentCount: 0,
		};
		let reads = 0;
		await mock(
			async (input) => {
				if (new URL(String(input)).pathname.includes("metadata"))
					return json({
						MediaContainer: {
							Metadata: [
								{
									type: "movie",
									title: ++reads === 1 ? "Movie" : "Other",
									year: 2020,
								},
							],
						},
					});
				return json([
					{
						id: 10,
						title: "Movie",
						year: 2020,
						hasFile: true,
						movieFile: { id: 99 },
					},
					{
						id: 11,
						title: "Other",
						year: 2020,
						hasFile: true,
						movieFile: { id: 100 },
					},
				]);
			},
			async () => {
				const plan = await planRemediation(
					client,
					report,
					"remove_and_regrab",
					s.serviceName,
					[s],
				);
				assert.equal(plan.data?.item?.id, 10);
				assert.equal(reads, 1);
			},
		);
	}),
	test("concurrent manual import execution reserves a download before submission", async () => {
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		let posts = 0;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (init?.method === "POST") {
					posts++;
					return json({ id: 42 });
				}
				if (path.endsWith("/command/42"))
					return json({ id: 42, status: "queued" });
				if (path.endsWith("/movie/10")) return json({ id: 10, hasFile: false });
				if (path.endsWith("manualimport"))
					return json([
						{
							id: 2,
							path: "/downloads/movie/file.mkv",
							movie: { id: 10 },
							rejections: [],
						},
					]);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Movie",
							status: "completed",
							downloadId: "download",
							outputPath: "/downloads/movie",
							movieId: 10,
						},
					],
				});
			},
			async () => {
				const preview = await s.previewManualImport([1]);
				assert.ok(preview.data);
				await Promise.all([
					s.executeManualImport(preview.data),
					s.executeManualImport(preview.data),
				]);
				assert.equal(posts, 1);
			},
		);
	}),
	test("ARR preparation never repairs fractional IDs into a different target", async () => {
		let calls = 0;
		await mock(
			async () => {
				calls++;
				return json({
					totalRecords: 1,
					records: [{ id: 1, title: "Show", status: "completed" }],
				});
			},
			async () => {
				const s = new SonarrService("sonarr-test", {
					baseUrl: "https://arr.example",
					apiKey: "fixture-key",
				});
				assert.equal((await s.prepareRemoval("queue", [1.9])).ok, false);
				assert.equal(calls, 0);
			},
		);
	}),
	test("Plex destructive movie plan requires positive exact file identity", async () => {
		const report: PlexReport = {
			id: "invalid-file",
			message: "Broken",
			url: "server://fixture/library/metadata/1",
			date: "2026-01-01",
			comments: [],
			commentCount: 0,
		};
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		for (const change of [
			{ movieFile: { id: -99 } },
			{ movieFile: { id: 1.5 } },
			{ hasFile: false },
			{ id: 1.5 },
		]) {
			await mock(
				async (input) =>
					json(
						new URL(String(input)).pathname.includes("metadata")
							? {
									MediaContainer: {
										Metadata: [{ type: "movie", title: "Movie", year: 2020 }],
									},
								}
							: [
									{
										id: 10,
										title: "Movie",
										year: 2020,
										hasFile: true,
										movieFile: { id: 99 },
										...change,
									},
								],
					),
				async () => {
					assert.equal(
						(
							await planRemediation(
								client,
								report,
								"remove_and_regrab",
								s.serviceName,
								[s],
							)
						).ok,
						false,
						JSON.stringify(change),
					);
				},
			);
		}
	}),
	test("duplicate queue identities cannot establish a safe import target", async () => {
		const record = {
			id: 1,
			title: "Movie",
			status: "completed",
			movieId: 10,
			downloadId: "download",
			outputPath: "/downloads/movie",
		};
		await mock(
			async () =>
				json({
					totalRecords: 2,
					records: [record, { ...record, movieId: 20 }],
				}),
			async () => {
				const s = new RadarrService("radarr-test", {
					baseUrl: "https://arr.example",
					apiKey: "fixture-key",
				});
				assert.equal((await s.prepareRemoval("queue", [1])).ok, false);
			},
		);
	}),
	test("scoped import preview supports POSIX, drive and UNC paths without blanket rejection", async () => {
		for (const folder of [
			"/downloads/show",
			"C:\\downloads\\show",
			"\\\\server\\share\\show",
		]) {
			const file = `${folder}${folder.startsWith("/") ? "/" : "\\"}file.mkv`;
			await mock(
				async (input) =>
					json(
						new URL(String(input)).pathname.endsWith("manualimport")
							? [
									{
										id: 2,
										path: file,
										series: { id: 10 },
										seasonNumber: 1,
										episodes: [{ id: 3 }],
									},
								]
							: {
									totalRecords: 1,
									records: [
										{
											id: 1,
											title: "Show",
											status: "completed",
											seriesId: 10,
											episodeId: 3,
											seasonNumber: 1,
											downloadId: "download",
											outputPath: folder,
										},
									],
								},
					),
				async () => {
					const s = new SonarrService("sonarr-test", {
						baseUrl: "https://arr.example",
						apiKey: "fixture-key",
					});
					assert.equal(
						(await s.previewManualImport([1])).data?.summary.safe,
						1,
						folder,
					);
				},
			);
		}
	}),
	test("GraphQL errors retain local guidance but withhold upstream messages", async () => {
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		await mock(
			async () =>
				json({ errors: [{ message: "fixture-secret-in-upstream-error" }] }),
			async () => {
				const result = await client.listReports();
				assert.equal(result.ok, false);
				assert.match(result.error?.message ?? "", /account permissions/);
				assert.equal(
					JSON.stringify(result).includes("fixture-secret-in-upstream-error"),
					false,
				);
			},
		);
	}),
	test("manual import validation failures never expose upstream values", async () => {
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		let posts = 0;
		await mock(
			async (input, init) => {
				if (init?.method === "POST") posts++;
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/movie/10"))
					return json({ id: "fixture-secret-invalid-id", hasFile: false });
				if (path.endsWith("manualimport"))
					return json([
						{ id: 2, path: "/downloads/movie/file.mkv", movie: { id: 10 } },
					]);
				return json({
					totalRecords: 1,
					records: [
						{
							id: 1,
							title: "Movie",
							status: "completed",
							movieId: 10,
							downloadId: "download",
							outputPath: "/downloads/movie",
						},
					],
				});
			},
			async () => {
				const preview = await s.previewManualImport([1]);
				assert.ok(preview.data);
				const result = await s.executeManualImport(preview.data);
				assert.equal(result.data?.imported, 0);
				assert.equal(posts, 0);
				assert.equal(
					JSON.stringify(result).includes("fixture-secret-invalid-id"),
					false,
				);
			},
		);
	}),
	test("destructive movie identity cannot degrade to title-only when Plex year is missing", async () => {
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		const report: PlexReport = {
			id: "missing-year",
			message: "Broken",
			url: "server://fixture/library/metadata/1",
			date: "2026-01-01",
			comments: [],
			commentCount: 0,
		};
		const s = new RadarrService("radarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		await mock(
			async (input) =>
				json(
					new URL(String(input)).pathname.includes("metadata")
						? {
								MediaContainer: {
									Metadata: [{ type: "movie", title: "Movie" }],
								},
							}
						: [
								{
									id: 10,
									title: "Movie",
									year: 2020,
									hasFile: true,
									movieFile: { id: 99 },
								},
							],
				),
			async () => {
				assert.equal(
					(
						await planRemediation(
							client,
							report,
							"remove_and_regrab",
							s.serviceName,
							[s],
						)
					).ok,
					false,
				);
			},
		);
	}),
	test("destructive episode identity requires an actual series title from Plex", async () => {
		const client = new PlexReportsClient({
			baseUrl: "https://plex.example",
			token: "fixture-token",
		});
		const report: PlexReport = {
			id: "missing-series-title",
			message: "Broken",
			url: "server://fixture/library/metadata/1",
			date: "2026-01-01",
			comments: [],
			commentCount: 0,
		};
		const s = new SonarrService("sonarr-test", {
			baseUrl: "https://arr.example",
			apiKey: "fixture-key",
		});
		await mock(
			async (input) => {
				const path = new URL(String(input)).pathname;
				if (path.includes("metadata"))
					return json({
						MediaContainer: {
							Metadata: [
								{
									type: "episode",
									title: "Show",
									parentTitle: "Show",
									parentIndex: 1,
									index: 1,
								},
							],
						},
					});
				if (path.endsWith("/episode"))
					return json([
						{
							id: 3,
							seasonNumber: 1,
							episodeNumber: 1,
							hasFile: true,
							episodeFileId: 99,
						},
					]);
				return json([
					{ id: 10, title: "Show", statistics: { episodeFileCount: 1 } },
				]);
			},
			async () => {
				assert.equal(
					(
						await planRemediation(
							client,
							report,
							"remove_and_regrab",
							s.serviceName,
							[s],
						)
					).ok,
					false,
				);
			},
		);
	}),
]);
if (process.argv[1]?.endsWith("media-release-safety.test.ts"))
	testRunner.printSummary();
