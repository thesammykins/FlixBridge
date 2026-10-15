import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { ArrMcpServer } from "../../src/index.js";
import { serviceRegistry } from "../../src/services/registry.js";
import { describe, test } from "../helpers/test-runner.js";

const privateHost = "https://private-pms.invalid";
const privateToken = "synthetic-private-token";
const privateReport = "synthetic-private-report";
const privatePattern = /private-pms|synthetic-private|EHOSTUNREACH/;

type Scenario =
	| "transport"
	| "partial-transport"
	| "abort"
	| "body"
	| "401"
	| "403"
	| "503"
	| "feed-transport"
	| "comments-transport"
	| "feed-401"
	| "feed-403"
	| "comments-401"
	| "comments-403"
	| "empty"
	| "deleted"
	| "success";
type Envelope = {
	ok: boolean;
	error?: { kind?: string; message: string; status?: number };
	data?: { total: number; reports: { item: unknown }[] };
};
type ToolResult = {
	isError?: boolean;
	structuredContent: Envelope;
	content: { type: string; text: string }[];
};
type Dispatch = {
	executeTool(name: string, input: { limit?: number }): Promise<unknown>;
	toolResult(result: unknown): ToolResult;
};

// Only global fetch is synthetic: HTTP normalization, Plex client, factory,
// report resolution, dispatcher and tool-result serialization are all real.
function installProvider(scenario: Scenario) {
	const requests: string[] = [];
	const transportError = () =>
		new TypeError(`${privateHost} ${privateToken} ${privateReport}`, {
			cause: { code: "EHOSTUNREACH", address: privateHost },
		});
	process.env.PLEX_BASE_URL = privateHost;
	process.env.PLEX_TOKEN = privateToken;
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		requests.push(`${method} ${url}`);
		assert.equal(new Headers(init?.headers).get("X-Plex-Token"), privateToken);
		if (url === "https://community.plex.tv/api") {
			assert.equal(method, "POST");
			const { query } = JSON.parse(String(init?.body));
			assert.doesNotMatch(query, /mutation/);
			const feed = query.includes("query getReportedIssues");
			if (!feed) assert.match(query, /query reportComments/);
			const stage = feed ? "feed" : "comments";
			if (scenario === `${stage}-transport`) throw transportError();
			if (scenario === `${stage}-401` || scenario === `${stage}-403`)
				return new Response(privateReport, {
					status: Number(scenario.split("-")[1]),
				});
			if (!feed)
				return Response.json({ data: { reportComments: { nodes: [] } } });
			const keys =
				scenario === "empty"
					? []
					: scenario === "partial-transport"
						? [1, 2]
						: [1];
			const nodes = keys.map((key) => ({
				id: `${privateReport}-${key}`,
				message: `${privateReport} playback complaint`,
				user: {
					id: "synthetic-private-user",
					username: "synthetic-private-name",
				},
				url: `https://app.plex.invalid/library/metadata/${key}`,
				date: "2026-01-01T00:00:00Z",
			}));
			return Response.json({
				data: { reports: { nodes, pageInfo: { hasNextPage: false } } },
			});
		}
		assert.match(
			url,
			/^https:\/\/private-pms\.invalid\/library\/metadata\/[12]$/,
		);
		assert.equal(method, "GET");
		if (["401", "403", "503", "deleted"].includes(scenario))
			return new Response(privateReport, {
				status: scenario === "deleted" ? 404 : Number(scenario),
			});
		if (scenario === "abort")
			throw new DOMException(privateToken, "AbortError");
		if (scenario === "body")
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.error(transportError());
					},
				}),
			);
		if (
			scenario === "success" ||
			(scenario === "partial-transport" && url.endsWith("/1"))
		)
			return Response.json({
				MediaContainer: {
					Metadata: [{ type: "movie", title: "Synthetic title" }],
				},
			});
		throw transportError();
	};
	return requests;
}

async function dispatch(scenario: Scenario) {
	const oldFetch = globalThis.fetch;
	const env = {
		PLEX_BASE_URL: process.env.PLEX_BASE_URL,
		PLEX_TOKEN: process.env.PLEX_TOKEN,
	};
	const requests = installProvider(scenario);
	try {
		const instance = new ArrMcpServer();
		instance.initialize({ services: {} });
		const server = instance as unknown as Dispatch;
		const result = server.toolResult(
			await server.executeTool("reported_issues", { limit: 5 }),
		);
		return { result, requests };
	} finally {
		globalThis.fetch = oldFetch;
		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		serviceRegistry.clear();
	}
}

function assertMatching(result: ToolResult) {
	assert.deepEqual(
		JSON.parse(result.content[0]?.text ?? "null"),
		result.structuredContent,
	);
}

function assertFailure(result: ToolResult) {
	assert.equal(result.isError, true);
	assert.equal(result.structuredContent.ok, false);
	assert.equal(result.structuredContent.data, undefined);
	assert.ok(result.structuredContent.error);
	assertMatching(result);
	assert.doesNotMatch(JSON.stringify(result), privatePattern);
	assert.doesNotMatch(JSON.stringify(result), /"item"|"reports"|REPORTS CLEAN/);
}

async function wire(scenario: Scenario | "unconfigured") {
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			fileURLToPath(import.meta.url),
			"--stdio-provider",
			scenario,
			process.env.PLEX_READ_TEST_BUILT === "1" ? "built" : "source",
		],
		{
			env: {
				PATH: process.env.PATH,
				TMPDIR: process.env.TMPDIR,
				FLIX_BRIDGE_DEBUG: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	let stderr = "";
	let buffer = "";
	let timer: NodeJS.Timeout | undefined;
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
	});
	try {
		const frame = await new Promise<{
			jsonrpc: string;
			id: number;
			error?: unknown;
			result: ToolResult;
		}>((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("No stdio response")), 5000);
			child.once("error", reject);
			child.stdout.setEncoding("utf8").on("data", (chunk) => {
				buffer += chunk;
				if (!buffer.includes("\n")) return;
				try {
					resolve(JSON.parse(buffer.trim()));
				} catch (error) {
					reject(error);
				}
			});
			child.stdin.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: {
						name: "reported_issues",
						arguments: { limit: 5 },
						_meta: {
							"io.modelcontextprotocol/protocolVersion": "2026-07-28",
							"io.modelcontextprotocol/clientCapabilities": {},
						},
					},
				})}\n`,
			);
		});
		assert.equal(frame.jsonrpc, "2.0");
		assert.equal(frame.id, 1);
		assert.equal(
			frame.error,
			undefined,
			"provider failures must be tool results, not RPC errors",
		);
		const exit = once(child, "exit");
		child.stdin.end();
		assert.deepEqual(await exit, [0, null]);
		assert.doesNotMatch(stderr, privatePattern);
		assertMatching(frame.result);
		return frame.result;
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null) child.kill("SIGKILL");
	}
}

if (process.argv[2] === "--stdio-provider") {
	if (process.argv[3] !== "unconfigured")
		installProvider(process.argv[3] as Scenario);
	const Server =
		process.argv[4] === "built"
			? (await import("../../dist/index.js")).ArrMcpServer
			: ArrMcpServer;
	const server = new Server();
	server.initialize({ services: {} });
	await server.run();
} else {
	await describe("Plex read failure boundary", [
		test("metadata transport failure returns a private structured failure through real dispatch", async () => {
			const { result, requests } = await dispatch("transport");
			assertFailure(result);
			assert.equal(
				result.structuredContent.error?.message,
				"HTTP request failed",
			);
			assert.deepEqual(requests, [
				"POST https://community.plex.tv/api",
				"POST https://community.plex.tv/api",
				`GET ${privateHost}/library/metadata/1`,
			]);
		}),
		...(
			[
				"partial-transport",
				"abort",
				"body",
				"503",
				"feed-transport",
				"comments-transport",
			] as const
		).map((scenario) =>
			test(`${scenario} cannot masquerade as deleted media or a clean feed`, async () => {
				const { result, requests } = await dispatch(scenario);
				assertFailure(result);
				if (scenario === "partial-transport") assert.equal(requests.length, 5);
			}),
		),
		...(
			[
				"401",
				"403",
				"feed-401",
				"feed-403",
				"comments-401",
				"comments-403",
			] as const
		).map((scenario) =>
			test(`${scenario} remains explicit without upstream body or report leakage`, async () => {
				const { result } = await dispatch(scenario);
				assertFailure(result);
				const status = Number(scenario.slice(-3));
				assert.equal(result.structuredContent.error?.status, status);
				assert.equal(result.structuredContent.error?.message, `HTTP ${status}`);
			}),
		),
		test("legitimate empty feed is successful and performs no metadata reads", async () => {
			const { result, requests } = await dispatch("empty");
			assertMatching(result);
			assert.equal(result.isError, undefined);
			assert.deepEqual(result.structuredContent, {
				ok: true,
				data: { total: 0, reports: [] },
			});
			assert.deepEqual(requests, ["POST https://community.plex.tv/api"]);
		}),
		test("genuine metadata 404 retains the existing item:null result", async () => {
			const { result } = await dispatch("deleted");
			assertMatching(result);
			assert.equal(result.structuredContent.ok, true);
			assert.equal(result.structuredContent.data?.total, 1);
			assert.equal(result.structuredContent.data?.reports[0]?.item, null);
		}),
		test("successful metadata resolution retains a non-null item", async () => {
			const { result } = await dispatch("success");
			assertMatching(result);
			assert.equal(result.structuredContent.ok, true);
			assert.deepEqual(result.structuredContent.data?.reports[0]?.item, {
				key: "1",
				type: "movie",
				title: "Synthetic title",
			});
		}),
		...(["transport", "401", "403"] as const).map((scenario) =>
			test(`${scenario} crosses real stdio as a matching private failure envelope`, async () => {
				const result = await wire(scenario);
				assertFailure(result);
				if (scenario !== "transport")
					assert.equal(
						result.structuredContent.error?.status,
						Number(scenario),
					);
			}),
		),
		test("empty feed remains successful through real stdio", async () => {
			const result = await wire("empty");
			assert.equal(result.isError, undefined);
			assert.deepEqual(result.structuredContent, {
				ok: true,
				data: { total: 0, reports: [] },
			});
		}),
		test("missing Plex configuration retains its explicit argument guidance", async () => {
			const result = await wire("unconfigured");
			assertFailure(result);
			assert.match(
				result.structuredContent.error?.message ?? "",
				/Plex not configured: set PLEX_BASE_URL and PLEX_TOKEN/,
			);
		}),
	]);
}
