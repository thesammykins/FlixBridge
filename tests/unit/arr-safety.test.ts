import assert from "node:assert/strict";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import { withFixtureRemovalAuthority } from "../helpers/removal-authority.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

const service = () =>
	new SonarrService("sonarr-test", {
		baseUrl: "http://mock:8989",
		apiKey: "test-key",
	});
const record = {
	id: 1,
	title: "Show",
	status: "warning",
	downloadId: "download",
	outputPath: "/downloads/show",
	seriesId: 2,
	episodeId: 3,
	seasonNumber: 1,
	errorMessage: "TheXEM mapping required",
};
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

await describe("ARR safety", [
	test("diagnostics refuses to claim totals from a limited queue snapshot", async () => {
		await mock(
			async () => json({ totalRecords: 300, records: [record] }),
			async () => {
				assert.equal((await service().queueDiagnostics(true)).ok, false);
			},
		);
	}),
	test("removal does not auto-import a manual-review warning", async () => {
		let posts = 0;
		const s = service();
		await mock(
			async (_input, init) => {
				if (init?.method === "POST") posts++;
				return json({
					totalRecords: 1,
					records: [{ ...record, errorMessage: "sample; TheXEM mapping" }],
				});
			},
			async () => {
				const prep = await s.prepareRemoval("queue", [1]);
				assert.equal(prep.data?.targets[0]?.manualReviewRequired, true);
				assert.ok(prep.data);
				await withFixtureRemovalAuthority(
					["http://mock:8989/api/v3/queue/1"],
					() => s.executeRemoval(prep.data, {}),
				);
				assert.equal(posts, 0);
			},
		);
	}),
	test("queue DELETE acknowledgement cannot prove removal on a limited page", async () => {
		let deleted = false;
		const s = service();
		await mock(
			async (_input, init) => {
				if (init?.method === "DELETE") {
					deleted = true;
					return json({});
				}
				return json(
					deleted
						? { totalRecords: 8, records: [] }
						: { totalRecords: 1, records: [record] },
				);
			},
			async () => {
				const prep = await s.prepareRemoval("queue", [1]);
				assert.ok(prep.data);
				const result = await withFixtureRemovalAuthority(
					["http://mock:8989/api/v3/queue/1"],
					() =>
						s.executeRemoval(prep.data, {
							attemptManualImport: false,
						}),
				);
				assert.equal(result.data?.removed, 0);
				assert.equal(result.data?.failed, 1);
			},
		);
	}),
	test("quality downgrade diagnostics never authorize discard", async () => {
		let deletes = 0;
		await mock(
			async (_input, init) => {
				if (init?.method === "DELETE") deletes++;
				return json({
					totalRecords: 1,
					records: [{ ...record, errorMessage: "Not an upgrade" }],
				});
			},
			async () => {
				const result = await service().queueDiagnostics(true);
				assert.equal(deletes, 0);
				assert.equal(
					result.data?.issuesAnalyzed[0]?.category.autoFixable,
					false,
				);
			},
		);
	}),
	test("removal retains ambiguous imports unless caller explicitly opts into discard", async () => {
		for (const discard of [false, true]) {
			let deletes = 0;
			const s = service();
			await mock(
				async (input, init) => {
					if (init?.method === "DELETE") {
						deletes++;
						return json({});
					}
					return new URL(String(input)).pathname.endsWith("manualimport")
						? json([])
						: json({
								totalRecords: deletes ? 0 : 1,
								records: deletes ? [] : [record],
							});
				},
				async () => {
					const prep = await s.prepareRemoval("queue", [1]);
					assert.ok(prep.data);
					const result = await withFixtureRemovalAuthority(
						["http://mock:8989/api/v3/queue/1"],
						() =>
							s.executeRemoval(
								prep.data,
								discard ? { attemptManualImport: false } : {},
							),
					);
					assert.equal(deletes, discard ? 1 : 0);
					assert.equal(result.data?.removed, discard ? 1 : 0);
					assert.equal(result.data?.failed, discard ? 0 : 1);
				},
			);
		}
	}),
	test("import success requires command completion, not queue disappearance alone", async () => {
		for (const status of ["queued", "failed", "completed"]) {
			let posted = false;
			await mock(
				async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (init?.method === "POST") {
						assert.equal(path, "/api/v3/command");
						posted = true;
						return json({ id: 42 });
					}
					if (path === "/api/v3/command/42") return json({ id: 42, status });
					if (path === "/api/v3/episode/3")
						return json({
							id: 3,
							seriesId: 2,
							seasonNumber: 1,
							hasFile: posted,
							episodeFileId: posted ? 99 : 0,
						});
					if (path.endsWith("manualimport"))
						return json([
							{
								id: 1,
								path: "/downloads/show/file.mkv",
								series: { id: 2 },
								seasonNumber: 1,
								episodes: [{ id: 3 }],
							},
						]);
					return json({
						totalRecords: posted ? 0 : 1,
						records: posted ? [] : [record],
					});
				},
				async () => {
					const result = await service().queueDiagnostics(true);
					assert.equal(
						result.data?.fixesAttempted[0]?.success,
						status === "completed",
					);
				},
			);
		}
	}),
	test("removal retains downloads while the import command is pending", async () => {
		let deletes = 0;
		await mock(
			async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (init?.method === "DELETE") {
					deletes++;
					return json({});
				}
				if (init?.method === "POST") return json({ id: 42 });
				if (path === "/api/v3/command/42")
					return json({ id: 42, status: "queued" });
				if (path === "/api/v3/episode/3")
					return json({
						id: 3,
						seriesId: 2,
						seasonNumber: 1,
						hasFile: false,
						episodeFileId: 0,
					});
				if (path.endsWith("manualimport"))
					return json([
						{
							id: 1,
							path: "/downloads/show/file.mkv",
							series: { id: 2 },
							seasonNumber: 1,
							episodes: [{ id: 3 }],
						},
					]);
				return json({ totalRecords: 1, records: [record] });
			},
			async () => {
				const s = service();
				const prep = await s.prepareRemoval("queue", [1]);
				assert.ok(prep.data);
				const result = await withFixtureRemovalAuthority(
					["http://mock:8989/api/v3/queue/1"],
					() => s.executeRemoval(prep.data, {}),
				);
				assert.equal(result.data?.failed, 1);
				assert.equal(deletes, 0);
			},
		);
	}),
	test("queue DELETE 404 cannot prove absence without complete readback", async () => {
		await mock(
			async (_input, init) =>
				init?.method === "DELETE"
					? new Response("{}", { status: 404 })
					: json({ totalRecords: 1, records: [record] }),
			async () => {
				const s = service();
				const prep = await s.prepareRemoval("queue", [1]);
				assert.ok(prep.data);
				const result = await withFixtureRemovalAuthority(
					["http://mock:8989/api/v3/queue/1"],
					() =>
						s.executeRemoval(prep.data, {
							attemptManualImport: false,
						}),
				);
				assert.equal(result.data?.removed, 0);
				assert.equal(result.data?.failed, 1);
			},
		);
	}),
	test("manual import rejects partially unmapped episodes", async () => {
		await mock(
			async (input) =>
				new URL(String(input)).pathname.endsWith("manualimport")
					? json([
							{
								id: 1,
								path: "/downloads/show/file.mkv",
								series: { id: 2 },
								seasonNumber: 1,
								episodes: [{ id: 3 }, {}],
							},
						])
					: json({ totalRecords: 1, records: [record] }),
			async () => {
				assert.equal(
					(await service().previewManualImport([1])).data?.summary.safe,
					0,
				);
			},
		);
	}),
	test("manual import requires a file path and complete positive mapping", async () => {
		for (const candidate of [
			{ id: 1, series: { id: 2 }, episodes: [{ id: 3 }] },
			{
				id: 1,
				path: "/downloads/show/file.mkv",
				series: { id: 2 },
				episodes: [{ id: 3 }],
			},
			{
				id: 1,
				path: "/downloads/show/file.mkv",
				series: { id: 2 },
				seasonNumber: 1,
				episodes: [{ id: -3 }],
			},
			{
				id: 1,
				path: "/downloads/show/file.mkv",
				series: { id: 2 },
				seasonNumber: 1,
				episodes: [{ id: 3 }],
				rejections: [{}],
			},
		]) {
			await mock(
				async (input) =>
					new URL(String(input)).pathname.endsWith("manualimport")
						? json([candidate])
						: json({ totalRecords: 1, records: [record] }),
				async () => {
					assert.equal(
						(await service().previewManualImport([1])).data?.summary.safe,
						0,
					);
				},
			);
		}
	}),
	test("automatic mapping import rejects ambiguous candidate selection", async () => {
		let posts = 0;
		await mock(
			async (input, init) => {
				if (init?.method === "POST") {
					posts++;
					return json({});
				}
				return new URL(String(input)).pathname.endsWith("manualimport")
					? json(
							[1, 2].map((id) => ({
								id,
								path: `/downloads/show/${id}.mkv`,
								series: { id: 2 },
								seasonNumber: 1,
								episodes: [{ id }],
							})),
						)
					: json({ totalRecords: 1, records: [record] });
			},
			async () => {
				const result = await service().queueDiagnostics(true);
				assert.equal(posts, 0);
				assert.equal(result.data?.fixesAttempted[0]?.success, false);
			},
		);
	}),
	test("profile updates require affirmative matching readback", async () => {
		for (const readback of [
			{ id: 1, qualityProfileId: 2 },
			{ id: 9, qualityProfileId: 3 },
			{},
		]) {
			let reads = 0;
			await mock(
				async (_input, init) =>
					init?.method === "PUT"
						? json({})
						: json(++reads === 1 ? { id: 1, qualityProfileId: 2 } : readback),
				async () => {
					assert.equal((await service().updateQualityProfile(1, 3)).ok, false);
				},
			);
		}
	}),
	test("episode lookup requires coordinates and exactly one file match", async () => {
		const episode = {
			id: 1,
			episodeFileId: 10,
			seasonNumber: 1,
			episodeNumber: 2,
			hasFile: true,
		};
		await mock(
			async () => json([episode, { ...episode, id: 2, episodeFileId: 11 }]),
			async () => {
				assert.equal((await service().lookupEpisodeFile(1)).ok, false);
				assert.equal((await service().lookupEpisodeFile(1, 1, 2)).ok, false);
			},
		);
	}),
	test("limited and metadata-free queue pages cannot prove absence", async () => {
		for (const body of [{ totalRecords: 5, records: [] }, { records: [] }]) {
			await mock(
				async () => json(body),
				async () => {
					assert.equal((await service().queueList()).data?.truncated, true);
					assert.equal(
						(await service().prepareRemoval("queue", [1])).ok,
						false,
					);
				},
			);
		}
	}),
	test("credentials use headers for reads and writes", async () => {
		await mock(
			async (input, init) => {
				assert.equal(new URL(String(input)).searchParams.has("apikey"), false);
				assert.equal(new Headers(init?.headers).get("X-Api-Key"), "test-key");
				return json({ totalRecords: 0, records: [] });
			},
			async () => {
				assert.equal((await service().queueList()).ok, true);
				assert.equal((await service().queueGrab([1])).ok, true);
			},
		);
	}),
	test("manual warnings override mapping, downgrade and retry hints", async () => {
		for (const warning of [
			"matched by ID",
			"sample",
			"episodes expected",
			"Manual investigation required",
			"permission denied",
			"disk full",
		]) {
			await mock(
				async () =>
					json({
						totalRecords: 1,
						records: [
							{
								...record,
								errorMessage: `TheXEM mapping; not an upgrade; connection timeout; ${warning}`,
							},
						],
					}),
				async () => {
					const result = await service().queueDiagnostics(true);
					assert.equal(
						result.data?.issuesAnalyzed[0]?.category.autoFixable,
						false,
						warning,
					);
					assert.equal(result.data?.fixesAttempted.length, 0, warning);
				},
			);
		}
	}),
	test("diagnostics defaults to read only", async () => {
		const methods: string[] = [];
		await mock(
			async (_input, init) => {
				methods.push(init?.method ?? "GET");
				return json({ totalRecords: 1, records: [record] });
			},
			async () => {
				const result = await service().queueDiagnostics();
				assert.equal(result.data?.fixesAttempted.length, 0);
				assert.deepEqual(methods, ["GET"]);
			},
		);
	}),
]);
if (process.argv[1]?.endsWith("arr-safety.test.ts")) testRunner.printSummary();
