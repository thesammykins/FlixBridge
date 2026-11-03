import assert from "node:assert/strict";
import { RadarrService } from "../../src/services/arr/radarr.js";
import { withFixtureRemovalAuthority } from "../helpers/removal-authority.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

const json = (body: unknown) => new Response(JSON.stringify(body));

await describe("Radarr queue deletion query contract", [
	test("all explicit true/false removal flags reach the query, never a JSON body", async () => {
		for (const removeFromClient of [false, true]) {
			for (const blocklist of [false, true]) {
				const deletes: Array<{ url: URL; body: unknown }> = [];
				const original = globalThis.fetch;
				globalThis.fetch = async (input, init) => {
					if (init?.method === "DELETE") {
						deletes.push({ url: new URL(String(input)), body: init.body });
						return json({});
					}
					return json({
						totalRecords: deletes.length ? 0 : 1,
						records: deletes.length
							? []
							: [{ id: 1, title: "Fixture", status: "completed" }],
					});
				};
				try {
					const service = new RadarrService("radarr-fixture", {
						baseUrl: "https://arr.example/proxy",
						apiKey: "fixture-key",
					});
					const prepared = await service.prepareRemoval("queue", [1]);
					const plan = prepared.data;
					assert.ok(plan);
					const result = await withFixtureRemovalAuthority(
						["https://arr.example/proxy/api/v3/queue/1"],
						() =>
							service.executeRemoval(plan, {
								attemptManualImport: false,
								removeFromClient,
								blocklist,
							}),
					);
					assert.equal(result.data?.removed, 1);
					assert.equal(deletes.length, 1);
					const request = deletes[0];
					assert.ok(request);
					assert.equal(request.url.pathname, "/proxy/api/v3/queue/1");
					assert.equal(
						request.url.searchParams.get("removeFromClient"),
						String(removeFromClient),
					);
					assert.equal(
						request.url.searchParams.get("blocklist"),
						String(blocklist),
					);
					assert.equal(request.url.searchParams.get("skipRedownload"), "false");
					assert.equal(request.url.searchParams.get("changeCategory"), "false");
					assert.equal(request.body, undefined);
				} finally {
					globalThis.fetch = original;
				}
			}
		}
	}),
]);

if (process.argv[1]?.endsWith("radarr-queue-query.test.ts"))
	testRunner.printSummary();
