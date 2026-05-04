/**
 * Regression test for stdio MCP protocol behavior.
 * Ensures initialize/tools/list work and stdout contains only JSON-RPC frames.
 */

import assert from "node:assert";
import { spawn } from "node:child_process";
import { describe, test } from "../helpers/test-runner.js";

type JsonRpcMessage = {
	jsonrpc: "2.0";
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: unknown;
};

const EXPECTED_TOOLS = [
	"list_services",
	"system_status",
	"queue_list",
	"queue_grab",
	"remove_content",
	"root_folders",
	"history_detail",
	"search",
	"add_new",
	"import_issues",
	"quality_profiles",
	"queue_diagnostics",
	"all_services_diagnostics",
	"download_status",
	"server_metrics",
];

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function runStdioProbe(): Promise<{
	initialize: JsonRpcMessage;
	toolsList: JsonRpcMessage;
	parsedStdoutLines: JsonRpcMessage[];
	invalidStdoutLines: string[];
	stderr: string;
}> {
	const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			SONARR_URL: "http://127.0.0.1:8989",
			SONARR_API_KEY: "dummy",
			FLIX_BRIDGE_DEBUG: "1",
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});

	let stdoutBuffer = "";
	const parsedStdoutLines: JsonRpcMessage[] = [];
	const invalidStdoutLines: string[] = [];

	const pending = new Map<number, { resolve: (msg: JsonRpcMessage) => void }>();

	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdoutBuffer += chunk;
		let newlineIdx = stdoutBuffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = stdoutBuffer.slice(0, newlineIdx).trim();
			stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
			if (line.length > 0) {
				try {
					const parsed = JSON.parse(line) as JsonRpcMessage;
					parsedStdoutLines.push(parsed);
					if (typeof parsed.id === "number") {
						const waiter = pending.get(parsed.id);
						if (waiter) {
							pending.delete(parsed.id);
							waiter.resolve(parsed);
						}
					}
				} catch {
					invalidStdoutLines.push(line);
				}
			}
			newlineIdx = stdoutBuffer.indexOf("\n");
		}
	});

	const waitForResponse = (id: number): Promise<JsonRpcMessage> =>
		new Promise((resolve) => {
			pending.set(id, { resolve });
		});

	const writeMessage = (message: JsonRpcMessage): void => {
		child.stdin.write(`${JSON.stringify(message)}\n`);
	};

	const withTimeout = async <T>(
		promise: Promise<T>,
		ms: number,
	): Promise<T> => {
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`Timed out after ${ms}ms`)),
						ms,
					);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	};

	try {
		const initId = 1;
		const toolsId = 2;

		const initResponsePromise = waitForResponse(initId);
		writeMessage({
			jsonrpc: "2.0",
			id: initId,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "stdio-test", version: "1.0.0" },
			},
		});
		const initialize = await withTimeout(initResponsePromise, 6000);

		writeMessage({
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});

		const toolsResponsePromise = waitForResponse(toolsId);
		writeMessage({
			jsonrpc: "2.0",
			id: toolsId,
			method: "tools/list",
			params: {},
		});
		const toolsList = await withTimeout(toolsResponsePromise, 6000);

		return {
			initialize,
			toolsList,
			parsedStdoutLines,
			invalidStdoutLines,
			stderr,
		};
	} finally {
		child.stdin.end();
		if (!child.killed) {
			child.kill("SIGTERM");
		}
	}
}

await describe("MCP stdio protocol", [
	test("should initialize with tools capability and serve tools/list cleanly", async () => {
		const probe = await runStdioProbe();

		assert.strictEqual(
			probe.invalidStdoutLines.length,
			0,
			`stdout contained non-JSON lines: ${probe.invalidStdoutLines.join(" | ")}`,
		);

		assert.ok(
			isJsonObject(probe.initialize.result),
			"initialize response missing result",
		);
		const initResult = probe.initialize.result;
		assert.ok(
			isJsonObject(initResult.capabilities),
			"initialize result missing capabilities",
		);
		assert.ok(
			isJsonObject(initResult.capabilities.tools),
			"initialize capabilities missing tools",
		);

		assert.ok(
			isJsonObject(probe.toolsList.result),
			"tools/list response missing result",
		);
		const toolsListResult = probe.toolsList.result;
		assert.ok(
			Array.isArray(toolsListResult.tools),
			"tools/list result missing tools array",
		);
		const toolNames = toolsListResult.tools
			.filter(
				(tool): tool is { name: string } =>
					isJsonObject(tool) && typeof tool.name === "string",
			)
			.map((tool) => tool.name)
			.sort();

		const expected = [...EXPECTED_TOOLS].sort();
		assert.deepStrictEqual(
			toolNames,
			expected,
			"tools/list did not return expected tools",
		);
	}),
]);
