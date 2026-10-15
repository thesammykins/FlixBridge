import assert from "node:assert/strict";
import { ArrMcpServer } from "../../src/index.js";
import { SabnzbdService } from "../../src/services/downloaders/sabnzbd.js";
import { serviceRegistry } from "../../src/services/registry.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

type Request = { url: URL; method: string };

const service = new SabnzbdService({
	baseUrl: "http://sab.invalid",
	apiKey: "dummy",
});
async function withResponses<T>(
	responses: unknown[],
	fn: () => Promise<T>,
	requests: Request[] = [],
): Promise<T> {
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		requests.push({
			url: new URL(String(input)),
			method: init?.method ?? "GET",
		});
		return new Response(JSON.stringify(responses.shift()), {
			headers: { "Content-Type": "application/json" },
		});
	};
	try {
		return await fn();
	} finally {
		globalThis.fetch = original;
	}
}

const slot = {
	nzo_id: "SABnzbd_nzo_1",
	filename: "Example",
	status: "Downloading",
	percentage: "25",
	mb: "100",
	mbleft: "75",
	eta: "1m",
};
// Source-derived synthetic queue fields; no captured provider data.
const queue = (slots = [slot]) => ({
	queue: {
		slots,
		mb: String(slots.reduce((total, item) => total + Number(item.mb), 0)),
		mbleft: String(
			slots.reduce((total, item) => total + Number(item.mbleft), 0),
		),
		kbpersec: slots.length ? "1296.02" : "0.00",
		size: slots.length ? "100 MB" : "0 B",
		sizeleft: slots.length ? "75 MB" : "0 B",
		paused: false,
		noofslots: slots.length,
		noofslots_total: slots.length,
	},
});
// Source-derived synthetic status fields, not a captured provider response.
const statusQueue = {
	version: "4.5.0",
	paused: true,
	noofslots: 1,
	kbpersec: "1296.02",
	speed: "1.3 M",
	speedlimit: "9",
};
type DownloadStatus = {
	ok: boolean;
	data: {
		incomplete: boolean;
		errors: unknown[];
		downloader: Record<string, unknown> | null;
	};
};
async function downloadStatus(response: unknown, requests: Request[]) {
	const instance = new ArrMcpServer();
	instance.initialize({
		services: {},
		downloaders: {
			"sab-fixture": { baseUrl: "http://sab.invalid", apiKey: "synthetic" },
		},
	});
	const dispatch = instance as unknown as {
		executeTool(name: string, input: unknown): Promise<DownloadStatus>;
		toolResult(result: unknown): {
			structuredContent: DownloadStatus;
			content: Array<{ text: string }>;
			isError?: boolean;
		};
	};
	try {
		const result = await withResponses(
			[response, response],
			() =>
				dispatch.executeTool("download_status", {
					services: [],
					includeDownloader: true,
					downloader: "sab-fixture",
				}),
			requests,
		);
		const envelope = dispatch.toolResult(result);
		assert.deepEqual(
			JSON.parse(envelope.content[0]?.text ?? ""),
			envelope.structuredContent,
		);
		assert.equal(envelope.isError === true, !result.ok);
		return envelope.structuredContent;
	} finally {
		serviceRegistry.clear();
	}
}
await describe("SAB response safety", [
	test("complete queues accept absent or matching advertised totals including zero", async () => {
		for (const slots of [[], [slot]]) {
			for (const total of [undefined, slots.length]) {
				const body = {
					queue: { ...queue(slots).queue, noofslots_total: total },
				};
				const result = await withResponses([body], () => service.queueList());
				assert.equal(result.ok, true);
				assert.equal(result.data?.total, slots.length);
			}
		}
	}),
	test("duplicate IDs and mismatched displayed counts still fail closed", async () => {
		for (const body of [
			queue([slot, slot]),
			{ queue: { ...queue().queue, noofslots: 0 } },
			{ queue: { ...queue([]).queue, noofslots: 1 } },
		]) {
			assert.equal(
				(await withResponses([body], () => service.queueList())).ok,
				false,
			);
		}
	}),
	test("advertised partial or malformed totals cannot prove queue completeness or missing targets", async () => {
		for (const [slots, total] of [
			[[], 1],
			[[slot], 2],
			[[slot], 0],
			[[slot], "1"],
			[[slot], null],
			[[slot], -1],
			[[slot], 1.5],
		] as const) {
			const body = {
				queue: { ...queue([...slots]).queue, noofslots_total: total },
			};
			const requests: Request[] = [];
			assert.equal(
				(await withResponses([body], () => service.queueList(), requests)).ok,
				false,
				`queue total=${String(total)}`,
			);
			assert.equal(
				(
					await withResponses(
						[body],
						() => service.prepareRemoval(["missing-nzo"]),
						requests,
					)
				).ok,
				false,
			);
			assert.equal(
				(
					await withResponses(
						[body],
						() => service.removeQueueItems([slot.nzo_id]),
						requests,
					)
				).ok,
				false,
			);
			assert.equal(requests.length, 3);
			assert.equal(
				requests.some(({ url }) => url.searchParams.has("name")),
				false,
			);
		}
	}),
	test("advertised partial removal readback fails verification without replaying deletion", async () => {
		const partial = { queue: { ...queue([]).queue, noofslots_total: 1 } };
		const requests: Request[] = [];
		const result = await withResponses(
			[queue(), { status: true }, partial],
			() => service.removeQueueItems([slot.nzo_id]),
			requests,
		);
		assert.equal(result.data?.removed, 0);
		assert.equal(result.data?.failed, 1);
		assert.match(
			result.data?.details[0]?.message ?? "",
			/could not be verified/,
		);
		assert.equal(requests.length, 3);
		const deletions = requests.filter(
			({ url }) => url.searchParams.get("name") === "delete",
		);
		assert.equal(deletions.length, 1);
		assert.equal(deletions[0]?.url.searchParams.get("value"), slot.nzo_id);
		assert.equal(deletions[0]?.url.searchParams.get("del_files"), "0");
	}),
	test("real download_status dispatch refuses an advertised partial SAB snapshot", async () => {
		const requests: Request[] = [];
		const result = await downloadStatus(
			{ queue: { ...queue().queue, ...statusQueue, noofslots_total: 2 } },
			requests,
		);
		assert.equal(result.ok, false);
		assert.equal(result.data.incomplete, true);
		assert.notEqual(result.data.errors.length, 0);
		assert.equal(result.data.downloader, null);
		assert.equal(requests.length, 2);
		assert.equal(
			requests.some(({ url }) => url.searchParams.has("name")),
			false,
		);
	}),
	test("normalizes empty and nonempty queues from numeric MB and KB/s rather than display fields", async () => {
		for (const slots of [[], [{ ...slot, mb: "1536.50", mbleft: "1024.25" }]]) {
			const body = {
				queue: {
					...queue(slots).queue,
					mb: slots.length ? "1536.50" : "0.00",
					mbleft: slots.length ? "1024.25" : "0.00",
					kbpersec: slots.length ? "1296.02" : "0.00",
					size: slots.length ? "1.5 GB" : "0 B",
					sizeleft: slots.length ? "1.0 GB" : "0 B",
					speed: "1.3 M",
					speedlimit: "9",
				},
			};
			const requests: Request[] = [];
			const result = await withResponses(
				[body],
				() => service.queueList(),
				requests,
			);
			assert.equal(result.ok, true);
			assert.deepEqual(result.data, {
				service: "SABnzbd",
				total: slots.length,
				items: slots.map((item) => ({
					nzoId: item.nzo_id,
					title: item.filename,
					status: item.status,
					progressPct: 25,
					sizeMB: 1536.5,
					sizeLeftMB: 1024.25,
					eta: item.eta,
				})),
				paused: false,
				speedKBps: slots.length ? 1296.02 : 0,
				totalSizeMB: slots.length ? 1536.5 : 0,
				remainingSizeMB: slots.length ? 1024.25 : 0,
			});
			assert.equal(requests.length, 1);
			assert.equal(requests[0]?.method, "GET");
			assert.equal(requests[0]?.url.searchParams.get("mode"), "queue");
			assert.equal(requests[0]?.url.searchParams.has("name"), false);
		}
	}),
	test("rejects invalid or missing canonical queue totals and KB/s", async () => {
		for (const field of ["mb", "mbleft", "kbpersec"]) {
			for (const value of [
				"",
				" ",
				"NaN",
				"Infinity",
				"-1",
				"1.3 M",
				1,
				null,
				undefined,
			]) {
				const body = { queue: { ...queue().queue, [field]: value } };
				assert.equal(
					(await withResponses([body], () => service.queueList())).ok,
					false,
					`${field}=${String(value)}`,
				);
			}
		}
	}),
	test("real download_status dispatch is healthy with complete empty and nonempty formatted SAB queues", async () => {
		for (const slots of [[], [slot]]) {
			const body = {
				queue: {
					...statusQueue,
					...queue(slots).queue,
					paused: true,
				},
			};
			const requests: Request[] = [];
			const result = await downloadStatus(body, requests);
			assert.equal(result.ok, true);
			assert.equal(result.data.incomplete, false);
			assert.deepEqual(result.data.errors, []);
			assert.deepEqual(result.data.downloader, {
				service: "sab-fixture",
				name: "SABnzbd",
				version: "4.5.0",
				isHealthy: true,
				paused: true,
				totalSlots: slots.length,
				speedKBps: slots.length ? 1296.02 : 0,
				totalSizeMB: slots.length ? 100 : 0,
				remainingSizeMB: slots.length ? 75 : 0,
				items: slots.length,
			});
			assert.equal(requests.length, 2);
			for (const request of requests) {
				assert.equal(request.method, "GET");
				assert.equal(request.url.searchParams.get("mode"), "queue");
				assert.equal(request.url.searchParams.has("name"), false);
			}
		}
	}),
	test("reads nested queue status and actual KB/s with a read-only queue request", async () => {
		const requests: Request[] = [];
		const result = await withResponses(
			[{ queue: statusQueue }],
			() => service.serverStats(),
			requests,
		);
		assert.deepEqual(result, {
			ok: true,
			data: {
				service: "SABnzbd",
				name: "SABnzbd",
				version: "4.5.0",
				isHealthy: true,
				paused: true,
				totalSlots: 1,
				speedKBps: 1296.02,
			},
		});
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.method, "GET");
		assert.equal(requests[0]?.url.searchParams.get("mode"), "queue");
		assert.equal(requests[0]?.url.searchParams.get("output"), "json");
		assert.equal(requests[0]?.url.searchParams.has("name"), false);
	}),
	test("server counters and malformed queue status cannot masquerade as health", async () => {
		for (const response of [
			{ total: 100, month: 10, week: 5, day: 1, servers: {} },
			statusQueue,
			{ queue: { ...statusQueue, version: null } },
			{ queue: { ...statusQueue, paused: "false" } },
			{ queue: { ...statusQueue, noofslots: -1 } },
			{ queue: { ...statusQueue, kbpersec: "1.3 M" } },
		]) {
			assert.equal(
				(await withResponses([response], () => service.serverStats())).ok,
				false,
			);
		}
	}),
	test("rejects missing queue instead of treating it as empty", async () => {
		assert.equal(
			(await withResponses([{}], () => service.queueList())).ok,
			false,
		);
	}),
	test("requires affirmative deletion acknowledgement", async () => {
		for (const response of [{}, { status: false }, { status: "true" }, null]) {
			const requests: Request[] = [];
			const result = await withResponses(
				[queue(), response],
				() => service.removeQueueItems([slot.nzo_id]),
				requests,
			);
			assert.equal(result.data?.removed, 0);
			assert.equal(result.data?.failed, 1);
			assert.equal(requests.length, 2);
			assert.equal(
				requests.filter(({ url }) => url.searchParams.get("name") === "delete")
					.length,
				1,
			);
		}
	}),
	test("reads queue back before claiming removal", async () => {
		const result = await withResponses(
			[queue(), { status: true }, queue()],
			() => service.removeQueueItems([slot.nzo_id]),
		);
		assert.equal(result.data?.removed, 0);
		assert.equal(result.data?.failed, 1);
	}),
	test("reports verified deletion", async () => {
		const result = await withResponses(
			[queue(), { status: true }, queue([])],
			() => service.removeQueueItems([slot.nzo_id]),
		);
		assert.equal(result.data?.removed, 1);
	}),
	test("malformed readback fails closed", async () => {
		const result = await withResponses([queue(), { status: true }, {}], () =>
			service.removeQueueItems([slot.nzo_id]),
		);
		assert.equal(result.data?.removed, 0);
	}),
	test("rejects malformed stats and history", async () => {
		assert.equal(
			(await withResponses([{}], () => service.serverStats())).ok,
			false,
		);
		assert.equal(
			(await withResponses([{}], () => service.historyList())).ok,
			false,
		);
	}),
	test("strips unmodeled history fields", async () => {
		const item = {
			nzo_id: "1",
			name: "Example",
			size: "100",
			status: "Completed",
			completed: 1,
			category: "tv",
			storage: "private",
		};
		const result = await withResponses([{ history: { slots: [item] } }], () =>
			service.historyList(),
		);
		assert.equal(result.ok, true);
		assert.equal(result.data?.[0] && "storage" in result.data[0], false);
	}),
	test("rejects invalid queue numerics", async () => {
		const result = await withResponses(
			[queue([{ ...slot, mb: "Infinity" }])],
			() => service.queueList(),
		);
		assert.equal(result.ok, false);
	}),
]);
if (process.argv[1]?.endsWith("sabnzbd-safety.test.ts"))
	testRunner.printSummary();
