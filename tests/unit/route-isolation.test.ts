import assert from "node:assert/strict";
import { fetchJson } from "../../src/core.js";
import { requestSignal } from "../../src/request-context.js";
import { SonarrService } from "../../src/services/arr/sonarr.js";
import { withFixtureRemovalAuthority } from "../helpers/removal-authority.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

const config = {
	baseUrl: "https://fixture.invalid/base",
	apiKey: "offline-key",
	apiVersion: 5 as const,
};
const discovery = { current: "v5", deprecated: ["v3"] };
const status = { appName: "Sonarr", version: "5.0.0-fixture" };
const json = (value: unknown) => new Response(JSON.stringify(value));

await describe("Route isolation", [
	test("central HTTP rejects every mutation redirect status and method before a second request", async () => {
		const original = globalThis.fetch;
		try {
			for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
				for (const status of [301, 302, 303, 307, 308]) {
					let calls = 0;
					let cancelled = false;
					globalThis.fetch = async () => {
						calls++;
						return new Response(
							new ReadableStream({
								cancel() {
									cancelled = true;
								},
							}),
							{
								status,
								headers: { location: "/base/api/v3/command" },
							},
						);
					};
					await assert.rejects(
						withFixtureRemovalAuthority(
							["https://fixture.invalid/base/api/v5/command"],
							() =>
								fetchJson("https://fixture.invalid/base/api/v5/command", {
									method,
								}),
						),
						(error: unknown) =>
							!!error &&
							typeof error === "object" &&
							"message" in error &&
							/mutation.*redirect/i.test(String(error.message)),
					);
					assert.equal(calls, 1, `${method} ${status} must not be replayed`);
					assert.equal(cancelled, true);
				}
			}
		} finally {
			globalThis.fetch = original;
		}
	}),
	test("same-base discovery and probes remain isolated by instance token and policy", async () => {
		const original = globalThis.fetch;
		const calls: string[] = [];
		try {
			globalThis.fetch = async (input, init) => {
				const path = new URL(String(input)).pathname;
				const token = new Headers(init?.headers).get("X-Api-Key");
				calls.push(`${token} ${path}`);
				if (path.endsWith("/api"))
					return json(
						token === "offline-key"
							? discovery
							: { current: "v3", deprecated: [] },
					);
				assert.equal(path.includes("/v5/"), token === "offline-key");
				return json(status);
			};
			const modern = new SonarrService("modern", {
				...config,
				apiVersion: "auto",
			});
			const pinned = new SonarrService("pinned", {
				...config,
				apiKey: "other-offline-key",
				apiVersion: 3,
			});
			const results = await Promise.all([
				requestSignal.run(new AbortController().signal, () =>
					modern.systemStatus(),
				),
				requestSignal.run(new AbortController().signal, () =>
					pinned.systemStatus(),
				),
			]);
			assert.ok(results.every((result) => result.ok));
			assert.equal(results[0]?.data?.api?.effectiveOperations.triggerSearch, 5);
			assert.equal(results[1]?.data?.api?.effectiveOperations.triggerSearch, 3);
			assert.equal(calls.filter((call) => call.endsWith("/api")).length, 2);
			assert.equal((await modern.systemStatus()).ok, true);
			assert.equal((await pinned.systemStatus()).ok, true);
			assert.equal(calls.filter((call) => call.endsWith("/api")).length, 2);
		} finally {
			globalThis.fetch = original;
		}
	}),
	test("strict v5 search rejects a mutation redirect without replaying under v3", async () => {
		const original = globalThis.fetch;
		const calls: string[] = [];
		try {
			globalThis.fetch = async (input, init) => {
				const path = new URL(String(input)).pathname;
				calls.push(`${init?.method ?? "GET"} ${path}`);
				if (path.endsWith("/api")) return json(discovery);
				if (path.endsWith("/system/status")) return json(status);
				if (path.endsWith("/v5/command"))
					return new Response(null, {
						status: 307,
						headers: { location: "/base/api/v3/command" },
					});
				return json({ id: 1 });
			};
			const result = await new SonarrService("strict", config).triggerSearch(
				10,
			);
			assert.equal(result.ok, false);
			assert.match(result.error?.message ?? "", /mutation.*redirect/i);
			assert.deepEqual(calls, [
				"GET /base/api",
				"GET /base/api/v5/system/status",
				"POST /base/api/v5/command",
			]);
		} finally {
			globalThis.fetch = original;
		}
	}),
	...(["/api", "/api/v5/system/status"] as const).map((heldPath) =>
		test(`cancelling the first ${heldPath} caller leaves its same-instance sibling healthy`, async () => {
			const original = globalThis.fetch;
			const firstController = new AbortController();
			const siblingController = new AbortController();
			let start!: () => void;
			const started = new Promise<void>((resolve) => {
				start = resolve;
			});
			let rejectHeld!: (reason: unknown) => void;
			const held = new Promise<Response>((_resolve, reject) => {
				rejectHeld = reject;
			});
			let ownerSignal: AbortSignal | null | undefined;
			let heldCalls = 0;
			try {
				globalThis.fetch = async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (path === `/base${heldPath}` && ++heldCalls === 1) {
						ownerSignal = init?.signal;
						init?.signal?.addEventListener(
							"abort",
							() => rejectHeld(init.signal?.reason),
							{ once: true },
						);
						start();
						return held;
					}
					return json(path.endsWith("/api") ? discovery : status);
				};
				const service = new SonarrService("strict", config);
				const first = requestSignal.run(firstController.signal, () =>
					service.systemStatus(),
				);
				await started;
				const sibling = requestSignal.run(siblingController.signal, () =>
					service.systemStatus(),
				);
				await new Promise<void>((resolve) => setImmediate(resolve));
				const cancelledAt = Date.now();
				firstController.abort();
				const cancelled = await first;
				assert.ok(
					Date.now() - cancelledAt < 250,
					"cancellation must not wait for the 5s HTTP timeout",
				);
				assert.equal(cancelled.ok, false);
				assert.match(cancelled.error?.message ?? "", /cancelled/);
				assert.equal(ownerSignal?.aborted, true);
				assert.equal(siblingController.signal.aborted, false);
				assert.equal((await sibling).ok, true);
				assert.equal((await service.systemStatus()).ok, true);
			} finally {
				firstController.abort();
				siblingController.abort();
				globalThis.fetch = original;
			}
		}),
	),
]);

if (import.meta.url === `file://${process.argv[1]}`) testRunner.printSummary();
