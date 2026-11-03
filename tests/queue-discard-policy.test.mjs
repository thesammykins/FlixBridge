import assert from "node:assert/strict";
import { test } from "node:test";

const valid = {
	version: 1,
	services: ["sonarr"],
	downloadRoots: ["/downloads"],
	maxItems: 50,
};

test("queue discard operator policy is strict, bounded and disabled by default", async () => {
	const { parseQueueDiscardPolicy } = await import("../dist/queue-discard.js");
	assert.equal(parseQueueDiscardPolicy(undefined), undefined);
	assert.deepEqual(parseQueueDiscardPolicy(JSON.stringify(valid)), valid);
	for (const value of [
		"broken",
		{},
		{ ...valid, version: 2 },
		{ ...valid, enabled: true },
		{ ...valid, maxItems: 0 },
		{ ...valid, maxItems: 1001 },
		{ ...valid, services: [] },
		{ ...valid, services: ["sonarr", "sonarr"] },
		{ ...valid, downloadRoots: ["/"] },
		{ ...valid, downloadRoots: ["downloads"] },
		{ ...valid, downloadRoots: ["/downloads/../library"] },
	]) {
		assert.equal(
			parseQueueDiscardPolicy(
				typeof value === "string" ? value : JSON.stringify(value),
			),
			undefined,
		);
	}
});
