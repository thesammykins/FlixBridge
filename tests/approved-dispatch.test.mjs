import assert from "node:assert/strict";
import { test } from "node:test";
import { ArrMcpServer, InputSchema } from "../dist/index.js";

test("removal accepts an explicit season scope without overloading library IDs", () => {
	assert.equal(InputSchema.safeParse({service:"sonarr",target:"season",ids:[1],seasonNumbers:[1],users:[{server:"plex",userId:"1"}]}).success, true);
});

test("a preview token is insufficient authority at real MCP dispatch", async () => {
	const server = new ArrMcpServer();
	await assert.rejects(
		server.executeTool("remove_content", {service:"sonarr",ids:[1],dryRun:false,confirmationToken:"preview-only"}),
		(error) => /human approval|approvalId/i.test(error.message),
	);
});
