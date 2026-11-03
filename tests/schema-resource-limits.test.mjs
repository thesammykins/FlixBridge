import assert from "node:assert/strict";
import test from "node:test";
import { monitoringInput } from "../dist/approval-tools.js";

test("oversized monitoring scopes reject before accumulating element-validation issues", () => {
	const result = monitoringInput.safeParse({
		service: "sonarr-test",
		itemId: 1,
		monitored: false,
		episodeIds: Array.from({ length: 1001 }, () => ({})),
	});
	assert.equal(result.success, false);
	assert.deepEqual(
		result.error.issues.map(({ code, path }) => ({ code, path })),
		[{ code: "too_big", path: ["episodeIds"] }],
	);
});
