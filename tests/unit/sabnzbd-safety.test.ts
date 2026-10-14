import assert from "node:assert/strict";
import { SabnzbdService } from "../../src/services/downloaders/sabnzbd.js";
import { describe, test } from "../helpers/test-runner.js";

const service = new SabnzbdService({
	baseUrl: "http://sab.invalid",
	apiKey: "dummy",
});
async function withResponses<T>(
	responses: unknown[],
	fn: () => Promise<T>,
): Promise<T> {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(JSON.stringify(responses.shift()), {
			headers: { "Content-Type": "application/json" },
		});
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
const queue = (slots = [slot]) => ({
	queue: {
		slots,
		size: "100",
		sizeleft: "75",
		paused: false,
		noofslots: slots.length,
	},
});
await describe("SAB response safety", [
	test("rejects missing queue instead of treating it as empty", async () => {
		assert.equal(
			(await withResponses([{}], () => service.queueList())).ok,
			false,
		);
	}),
	test("requires affirmative deletion acknowledgement", async () => {
		for (const response of [{}, { status: false }, { status: "true" }, null]) {
			const result = await withResponses([queue(), response], () =>
				service.removeQueueItems([slot.nzo_id]),
			);
			assert.equal(result.data?.removed, 0);
			assert.equal(result.data?.failed, 1);
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
