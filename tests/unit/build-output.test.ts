import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test, testRunner } from "../helpers/test-runner.js";

await describe("Release build hygiene", [
	test("building removes stale generated files before compiling the package", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const sentinel = new URL(
			"../../dist/stale-release-fixture.js",
			import.meta.url,
		);
		mkdirSync(new URL("../../dist", import.meta.url), { recursive: true });
		writeFileSync(sentinel, "// Synthetic stale output must not ship\n");
		try {
			const result = spawnSync("npm", ["run", "build"], {
				cwd: root,
				encoding: "utf8",
			});
			assert.equal(result.status, 0, result.stderr);
			assert.equal(
				existsSync(sentinel),
				false,
				"tsc alone leaves deleted/private stale modules in the npm allowlist",
			);
		} finally {
			rmSync(sentinel, { force: true });
		}
	}),
]);
if (process.argv[1]?.endsWith("build-output.test.ts"))
	testRunner.printSummary();
