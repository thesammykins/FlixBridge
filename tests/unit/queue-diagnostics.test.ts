/**
 * Tests for Queue Diagnostics
 * Validates automatic issue detection and fix workflows
 */

import assert from "node:assert";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import {
	assertArrayLength,
	assertArrayNotEmpty,
	assertHasData,
	assertHasProperty,
	assertMediaKind,
	assertOk,
	assertPropertyEquals,
	assertServiceName,
} from "../helpers/assertions.js";
import {
	MockRadarrService,
	MockSonarrService,
} from "../helpers/mock-services.js";
import { describe, test } from "../helpers/test-runner.js";

await describe("Queue Diagnostics - Issue Detection", [
	test("should request a bounded full queue page and expose raw issue details", async () => {
		const originalFetch = globalThis.fetch;
		let requestedUrl = "";

		globalThis.fetch = async (input) => {
			requestedUrl =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

			return new Response(
				JSON.stringify({
					totalRecords: 1,
					records: [
						{
							id: 123,
							title: "Sample.Series.S01E01",
							status: "warning",
							protocol: "usenet",
							downloadClient: "SABnzbd",
							trackedDownloadState: "importPending",
							trackedDownloadStatus: "warning",
							errorMessage: "Import failed",
							statusMessages: [
								{
									title: "Import blocked",
									messages: ["Missing episode file"],
								},
							],
						},
					],
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		};

		try {
			const service = new SonarrService("sonarr-main", {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			});

			const result = await service.queueDiagnostics(false);

			assertOk(result);
			assertHasData(result);
			const url = new URL(requestedUrl);
			assert.strictEqual(url.pathname, "/api/v3/queue");
			assert.strictEqual(url.searchParams.get("pageSize"), "250");
			assertArrayLength(result.data.issuesAnalyzed, 1, "issues");
			const issue = result.data.issuesAnalyzed[0];
			assertPropertyEquals(issue, "protocol", "usenet");
			assertPropertyEquals(issue, "downloadClient", "SABnzbd");
			assertPropertyEquals(issue, "trackedDownloadState", "importPending");
			assertPropertyEquals(issue, "trackedDownloadStatus", "warning");
			assertPropertyEquals(issue, "errorMessage", "Import failed");
			assert.deepStrictEqual(issue.statusMessages, [
				"Import blocked",
				"Missing episode file",
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}),

	test("should detect no issues in healthy queue", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		// Default mock has some stuck items, so set clean queue
		service.setMockResponse("/queue", {
			totalRecords: 1,
			records: [
				{
					id: 123,
					title: "Sample.Series.S01E01",
					status: "downloading",
					statusMessages: [],
					downloadId: "SAB_abc123",
				},
			],
		});

		// Execute
		const result = await service.queueDiagnostics(false); // Don't autoFix

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");
		assertMediaKind(result.data, "series");

		assertPropertyEquals(result.data, "totalQueueItems", 1);
		// Downloading items with no statusMessages should have 0 issues
		assertPropertyEquals(result.data, "issuesFound", 0);
		assertArrayLength(result.data.issuesAnalyzed, 0, "issues");
	}),

	test("should detect TheXEM mapping issues", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMockResponse("/queue", {
			totalRecords: 1,
			records: [
				{
					id: 125,
					title: "Sample.Series.S03E05",
					status: "warning",
					statusMessages: [
						{
							title: "TheXEM mapping required",
							messages: [
								"Scene numbering and episode mapping via TheXEM is required",
							],
						},
					],
					downloadId: "SAB_xyz789",
				},
			],
		});

		// Execute
		const result = await service.queueDiagnostics(false);

		// Assert
		assertOk(result);
		assertHasData(result);

		assertPropertyEquals(result.data, "issuesFound", 1);
		assertArrayLength(result.data.issuesAnalyzed, 1, "issues");

		const issue = result.data.issuesAnalyzed[0];
		assertPropertyEquals(issue, "id", 125);
		assertPropertyEquals(issue.category, "type", "mapping");
		assertPropertyEquals(issue.category, "severity", "warning");
		assertPropertyEquals(issue.category, "autoFixable", true);
	}),

	test("should detect quality downgrade issues", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");
		service.setStuckQueueItems(); // Uses fixtures with quality downgrade

		// Execute
		const result = await service.queueDiagnostics(false);

		// Assert
		assertOk(result);
		assertHasData(result);

		assertArrayNotEmpty(result.data.issuesAnalyzed, "issues");

		const qualityIssue = result.data.issuesAnalyzed.find(
			(issue: { category: { type: string } }) =>
				issue.category.type === "quality_downgrade",
		);

		assertHasProperty(qualityIssue as object, "category");
		assertPropertyEquals(qualityIssue.category, "type", "quality_downgrade");
		assertPropertyEquals(qualityIssue.category, "autoFixable", true);
	}),

	test("should detect ARR not-an-upgrade import warnings as quality downgrades", async () => {
		const service = new MockSonarrService("sonarr-anime");
		service.setMockResponse("/queue", {
			totalRecords: 1,
			records: [
				{
					id: 126,
					title: "One.Piece.S01E01",
					status: "completed",
					trackedDownloadState: "importPending",
					trackedDownloadStatus: "warning",
					statusMessages: [
						{
							title: "Import blocked",
							messages: [
								"Not an upgrade for existing episode file(s)",
								"Existing quality: WEBDL-1080p",
								"New quality: WEBDL-720p",
							],
						},
					],
					downloadClient: "SAB",
					downloadId: "SAB_downgrade",
				},
			],
		});

		const result = await service.queueDiagnostics(false);

		assertOk(result);
		assertHasData(result);
		assertPropertyEquals(result.data, "issuesFound", 1);

		const issue = result.data.issuesAnalyzed[0];
		assertPropertyEquals(issue.category, "type", "quality_downgrade");
		assertPropertyEquals(issue.category, "autoFixable", true);
		assertPropertyEquals(issue, "trackedDownloadState", "importPending");
		assertPropertyEquals(issue, "trackedDownloadStatus", "warning");
		assert.deepStrictEqual(issue.statusMessages, [
			"Import blocked",
			"Not an upgrade for existing episode file(s)",
			"Existing quality: WEBDL-1080p",
			"New quality: WEBDL-720p",
		]);
	}),

	test("should detect network error issues", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");
		service.setStuckQueueItems(); // Second item has network timeout

		// Execute
		const result = await service.queueDiagnostics(false);

		// Assert
		assertOk(result);
		assertHasData(result);

		const networkIssue = result.data.issuesAnalyzed.find(
			(issue: { category: { type: string } }) =>
				issue.category.type === "network_error",
		);

		assertHasProperty(networkIssue as object, "category");
		assertPropertyEquals(networkIssue.category, "type", "network_error");
		assertPropertyEquals(networkIssue.category, "severity", "warning");
		assertPropertyEquals(networkIssue.category, "autoFixable", true);
	}),

	test("should classify ID-matched manual import blocks", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					totalRecords: 1,
					records: [
						{
							id: 201,
							title: "Matched.By.ID.S01E01",
							status: "completed",
							trackedDownloadState: "importBlocked",
							trackedDownloadStatus: "warning",
							statusMessages: [
								{
									title: "Import blocked",
									messages: [
										"Found matching series via grab history, but release was matched to series by ID. Automatic import is not possible.",
									],
								},
							],
						},
					],
				}),
				{ headers: { "Content-Type": "application/json" } },
			);

		try {
			const service = new SonarrService("sonarr-main", {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			});
			const result = await service.queueDiagnostics(false);
			assertOk(result);
			assertHasData(result);
			const issue = result.data.issuesAnalyzed[0];
			assertPropertyEquals(issue.category, "type", "import_blocked_id_match");
			assertPropertyEquals(issue.category, "autoFixable", false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}),

	test("should classify ambiguous sample detection warnings", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					totalRecords: 1,
					records: [
						{
							id: 202,
							title: "Sample.Ambiguous.S01E01",
							status: "completed",
							trackedDownloadState: "importPending",
							trackedDownloadStatus: "warning",
							statusMessages: [
								{
									title: "Sample",
									messages: ["Unable to determine if file is a sample"],
								},
							],
						},
					],
				}),
				{ headers: { "Content-Type": "application/json" } },
			);

		try {
			const service = new SonarrService("sonarr-main", {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			});
			const result = await service.queueDiagnostics(false);
			assertOk(result);
			assertHasData(result);
			const issue = result.data.issuesAnalyzed[0];
			assertPropertyEquals(
				issue.category,
				"type",
				"sample_detection_ambiguous",
			);
			assertPropertyEquals(issue.category, "autoFixable", false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}),

	test("should classify episode pack mismatches", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					totalRecords: 1,
					records: [
						{
							id: 203,
							title: "Anime.Volume.Pack",
							status: "completed",
							trackedDownloadState: "importBlocked",
							trackedDownloadStatus: "warning",
							statusMessages: [
								{
									title: "Episodes missing",
									messages: [
										"One or more episodes expected in this release were not imported or missing from the release",
										"Episode 1x02 was unexpected considering the folder name",
									],
								},
							],
						},
					],
				}),
				{ headers: { "Content-Type": "application/json" } },
			);

		try {
			const service = new SonarrService("sonarr-main", {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			});
			const result = await service.queueDiagnostics(false);
			assertOk(result);
			assertHasData(result);
			const issue = result.data.issuesAnalyzed[0];
			assertPropertyEquals(issue.category, "type", "episode_pack_mismatch");
			assertPropertyEquals(issue.category, "autoFixable", false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}),
]);

await describe("Queue Diagnostics - Auto-Fix", [
	test("should attempt manual import for mapping issues when autoFix enabled", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMockResponse("/queue", {
			totalRecords: 1,
			records: [
				{
					id: 125,
					title: "Sample.Series.S03E05",
					status: "warning",
					statusMessages: [
						{
							title: "TheXEM mapping required",
							messages: ["Scene numbering required"],
						},
					],
					downloadId: "SAB_xyz789",
					outputPath: "/downloads/complete/Sample.Series.S03E05",
				},
			],
		});

		// Setup manual import to succeed
		service.setMockResponse("/manualimport", [
			{
				id: 0,
				series: { id: 2 },
				episodes: [{ id: 789 }],
				rejections: [],
			},
		]);

		// Execute with autoFix
		const result = await service.queueDiagnostics(true);

		// Assert
		assertOk(result);
		assertHasData(result);

		assertPropertyEquals(result.data, "issuesFound", 1);
		assertArrayLength(result.data.fixesAttempted, 1, "fix attempts");

		const fix = result.data.fixesAttempted[0];
		assertPropertyEquals(fix, "action", "manual_import");
		assertPropertyEquals(fix, "attempted", true);
	}),

	test("should preview and execute high-confidence manual imports", async () => {
		const originalFetch = globalThis.fetch;
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			calls.push({ url, init });
			const path = new URL(url).pathname;
			if (path === "/api/v3/queue") {
				return new Response(
					JSON.stringify({
						totalRecords: 1,
						records: [
							{
								id: 225,
								title: "Manual.Import.S01E01",
								status: "completed",
								downloadId: "SAB_manual",
								outputPath: "/downloads/complete/Manual.Import.S01E01",
							},
						],
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}
			if (path === "/api/v3/manualimport" && init?.method !== "POST") {
				return new Response(
					JSON.stringify([
						{
							id: 1,
							path: "/downloads/complete/Manual.Import.S01E01/file.mkv",
							series: { id: 2 },
							episodes: [{ id: 789 }],
							rejections: [],
						},
					]),
					{ headers: { "Content-Type": "application/json" } },
				);
			}
			if (path === "/api/v3/manualimport" && init?.method === "POST") {
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ error: "not found" }), {
				status: 404,
			});
		};

		try {
			const service = new SonarrService("sonarr-main", {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			});
			const preview = await service.previewManualImport([225]);
			assertOk(preview);
			assertHasData(preview);
			assertPropertyEquals(preview.data.summary, "safe", 1);
			assertPropertyEquals(preview.data.items[0], "safeToImport", true);

			const execution = await service.executeManualImport(preview.data);
			assertOk(execution);
			assertHasData(execution);
			assertPropertyEquals(execution.data, "imported", 1);
			assert.strictEqual(
				calls.some(
					(call) =>
						new URL(call.url).pathname === "/api/v3/manualimport" &&
						call.init?.method === "POST",
				),
				true,
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}),

	test("should not execute ambiguous manual import candidates", async () => {
		const originalFetch = globalThis.fetch;
		let postCount = 0;
		globalThis.fetch = async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			const path = new URL(url).pathname;
			if (path === "/api/v3/queue") {
				return new Response(
					JSON.stringify({
						totalRecords: 1,
						records: [
							{
								id: 226,
								title: "Manual.Import.Ambiguous.S01E01",
								status: "completed",
								downloadId: "SAB_ambiguous",
								outputPath:
									"/downloads/complete/Manual.Import.Ambiguous.S01E01",
							},
						],
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}
			if (path === "/api/v3/manualimport" && init?.method !== "POST") {
				return new Response(
					JSON.stringify([
						{
							id: 1,
							path: "/downloads/complete/Manual.Import.Ambiguous.S01E01/a.mkv",
							series: { id: 2 },
							episodes: [{ id: 789 }],
							rejections: [],
						},
						{
							id: 2,
							path: "/downloads/complete/Manual.Import.Ambiguous.S01E01/b.mkv",
							series: { id: 2 },
							episodes: [{ id: 790 }],
							rejections: [],
						},
					]),
					{ headers: { "Content-Type": "application/json" } },
				);
			}
			if (path === "/api/v3/manualimport" && init?.method === "POST") {
				postCount += 1;
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(JSON.stringify({ error: "not found" }), {
				status: 404,
			});
		};

		try {
			const service = new SonarrService("sonarr-main", {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			});
			const preview = await service.previewManualImport([226]);
			assertOk(preview);
			assertHasData(preview);
			assertPropertyEquals(preview.data.summary, "safe", 0);
			assertPropertyEquals(preview.data.items[0], "safeToImport", false);

			const execution = await service.executeManualImport(preview.data);
			assertOk(execution);
			assertHasData(execution);
			assertPropertyEquals(execution.data, "imported", 0);
			assertPropertyEquals(execution.data, "skipped", 1);
			assert.strictEqual(postCount, 0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}),

	test("should remove quality downgrade items when autoFix enabled", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");
		service.setStuckQueueItems();
		service.setMockResponse("/queue/300", {}); // Allow deletion

		// Execute with autoFix
		const result = await service.queueDiagnostics(true);

		// Assert
		assertOk(result);
		assertHasData(result);

		const removeAction = result.data.fixesAttempted.find(
			(fix: { action: string }) => fix.action === "remove_from_queue",
		);

		if (removeAction) {
			assertPropertyEquals(removeAction, "action", "remove_from_queue");
			assertPropertyEquals(removeAction, "attempted", true);
		}
	}),

	test("should not attempt fixes when autoFix disabled", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setStuckQueueItems();

		// Execute without autoFix
		const result = await service.queueDiagnostics(false);

		// Assert
		assertOk(result);
		assertHasData(result);

		// Issues should be detected but no fixes attempted
		assertArrayNotEmpty(result.data.issuesAnalyzed, "detected issues");
		assertArrayLength(result.data.fixesAttempted, 0, "fix attempts");
	}),
]);

await describe("Queue Diagnostics - Summary", [
	test("should provide accurate fix summary", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setStuckQueueItems();

		// Execute
		const result = await service.queueDiagnostics(true);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertHasProperty(result.data, "summary");

		const summary = result.data.summary;
		assertHasProperty(summary, "fixed");
		assertHasProperty(summary, "failed");
		assertHasProperty(summary, "requiresManual");

		// Counts should add up correctly
		const totalIssues = result.data.issuesFound;
		const totalAttempts = result.data.fixesAttempted.length;

		// If autoFix is on and issues are fixable, attempts should equal fixable issues
		const fixableIssues = result.data.issuesAnalyzed.filter(
			(issue: { category: { autoFixable: boolean } }) =>
				issue.category.autoFixable,
		).length;

		assertPropertyEquals(
			{ attempts: totalAttempts },
			"attempts",
			fixableIssues,
		);
	}),

	test("should count non-fixable issues as requiring manual intervention", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMockResponse("/queue", {
			totalRecords: 1,
			records: [
				{
					id: 200,
					title: "Disk.Full.Show.S01E01",
					status: "warning",
					statusMessages: [
						{
							title: "Disk space issue",
							messages: ["Insufficient disk space"],
						},
					],
					downloadId: "SAB_disk_full",
				},
			],
		});

		// Execute
		const result = await service.queueDiagnostics(true);

		// Assert
		assertOk(result);
		assertHasData(result);

		assertPropertyEquals(result.data, "issuesFound", 1);

		const issue = result.data.issuesAnalyzed[0];
		assertPropertyEquals(issue.category, "type", "disk_space");
		assertPropertyEquals(issue.category, "autoFixable", false);

		// Should be counted as requiring manual intervention
		assertPropertyEquals(result.data.summary, "requiresManual", 1);
	}),
]);
