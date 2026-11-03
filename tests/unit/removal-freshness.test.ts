import assert from "node:assert/strict";
import { requestSignal } from "../../src/request-context.js";
import { RadarrService } from "../../src/services/arr/radarr.js";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import { withFixtureRemovalAuthority } from "../helpers/removal-authority.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

const config = { baseUrl: "https://fixture.invalid/base", apiKey: "synthetic" };
const queueItem = {
	id: 7,
	title: "Approved",
	status: "completed",
	downloadId: "approved-download",
	outputPath: "/downloads/approved",
	seriesId: 10,
	episodeId: 11,
	seasonNumber: 1,
	movieId: 10,
};
const json = (body: unknown) => new Response(JSON.stringify(body));
async function mock(fetch: typeof globalThis.fetch, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = fetch;
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}
const services = () => [
	new SonarrService("sonarr", { ...config, apiVersion: 3 }),
	new RadarrService("radarr", config),
];

await describe("Removal freshness", [
	test("cancelling the fresh target read prevents deletion", async () => {
		const controller = new AbortController();
		let reads = 0;
		let deletes = 0;
		const service = new RadarrService("radarr", config);
		await mock(
			async (_input, init) => {
				if (init?.method === "DELETE") deletes++;
				reads++;
				if (reads > 1) {
					assert.ok(init?.signal);
					controller.abort();
					init.signal.throwIfAborted();
				}
				return json({ totalRecords: 1, records: [queueItem] });
			},
			async () => {
				const preview = await service.prepareRemoval("queue", [7]);
				assert.ok(preview.ok && preview.data);
				const preparation = preview.data;
				const result = await requestSignal.run(controller.signal, () =>
					withFixtureRemovalAuthority(
						["https://fixture.invalid/base/api/v3/queue/7"],
						() =>
							service.executeRemoval(preparation, {
								attemptManualImport: false,
							}),
					),
				);
				assert.equal(reads, 2);
				assert.equal(deletes, 0);
				assert.equal(result.data?.removed, 0);
				assert.equal(result.data?.failed, 1);
			},
		);
	}),
	test("manual import rechecks fresh review classification at execution for both ARR services", async () => {
		for (const service of services()) {
			let warning = false;
			let posts = 0;
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (path.endsWith("/api"))
						return json({ current: "v5", deprecated: ["v3"] });
					if (path.endsWith("/system/status"))
						return json({ appName: "Sonarr", version: "5.0.0-fixture" });
					if (init?.method === "POST") {
						posts++;
						return json({ id: 1 });
					}
					if (path.endsWith("/manualimport"))
						return json([
							{
								id: 21,
								path: "/downloads/approved/file.mkv",
								series: { id: 10 },
								movie: { id: 10 },
								seasonNumber: 1,
								episodes: [{ id: 11 }],
								rejections: [],
							},
						]);
					assert.ok(path.endsWith("/queue"));
					return json({
						totalRecords: 1,
						records: [
							{
								...queueItem,
								statusMessages: warning
									? [{ title: "manual investigation required" }]
									: [],
							},
						],
					});
				},
				async () => {
					const preview = await service.previewManualImport([7]);
					assert.ok(preview.ok && preview.data);
					assert.equal(preview.data.summary.safe, 1);
					warning = true;
					const execution = await service.executeManualImport(preview.data);
					assert.equal(execution.data?.imported, 0);
					assert.equal(execution.data?.failed, 1);
					assert.equal(posts, 0);
					const fresh = await service.previewManualImport([7]);
					assert.equal(fresh.data?.summary.safe, 0);
					assert.equal(fresh.data?.items[0]?.selectedCandidate, undefined);
				},
			);
		}
	}),
	test("each queue deletion refreshes its own target after earlier mutations", async () => {
		for (const service of services()) {
			const deleted: number[] = [];
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (path.endsWith("/api"))
						return json({ current: "v5", deprecated: ["v3"] });
					if (path.endsWith("/system/status"))
						return json({ appName: "Sonarr", version: "5.0.0-fixture" });
					if (init?.method === "DELETE") {
						deleted.push(Number(path.split("/").at(-1)));
						return new Response(null, { status: 204 });
					}
					const records = deleted.length
						? [{ ...queueItem, id: 8, downloadId: "unapproved" }]
						: [queueItem, { ...queueItem, id: 8 }];
					return json({ totalRecords: records.length, records });
				},
				async () => {
					const preview = await service.prepareRemoval("queue", [7, 8]);
					assert.ok(preview.ok && preview.data);
					const result = await withFixtureRemovalAuthority(
						[
							"https://fixture.invalid/base/api/v3/queue/7",
							"https://fixture.invalid/base/api/v3/queue/8",
						],
						() =>
							service.executeRemoval(preview.data, {
								attemptManualImport: false,
							}),
					);
					assert.deepEqual(deleted, [7]);
					assert.equal(result.data?.removed, 1);
					assert.equal(result.data?.failed, 1);
				},
			);
		}
	}),
	test("incomplete or ambiguous execution snapshots cannot authorize deletion or absence", async () => {
		for (const snapshot of [
			{ totalRecords: 2, records: [queueItem] },
			{ totalRecords: 1, records: [] },
			{ records: [queueItem] },
			{ totalRecords: 2, records: [queueItem, queueItem] },
		]) {
			let changed = false;
			let deletes = 0;
			const service = new RadarrService("radarr", config);
			await mock(
				async (_input, init) => {
					if (init?.method === "DELETE") deletes++;
					return json(
						changed ? snapshot : { totalRecords: 1, records: [queueItem] },
					);
				},
				async () => {
					const preview = await service.prepareRemoval("queue", [7]);
					assert.ok(preview.ok && preview.data);
					changed = true;
					const result = await withFixtureRemovalAuthority(
						["https://fixture.invalid/base/api/v3/queue/7"],
						() =>
							service.executeRemoval(preview.data, {
								attemptManualImport: false,
							}),
					);
					assert.equal(deletes, 0);
					assert.equal(result.data?.removed, 0);
					assert.equal(result.data?.failed, 1);
				},
			);
		}
	}),
	test("library preparation rejects a response for a different requested ID", async () => {
		for (const service of services()) {
			await mock(
				async (input) => {
					const path = new URL(String(input)).pathname;
					if (path.endsWith("/api"))
						return json({ current: "v5", deprecated: ["v3"] });
					if (path.endsWith("/system/status"))
						return json({ appName: "Sonarr", version: "5.0.0-fixture" });
					return json({ id: 99, title: "Wrong target", path: "/other" });
				},
				async () => {
					assert.equal(
						(await service.prepareRemoval("library", [7])).ok,
						false,
					);
				},
			);
		}
	}),
	test("discard verifies already-cleared shared-download targets without replaying DELETE", async () => {
		for (const service of services()) {
			let deletes = 0;
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (path.endsWith("/api"))
						return json({ current: "v5", deprecated: ["v3"] });
					if (path.endsWith("/system/status"))
						return json({ appName: "Sonarr", version: "5.0.0-fixture" });
					if (init?.method === "DELETE") {
						deletes++;
						return new Response(null, { status: 204 });
					}
					return json({
						totalRecords: deletes ? 0 : 2,
						records: deletes ? [] : [queueItem, { ...queueItem, id: 8 }],
					});
				},
				async () => {
					const preview = await service.prepareRemoval("queue", [7, 8]);
					assert.ok(preview.ok && preview.data);
					const result = await withFixtureRemovalAuthority(
						[
							"https://fixture.invalid/base/api/v3/queue/7",
							"https://fixture.invalid/base/api/v3/queue/8",
						],
						() =>
							service.executeRemoval(preview.data, {
								attemptManualImport: false,
							}),
					);
					assert.equal(deletes, 1);
					assert.equal(result.data?.removed, 2);
					assert.equal(result.data?.failed, 0);
				},
			);
		}
	}),
	test("library deletion binds provider and file identity even when title and path match", async () => {
		for (const service of services()) {
			for (const drift of service.id === "sonarr"
				? [{ tvdbId: 99 }, { statistics: { episodeFileCount: 2 } }]
				: [{ tmdbId: 99 }, { movieFile: { id: 99 } }]) {
				let changed = false;
				let deletes = 0;
				await mock(
					async (input, init) => {
						const path = new URL(String(input)).pathname;
						if (path.endsWith("/api"))
							return json({ current: "v5", deprecated: ["v3"] });
						if (path.endsWith("/system/status"))
							return json({ appName: "Sonarr", version: "5.0.0-fixture" });
						if (init?.method === "DELETE") {
							deletes++;
							return new Response(null, { status: 204 });
						}
						const item = {
							id: 7,
							title: "Approved",
							path: "/approved",
							tvdbId: 10,
							tmdbId: 10,
							hasFile: true,
							statistics: { episodeFileCount: 1 },
							movieFile: { id: 80 },
							...(changed ? drift : {}),
						};
						return json(path.endsWith("/7") ? item : []);
					},
					async () => {
						const preview = await service.prepareRemoval("library", [7]);
						assert.ok(preview.ok && preview.data);
						changed = true;
						const result = await withFixtureRemovalAuthority(
							[
								`https://fixture.invalid/base/api/v3/${service.id === "sonarr" ? "series" : "movie"}/7`,
							],
							() =>
								service.executeRemoval(preview.data, {
									deleteFiles: true,
								}),
						);
						assert.equal(deletes, 0);
						assert.equal(result.data?.failed, 1);
					},
				);
			}
		}
	}),
	test("mapping auto-fix cannot import a freshly manual-review-required queue item", async () => {
		let queueReads = 0;
		let submitted = false;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith("/queue")) {
					queueReads++;
					return json({
						totalRecords: submitted ? 0 : 1,
						records: submitted
							? []
							: [
									{
										...queueItem,
										statusMessages: [
											{
												title:
													queueReads === 1
														? "TheXEM mapping issue"
														: "unable to determine if file is a sample",
											},
										],
									},
								],
					});
				}
				if (path.endsWith("/manualimport"))
					return json([
						{
							id: 21,
							path: "/downloads/approved/file.mkv",
							series: { id: 10 },
							seasonNumber: 1,
							episodes: [{ id: 11 }],
							rejections: [],
						},
					]);
				if (path.endsWith("/episode/11"))
					return json({
						id: 11,
						seriesId: 10,
						seasonNumber: 1,
						hasFile: submitted,
						episodeFileId: submitted ? 80 : 0,
					});
				if (init?.method === "POST") {
					submitted = true;
					return json({ id: 1 });
				}
				if (path.endsWith("/command/1"))
					return json({ id: 1, status: "completed" });
				throw new Error(`Unexpected request: ${path}`);
			},
			async () => {
				const result = await new SonarrService(
					"sonarr",
					config,
				).queueDiagnostics(true);
				assert.ok(result.ok);
				assert.equal(submitted, false);
				assert.equal(result.data?.summary.fixed, 0);
				assert.equal(result.data?.fixesAttempted[0]?.success, false);
			},
		);
	}),
	test("library removal requires a successful absence readback after DELETE", async () => {
		for (const service of services()) {
			for (const status of [204, 404]) {
				for (const outcome of ["present", "absent", "invalid", "unavailable"]) {
					let deletes = 0;
					let readbacks = 0;
					const item = { id: 7, title: "Approved", path: "/approved" };
					await mock(
						async (input, init) => {
							const path = new URL(String(input)).pathname;
							if (path.endsWith("/api"))
								return json({ current: "v5", deprecated: ["v3"] });
							if (path.endsWith("/system/status"))
								return json({ appName: "Sonarr", version: "5.0.0-fixture" });
							if (init?.method === "DELETE") {
								deletes++;
								return new Response(null, { status });
							}
							if (path.endsWith("/7")) return json(item);
							assert.ok(deletes > 0);
							readbacks++;
							if (outcome === "unavailable")
								return new Response(null, { status: 503 });
							return json(
								outcome === "invalid" ? {} : outcome === "absent" ? [] : [item],
							);
						},
						async () => {
							const preview = await service.prepareRemoval("library", [7]);
							assert.ok(preview.ok && preview.data);
							const result = await withFixtureRemovalAuthority(
								[
									`https://fixture.invalid/base/api/v3/${service.id === "sonarr" ? "series" : "movie"}/7`,
								],
								() =>
									service.executeRemoval(preview.data, {
										deleteFiles: true,
									}),
							);
							assert.equal(deletes, 1);
							assert.ok(readbacks > 0);
							assert.equal(result.data?.removed, outcome === "absent" ? 1 : 0);
							assert.equal(result.data?.failed, outcome === "absent" ? 0 : 1);
						},
					);
				}
			}
		}
	}),
	test("library deletion rejects changed approved title or path", async () => {
		for (const service of services()) {
			for (const drift of [{ title: "Unapproved" }, { path: "/other" }]) {
				let changed = false;
				let deletes = 0;
				await mock(
					async (input, init) => {
						const path = new URL(String(input)).pathname;
						if (path.endsWith("/api"))
							return json({ current: "v5", deprecated: ["v3"] });
						if (path.endsWith("/system/status"))
							return json({ appName: "Sonarr", version: "5.0.0-fixture" });
						if (init?.method === "DELETE") {
							deletes++;
							return new Response(null, { status: 204 });
						}
						return json({
							id: 7,
							title: "Approved",
							path: "/approved",
							hasFile: false,
							...(changed ? drift : {}),
						});
					},
					async () => {
						const preview = await service.prepareRemoval("library", [7]);
						assert.ok(preview.ok && preview.data);
						changed = true;
						const result = await withFixtureRemovalAuthority(
							[
								`https://fixture.invalid/base/api/v3/${service.id === "sonarr" ? "series" : "movie"}/7`,
							],
							() =>
								service.executeRemoval(preview.data, {
									deleteFiles: true,
								}),
						);
						assert.equal(deletes, 0);
						assert.equal(result.data?.removed, 0);
						assert.equal(result.data?.failed, 1);
					},
				);
			}
		}
	}),
	test("discard rejects changed queue identity, download, path or review evidence", async () => {
		for (const service of services()) {
			for (const drift of [
				{ downloadId: "replacement-download" },
				{ downloadClient: "different-client" },
				{ trackedDownloadStatus: "warning" },
				{ outputPath: "/downloads/replacement" },
				{ seriesId: 99, episodeId: 100, movieId: 99 },
				{ statusMessages: [{ title: "manual investigation required" }] },
			]) {
				let changed = false;
				let deletes = 0;
				await mock(
					async (input, init) => {
						const path = new URL(String(input)).pathname;
						if (path.endsWith("/api"))
							return json({ current: "v5", deprecated: ["v3"] });
						if (path.endsWith("/system/status"))
							return json({ appName: "Sonarr", version: "5.0.0-fixture" });
						if (init?.method === "DELETE") {
							deletes++;
							return new Response(null, { status: 204 });
						}
						assert.ok(path.endsWith("/queue"));
						return json({
							totalRecords: deletes ? 0 : 1,
							records: deletes
								? []
								: [{ ...queueItem, ...(changed ? drift : {}) }],
						});
					},
					async () => {
						const preview = await service.prepareRemoval("queue", [7]);
						assert.ok(preview.ok && preview.data);
						changed = true;
						const result = await withFixtureRemovalAuthority(
							["https://fixture.invalid/base/api/v3/queue/7"],
							() =>
								service.executeRemoval(preview.data, {
									attemptManualImport: false,
								}),
						);
						assert.equal(deletes, 0, `${service.id}: ${JSON.stringify(drift)}`);
						assert.equal(result.data?.removed, 0);
						assert.equal(result.data?.failed, 1);
						assert.match(
							result.data?.details[0]?.message ?? "",
							/preview|confirm/i,
						);
					},
				);
			}
		}
	}),
]);

if (import.meta.url === `file://${process.argv[1]}`) testRunner.printSummary();
