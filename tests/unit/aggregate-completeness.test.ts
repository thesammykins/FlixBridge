import assert from "node:assert/strict";
import { ArrMcpServer } from "../../src/index.js";
import { RadarrService } from "../../src/services/arr/radarr.js";
import { serviceRegistry } from "../../src/services/registry.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

type Status = {
	ok: boolean;
	data: {
		incomplete: boolean;
		errors: unknown[];
		serviceResults: Array<{ observed: number; truncated: boolean }>;
		totals: { queued: number; downloading: number };
	};
};
type Probe = {
	runDownloadStatus(input: {
		services: string[];
		includeDownloader: boolean;
	}): Promise<Status>;
};
await describe("Aggregate queue completeness", [
	test("partial service pages retain observed counts and cannot claim complete totals", async () => {
		const originalFetch = globalThis.fetch;
		const originalGet = serviceRegistry.get;
		const service = new RadarrService("radarr-fixture", {
			baseUrl: "https://radarr.example",
			apiKey: "fixture",
		});
		serviceRegistry.get = () => service;
		const server = new ArrMcpServer() as unknown as Probe;
		try {
			for (const totalRecords of [50, 1]) {
				globalThis.fetch = async () =>
					new Response(
						JSON.stringify({
							totalRecords,
							records: [{ id: 7, title: "Fixture", status: "downloading" }],
						}),
					);
				const result = await server.runDownloadStatus({
					services: ["radarr-fixture"],
					includeDownloader: false,
				});
				const partial = totalRecords > 1;
				assert.equal(result.data.incomplete, partial);
				assert.equal(result.ok, !partial);
				assert.equal(result.data.serviceResults[0]?.observed, 1);
				assert.equal(result.data.serviceResults[0]?.truncated, partial);
				assert.equal(result.data.totals.queued, totalRecords);
				assert.equal(result.data.totals.downloading, 1);
				assert.equal(result.data.errors.length, partial ? 1 : 0);
			}
		} finally {
			globalThis.fetch = originalFetch;
			serviceRegistry.get = originalGet;
		}
	}),
]);
if (process.argv[1]?.endsWith("aggregate-completeness.test.ts"))
	testRunner.printSummary();
