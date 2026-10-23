import assert from "node:assert/strict";
import { test } from "node:test";
test("accepted remediation is never durable verified completion", async () => {
	let classify;
	try {
		classify = (await import("../dist/execution-outcome.js")).classifyExecution;
	} catch {}
	assert.equal(typeof classify, "function");
	assert.deepEqual(
		classify("remediate_reported_issue", {
			ok: true,
			data: {
				actions: ["deleted file", "search accepted"],
				comment: "Pending: replacement",
			},
		}),
		{ state: "partial", verified: false },
	);
});
test("completion requires affirmative evidence rather than absence of error-looking text", async () => {
	const { classifyExecution } = await import("../dist/execution-outcome.js");
	assert.equal(
		classifyExecution("update_monitoring", {
			ok: true,
			data: { accepted: true },
		}).verified,
		false,
	);
	assert.equal(
		classifyExecution("update_monitoring", {
			ok: true,
			data: { verified: true },
		}).verified,
		true,
	);
	assert.equal(
		classifyExecution("remove_content", {
			ok: true,
			data: {
				result: {
					removed: 1,
					failed: 0,
					skipped: 0,
					details: [{ status: "removed" }],
				},
			},
		}).verified,
		true,
	);
	assert.equal(
		classifyExecution("remove_content", {
			ok: true,
			data: {
				result: { removed: 1, failed: 0, details: [{ status: "pending" }] },
			},
		}).verified,
		false,
	);
	assert.equal(
		classifyExecution("remove_content", {
			ok: false,
			data: { uncertain: true },
		}).state,
		"uncertain",
	);
});
