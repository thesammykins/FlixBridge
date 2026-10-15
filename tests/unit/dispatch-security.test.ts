import assert from "node:assert/strict";
import { ArrMcpServer, InputSchema } from "../../src/index.js";
import { serviceRegistry } from "../../src/services/registry.js";
import {
	MockRadarrService,
	createMockServiceConfig,
} from "../helpers/mock-services.js";
import { describe, test } from "../helpers/test-runner.js";

type Probe = {
	handleRemoveContent(
		input: Record<string, unknown>,
	): Promise<{ ok: boolean; data?: { confirmationToken?: string } }>;
	normalizeNumericIds(ids: string[]): number[];
	runAllServicesDiagnostics(
		autoFix?: boolean,
	): Promise<{ ok: boolean; data: { incomplete: boolean } }>;
	runDownloadStatus(input: {
		services: string[];
		includeDownloader: boolean;
		downloader?: string;
	}): Promise<{ ok: boolean; data: { incomplete: boolean } }>;
};
const server = new ArrMcpServer() as unknown as Probe;
await describe("MCP dispatch safety", [
	test("coupled downloader removal only follows successful ARR targets", async () => {
		const service = new MockRadarrService(
			"radarr-test",
			createMockServiceConfig(),
		);
		service.prepareRemoval = async () => ({
			ok: true,
			data: {
				service: "radarr-test",
				mediaKind: "movie",
				kind: "queue",
				requestedIds: [1, 2],
				missingIds: [],
				targets: [1, 2].map((id) => ({
					id,
					source: "queue",
					title: "Item",
					mediaKind: "movie",
					downloadId: `SAB-${id}`,
					protocol: "usenet",
				})),
			},
		});
		service.executeRemoval = async () => ({
			ok: true,
			data: {
				service: "radarr-test",
				mediaKind: "movie",
				kind: "queue",
				removed: 1,
				failed: 1,
				skipped: 0,
				missingIds: [],
				details: [
					{ id: 1, title: "Item", source: "queue", status: "removed" },
					{ id: 2, title: "Item", source: "queue", status: "failed" },
				],
			},
		});
		const originalGet = serviceRegistry.get;
		const originalDownloader = serviceRegistry.getDownloader;
		const removed: string[][] = [];
		serviceRegistry.get = () => service;
		serviceRegistry.getDownloader = () =>
			({
				prepareRemoval: async () => ({
					ok: true,
					data: { items: [], missingIds: [] },
				}),
				removeQueueItems: async (ids: string[]) => {
					removed.push(ids);
					return { ok: true, data: { details: [], missingIds: [] } };
				},
			}) as unknown as ReturnType<typeof originalDownloader>;
		try {
			const input = {
				service: "radarr-test",
				ids: [1, 2],
				removeFromDownloader: true,
				downloader: "sab-one",
			};
			const preview = await server.handleRemoveContent(input);
			await server.handleRemoveContent({
				...input,
				dryRun: false,
				confirmationToken: preview.data?.confirmationToken,
			});
			assert.deepEqual(removed, [["SAB-1"]]);
		} finally {
			serviceRegistry.get = originalGet;
			serviceRegistry.getDownloader = originalDownloader;
		}
	}),
	test("bounded inputs reject fractional IDs and excessive arrays", () => {
		for (const input of [
			{ itemId: 1.5 },
			{ pageSize: 10001 },
			{ ids: Array(1001).fill(1) },
			{ queueTimeoutMs: 1.5 },
		])
			assert.equal(InputSchema.safeParse(input).success, false);
	}),
	test("ARR identifiers reject noncanonical and fractional values", () => {
		for (const id of ["1.5", "1e2", "01", " 1", "0", "9007199254740993"])
			assert.throws(() => server.normalizeNumericIds([id]));
		assert.deepEqual(server.normalizeNumericIds(["2", "1"]), [1, 2]);
	}),
	test("diagnostics default to read-only and retain failures", async () => {
		const service = new MockRadarrService(
			"radarr-test",
			createMockServiceConfig(),
		);
		let auto: boolean | undefined;
		service.queueDiagnostics = async (value) => {
			auto = value;
			return { ok: false, error: { kind: "internal", message: "Unavailable" } };
		};
		const original = serviceRegistry.getAll;
		serviceRegistry.getAll = () => [service];
		try {
			const result = await server.runAllServicesDiagnostics();
			assert.equal(auto, false);
			assert.equal(result.ok, false);
			assert.equal(result.data.incomplete, true);
		} finally {
			serviceRegistry.getAll = original;
		}
	}),
	test("requested downloader failures cannot produce a successful aggregate", async () => {
		const original = serviceRegistry.getDownloader;
		try {
			for (const downloader of [
				undefined,
				{
					serverStats: async () => ({
						ok: false,
						error: { kind: "internal", message: "Unavailable" },
					}),
					queueList: async () => ({
						ok: false,
						error: { kind: "internal", message: "Unavailable" },
					}),
				},
				{
					serverStats: async () => {
						throw new Error("Unavailable");
					},
					queueList: async () => ({ ok: false }),
				},
			]) {
				serviceRegistry.getDownloader = () =>
					downloader as ReturnType<typeof original>;
				const result = await server.runDownloadStatus({
					services: [],
					includeDownloader: true,
					downloader: "sab-fixture",
				});
				assert.equal(result.ok, false);
				assert.equal(result.data.incomplete, true);
			}
		} finally {
			serviceRegistry.getDownloader = original;
		}
	}),
	test("unknown download service produces explicit incomplete failure", async () => {
		const result = await server.runDownloadStatus({
			services: ["missing"],
			includeDownloader: false,
		});
		assert.equal(result.ok, false);
		assert.equal(result.data.incomplete, true);
	}),
]);
