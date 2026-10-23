import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

test("retention CLI help is usable without credentials or state", () => {
	const result = spawnSync(
		process.execPath,
		[resolve("dist/cli.js"), "--help"],
		{ env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5000 },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /run-due/);
	assert.match(result.stdout, /bridge/);
});
test("retention CLI rejects unknown commands before contacting services", () => {
	const result = spawnSync(
		process.execPath,
		[resolve("dist/cli.js"), "erase-everything"],
		{ env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5000 },
	);
	assert.notEqual(result.status, 0);
	assert.doesNotMatch(result.stderr, /Cannot find module/);
	assert.match(result.stderr, /Unknown|Invalid/);
});
