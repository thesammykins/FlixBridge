import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalStore } from "../dist/approval/store.js";

test("equivalent scheduler requests expose creation identity without re-notifying a pending decision", async () => {
	const dir = await realpath(
		await mkdtemp(
			join(
				process.env.HERMES_TEST_TMPDIR ?? process.env.TMPDIR ?? tmpdir(),
				"approval-notify-",
			),
		),
	);
	try {
		const store = new ApprovalStore(dir);
		const first = await store.create({ operation: "fixture", id: 1 });
		const second = await store.create({ operation: "fixture", id: 1 });
		assert.equal(first.id, second.id);
		assert.equal(first.newRequest, true);
		assert.equal(second.newRequest, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
