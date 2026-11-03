import assert from "node:assert/strict";
import { ArrMcpServer } from "../../src/index.js";
import type { RemediateInput } from "../../src/services/plex/remediation.js";
import {
	type PlexReport,
	PlexReportsClient,
} from "../../src/services/plex/reports.js";
import { serviceRegistry } from "../../src/services/registry.js";
import { withFixtureRemovalAuthority } from "../helpers/removal-authority.js";
import { describe, test } from "../helpers/test-runner.js";

type DispatchServer = {
	executeTool(name: string, input: RemediateInput): Promise<unknown>;
	handleRemediateReportedIssue(input: RemediateInput): Promise<unknown>;
	toolResult(result: unknown): unknown;
};

// Exercise dispatch and its real client factory; only provider I/O is synthetic.
async function withDispatch(
	check: (fixture: {
		server: DispatchServer;
		call: (input?: RemediateInput) => Promise<unknown>;
		clients: Set<PlexReportsClient>;
		counts: { searches: number; comments: number };
		report: PlexReport;
	}) => Promise<void>,
) {
	const oldEnv = {
		baseUrl: process.env.PLEX_BASE_URL,
		token: process.env.PLEX_TOKEN,
	};
	const oldFetch = globalThis.fetch;
	const oldList = PlexReportsClient.prototype.listReports;
	const oldResolve = PlexReportsClient.prototype.resolveReportUrl;
	const oldComment = PlexReportsClient.prototype.createReportComment;
	const clients = new Set<PlexReportsClient>();
	const counts = { searches: 0, comments: 0 };
	const report: PlexReport = {
		id: "dispatch-report",
		url: "https://plex.invalid/library/metadata/1",
		message: "Playback failed",
		date: "2026-01-01T00:00:00Z",
		commentCount: 0,
		comments: [],
	};
	process.env.PLEX_BASE_URL = "https://plex.invalid";
	process.env.PLEX_TOKEN = "synthetic-account-a";
	PlexReportsClient.prototype.listReports = async function () {
		clients.add(this);
		return { ok: true, data: [report] };
	};
	PlexReportsClient.prototype.resolveReportUrl = async () => ({
		key: "1",
		type: "movie",
		title: "Fixture",
		year: 2020,
	});
	PlexReportsClient.prototype.createReportComment = async () => {
		counts.comments++;
		return {
			ok: false,
			error: { kind: "internal", message: "UNTRUSTED_PROVIDER_SECRET" },
		};
	};
	globalThis.fetch = async (_url, init) => {
		if (init?.method === "POST") {
			counts.searches++;
			return new Response(JSON.stringify({ id: 1, status: "queued" }));
		}
		return new Response(
			JSON.stringify([
				{
					id: 10,
					title: "Fixture",
					year: 2020,
					hasFile: true,
					movieFile: { id: 50 },
				},
			]),
		);
	};
	try {
		const instance = new ArrMcpServer();
		instance.initialize({
			services: {
				radarr: { baseUrl: "https://radarr.invalid", apiKey: "synthetic" },
			},
		});
		const server = instance as unknown as DispatchServer;
		const call = (input: RemediateInput = {}) =>
			server.executeTool("remediate_reported_issue", {
				reportId: report.id,
				action: "re_search",
				service: "radarr",
				...input,
			});
		await check({ server, call, clients, counts, report });
	} finally {
		globalThis.fetch = oldFetch;
		PlexReportsClient.prototype.listReports = oldList;
		PlexReportsClient.prototype.resolveReportUrl = oldResolve;
		PlexReportsClient.prototype.createReportComment = oldComment;
		for (const [key, value] of Object.entries({
			PLEX_BASE_URL: oldEnv.baseUrl,
			PLEX_TOKEN: oldEnv.token,
		})) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		serviceRegistry.clear();
	}
}

await describe("Plex dispatch replay lifecycle", [
	test("separate tool calls do not replay accepted work after comment failure", () =>
		withDispatch(async ({ call, clients, counts }) => {
			await call();
			await call();
			assert.equal(counts.searches, 1, "accepted search must not be replayed");
			assert.equal(counts.comments, 1);
			assert.equal(
				clients.size,
				1,
				"dispatch must retain its configured client",
			);
		})),
	test("toolResult preserves safe partial-mutation guidance and withholds provider details", () =>
		withDispatch(async ({ server, call }) => {
			const first = server.toolResult(await call());
			const firstText = JSON.stringify(first);
			assert.match(
				firstText,
				/Partial failure: accepted remediation but report comment failed/,
			);
			assert.match(firstText, /inspect existing work before replay/);
			assert.doesNotMatch(
				firstText,
				/UNTRUSTED_PROVIDER_SECRET|synthetic-account/,
			);
			const second = server.toolResult(await call());
			assert.match(
				JSON.stringify(second),
				/already submitted for this snapshot/,
			);
		})),
	test("distinct configured accounts can remediate the same report concurrently", () =>
		withDispatch(async ({ call, counts }) => {
			const providerFetch = globalThis.fetch;
			let started: () => void = () => {};
			let release: () => void = () => {};
			const ready = new Promise<void>((resolve) => {
				started = resolve;
			});
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			let firstPost = true;
			globalThis.fetch = async (url, init) => {
				if (init?.method === "POST" && firstPost) {
					firstPost = false;
					started();
					await held;
				}
				return providerFetch(url, init);
			};
			const first = call();
			await ready;
			try {
				process.env.PLEX_TOKEN = "synthetic-account-b";
				await call();
				assert.equal(
					counts.searches,
					1,
					"other account must not inherit an active lock",
				);
			} finally {
				release();
				await first;
			}
			assert.equal(counts.searches, 2);
		})),
	test("returning to a prior account or server retains its replay guard", () =>
		withDispatch(async ({ server, call, counts, clients }) => {
			await call();
			process.env.PLEX_TOKEN = "synthetic-account-b";
			await call();
			process.env.PLEX_TOKEN = "synthetic-account-a";
			await call();
			assert.equal(counts.searches, 2);
			process.env.PLEX_BASE_URL = "https://other-plex.invalid";
			await call();
			process.env.PLEX_BASE_URL = "https://plex.invalid";
			await call();
			assert.equal(counts.searches, 3);
			assert.equal(clients.size, 3);
			assert.doesNotMatch(JSON.stringify(server), /synthetic-account/);
		})),
	test("a new unresolved reply permits new work but pending and fixed reports do not", () =>
		withDispatch(async ({ call, counts, report }) => {
			await call();
			report.comments.push({
				id: "reply",
				message: "Still broken",
				date: "2026-01-02T00:00:00Z",
			});
			await call();
			await call();
			assert.equal(counts.searches, 2);
			report.comments.push({
				id: "pending",
				message: "Pending: search submitted",
				date: "2026-01-03T00:00:00Z",
			});
			await call();
			report.comments.push({
				id: "fixed",
				message: "Fixed",
				date: "2026-01-04T00:00:00Z",
			});
			await call();
			assert.equal(counts.searches, 2);
		})),
	test("a thrown comment failure preserves accepted-mutation guidance without leaking its message", () =>
		withDispatch(async ({ server, call, counts }) => {
			PlexReportsClient.prototype.createReportComment = async () => {
				throw new Error("UNTRUSTED_PROVIDER_SECRET");
			};
			const first = server.toolResult(await call());
			assert.match(
				JSON.stringify(first),
				/Partial failure: accepted remediation/,
			);
			assert.doesNotMatch(JSON.stringify(first), /UNTRUSTED_PROVIDER_SECRET/);
			await call();
			assert.equal(counts.searches, 1);
		})),
	test("post-approval accepted deletion followed by failed search retains safe partial guidance and cannot replay", () =>
		withDispatch(async ({ server, counts, report }) => {
			const providerFetch = globalThis.fetch;
			let deletes = 0;
			globalThis.fetch = async (url, init) => {
				if (init?.method === "DELETE") {
					deletes++;
					return new Response(null, { status: 204 });
				}
				if (init?.method === "POST") {
					counts.searches++;
					return new Response("UNTRUSTED_PROVIDER_SECRET", { status: 503 });
				}
				return providerFetch(url, init);
			};
			// This exercises the post-approval handler/client lifecycle, not the
			// MCP consent gate (covered by approved-dispatch integration tests).
			const call = (input: RemediateInput) =>
				withFixtureRemovalAuthority(
					["https://radarr.invalid/api/v3/moviefile/50"],
					() =>
						server.handleRemediateReportedIssue({
							reportId: report.id,
							service: "radarr",
							...input,
						}),
				);
			const action = "remove_and_regrab";
			const preview = (await call({ action, dryRun: true })) as {
				data: { confirmationToken: string };
			};
			assert.equal(deletes, 0);
			const input = {
				action,
				confirmationToken: preview.data.confirmationToken,
			} as const;
			const first = server.toolResult(await call(input));
			assert.equal(deletes, 1);
			assert.match(
				JSON.stringify(first),
				/Partial failure:.*triggerSearch failed/,
			);
			assert.match(
				JSON.stringify(first),
				/inspect existing work before replay/,
			);
			assert.doesNotMatch(JSON.stringify(first), /UNTRUSTED_PROVIDER_SECRET/);
			await call(input);
			assert.equal(deletes, 1);
			assert.equal(counts.searches, 1);
		})),
]);
