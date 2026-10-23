import assert from "node:assert/strict";
import { test } from "node:test";
import { ArrMcpServer, InputSchema } from "../dist/index.js";

test("removal accepts an explicit season scope without overloading library IDs", () => {
	assert.equal(
		InputSchema.safeParse({
			service: "sonarr",
			target: "season",
			ids: [1],
			seasonNumbers: [1],
			users: [{ server: "plex", userId: "1" }],
		}).success,
		true,
	);
});

test("season and file cleanup reject unsupported legacy side effects before provider reads", async () => {
	const previous = globalThis.fetch;
	globalThis.fetch = async () =>
		assert.fail(
			"No provider reads are permitted for invalid side-effect options",
		);
	try {
		const server = new ArrMcpServer();
		for (const flag of [
			"blocklist",
			"removeFromClient",
			"removeFromDownloader",
			"addImportExclusion",
			"manualImport",
		]) {
			await assert.rejects(
				server.callTool("remove_content", {
					service: "fixture",
					target: "season",
					ids: [1],
					seasonNumbers: [1],
					deleteFiles: true,
					[flag]: true,
				}),
				(error) => /not supported for season\/file cleanup/.test(error.message),
			);
		}
	} finally {
		globalThis.fetch = previous;
	}
});

test("a preview token is insufficient authority at real MCP dispatch", async () => {
	const server = new ArrMcpServer();
	await assert.rejects(
		server.executeTool("remove_content", {
			service: "sonarr",
			ids: [1],
			dryRun: false,
			confirmationToken: "preview-only",
		}),
		(error) => /human approval|approvalId/i.test(error.message),
	);
});
