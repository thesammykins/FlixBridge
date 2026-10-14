import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { requestSignal } from "../../src/request-context.js";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

await describe("Removal workflow cancellation", [
	test("cancelling queue verification interrupts its delay without replaying deletion", async () => {
		const controller = new AbortController();
		const original = globalThis.fetch;
		let deletions = 0;
		let reads = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		globalThis.fetch = async (_url, init) => {
			if (init?.method === "DELETE") {
				deletions++;
				return new Response(null, { status: 204 });
			}
			reads++;
			if (deletions && !timer) timer = setTimeout(() => controller.abort(), 15);
			return new Response(
				JSON.stringify({
					totalRecords: 1,
					records: [{ id: 1, title: "Fixture", status: "completed" }],
				}),
			);
		};
		try {
			const service = new SonarrService("sonarr-fixture", {
				baseUrl: "https://sonarr.example",
				apiKey: "fixture",
			});
			const preparation = await service.prepareRemoval("queue", [1]);
			const plan = preparation.data;
			assert.ok(plan);
			const started = performance.now();
			const result = await requestSignal.run(controller.signal, () =>
				service.executeRemoval(plan, {
					attemptManualImport: false,
				}),
			);
			assert.ok(
				performance.now() - started < 300,
				"cancelled verification must not wait through 1/2/4-second polling delays",
			);
			assert.equal(deletions, 1);
			assert.equal(
				reads,
				2,
				"no verification read should start after cancellation",
			);
			assert.equal(result.data?.removed, 0);
		} finally {
			if (timer) clearTimeout(timer);
			globalThis.fetch = original;
		}
	}),
]);

if (process.argv[1]?.endsWith("removal-cancellation.test.ts"))
	testRunner.printSummary();
