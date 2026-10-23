import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test, testRunner } from "../helpers/test-runner.js";

await describe("Release policy", [
	test("ordinary repository workflows cannot publish or mutate release state", async () => {
		const files = await readdir(
			new URL("../../.github/workflows/", import.meta.url),
		);
		for (const name of files.filter((file) => /\.ya?ml$/.test(file))) {
			const workflow = await readFile(
				new URL(`../../.github/workflows/${name}`, import.meta.url),
				"utf8",
			);
			assert.doesNotMatch(
				workflow,
				/npm\s+(?:stage\s+)?publish\b|npm\s+version\b|git\s+(?:push|tag)\b|actions\/create-release/,
				`${name} must not publish before a separately reviewed release gate exists`,
			);
			assert.doesNotMatch(
				workflow,
				/(?:id-token|contents|packages|actions|pull-requests):\s*write/,
				`${name} must not request release write permissions`,
			);
		}
	}),
]);

// The shared runner aggregates on full-suite runs; preserve exit status alone too.
if (process.argv[1]?.endsWith("release-policy.test.ts"))
	testRunner.printSummary();
