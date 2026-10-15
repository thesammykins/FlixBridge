import assert from "node:assert/strict";
import { loadConfigFromEnvOnly } from "../../src/config.js";
import { fetchJson, handleError } from "../../src/core.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

const secret = "dummy-offline-secret";
await describe("HTTP security", [
	test("serialized errors discard untrusted nested diagnostics", () => {
		const result = handleError(
			{
				service: "sonarr",
				status: 500,
				message: `upstream ${secret}`,
				raw: { token: secret },
				cause: new Error(secret),
			},
			"sonarr",
		);
		assert.ok(!JSON.stringify(result).includes(secret));
		assert.equal(result.error.message, "HTTP 500");
	}),
	test("HTTP failures never retain response or transport secrets", async () => {
		const original = globalThis.fetch;
		try {
			for (const response of [
				new Response(`{"message":"${secret}","code":"${secret}"}`, {
					status: 500,
				}),
				new Response(secret),
			]) {
				globalThis.fetch = async () => response;
				await assert.rejects(
					fetchJson(`http://local.invalid/?apikey=${secret}`),
					(error: unknown) => !JSON.stringify(error).includes(secret),
				);
			}
			globalThis.fetch = async () => {
				throw new Error(secret);
			};
			await assert.rejects(
				fetchJson("http://local.invalid"),
				(error: unknown) => !JSON.stringify(error).includes(secret),
			);
		} finally {
			globalThis.fetch = original;
		}
	}),
	test("debug logging omits credentials and raw failures", async () => {
		const oldEnv = process.env.FLIX_BRIDGE_DEBUG;
		const original = console.error;
		const logs: string[] = [];
		process.env.FLIX_BRIDGE_DEBUG = "1";
		console.error = (...args: unknown[]) => {
			logs.push(args.join(" "));
		};
		try {
			const logging = await import("../../src/debug.js?security-test");
			logging.debugHttp(
				"GET",
				`http://user:${secret}@local.invalid/path/${secret}?apikey=${secret}#${secret}`,
				200,
				1,
			);
			logging.debugOperation("sonarr", "test", {
				apiKey: secret,
				nested: { token: secret },
				error: secret,
			});
			await assert.rejects(
				logging.debugToolTiming("test", "sonarr", async () => {
					throw new Error(secret);
				}),
			);
			assert.ok(logs.length > 0);
			assert.ok(!logs.join(" ").includes(secret));
		} finally {
			console.error = original;
			if (oldEnv === undefined)
				Reflect.deleteProperty(process.env, "FLIX_BRIDGE_DEBUG");
			else process.env.FLIX_BRIDGE_DEBUG = oldEnv;
		}
	}),
	test("redirects follow same origin only with a bounded hop count", async () => {
		const original = globalThis.fetch;
		try {
			let calls = 0;
			globalThis.fetch = async (_url, options) => {
				calls++;
				assert.equal(options?.redirect, "manual");
				assert.equal(new Headers(options?.headers).get("X-Api-Key"), secret);
				return calls === 1
					? new Response(null, {
							status: 302,
							headers: { Location: "/sonarr/api" },
						})
					: new Response('{"ok":true}');
			};
			assert.deepEqual(
				await fetchJson("http://local.invalid/start", {
					headers: { "X-Api-Key": secret },
				}),
				{ ok: true },
			);
			assert.equal(calls, 2);
			for (const location of [
				"http://attacker.invalid/",
				"https://local.invalid/",
				`http://user:${secret}@local.invalid/`,
			]) {
				calls = 0;
				globalThis.fetch = async () => {
					calls++;
					return new Response(null, {
						status: 302,
						headers: { Location: location },
					});
				};
				await assert.rejects(fetchJson("http://local.invalid/start"));
				assert.equal(calls, 1);
			}
			calls = 0;
			globalThis.fetch = async () => {
				calls++;
				return new Response(null, {
					status: 307,
					headers: { Location: "/loop" },
				});
			};
			await assert.rejects(fetchJson("http://local.invalid/start"));
			assert.ok(calls <= 6);
		} finally {
			globalThis.fetch = original;
		}
	}),
	test("timeout includes stalled success and error bodies", async () => {
		const original = globalThis.fetch;
		try {
			for (const status of [200, 500]) {
				let cancelled = false;
				globalThis.fetch = async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode("{"));
							},
							cancel() {
								cancelled = true;
							},
						}),
						{ status },
					);
				const start = Date.now();
				const outcome = await Promise.race([
					fetchJson("http://local.invalid", { timeoutMs: 15 }).then(
						() => "success",
						(error: unknown) => error,
					),
					new Promise((resolve) => setTimeout(() => resolve("hung"), 120)),
				]);
				assert.notEqual(outcome, "hung");
				assert.match(JSON.stringify(outcome), /timeout/);
				assert.ok(Date.now() - start < 110);
				assert.ok(cancelled);
			}
		} finally {
			globalThis.fetch = original;
		}
	}),
	test("streamed size ceiling applies to success and errors without trusting length", async () => {
		const original = globalThis.fetch;
		try {
			for (const status of [200, 500]) {
				let cancelled = false;
				let chunks = 0;
				globalThis.fetch = async () =>
					new Response(
						new ReadableStream({
							pull(controller) {
								if (chunks++ < 10)
									controller.enqueue(new Uint8Array(1024 * 1024));
								else controller.close();
							},
							cancel() {
								cancelled = true;
							},
						}),
						{ status, headers: { "Content-Length": "1" } },
					);
				await assert.rejects(
					fetchJson("http://local.invalid"),
					(error: unknown) => /size limit/.test(JSON.stringify(error)),
				);
				assert.ok(cancelled);
			}
		} finally {
			globalThis.fetch = original;
		}
	}),
	test("config permits private base paths but rejects credential-bearing or non-HTTP URLs", async () => {
		const saved = { ...process.env };
		try {
			for (const key of Object.keys(process.env))
				if (/^(?:FLIX_BRIDGE_)?(?:SONARR|RADARR|SABNZBD)_/.test(key))
					delete process.env[key];
			process.env.SONARR_API_KEY = secret;
			for (const url of [
				"ftp://local.invalid",
				"file:///etc/passwd",
				"not-a-url",
				`http://user:${secret}@local.invalid`,
				`http://local.invalid/?apikey=${secret}`,
				`http://local.invalid/#${secret}`,
				"http://local.invalid/?",
				"http://local.invalid/#",
			]) {
				process.env.SONARR_URL = url;
				await assert.rejects(
					loadConfigFromEnvOnly(),
					(error: unknown) => !JSON.stringify(error).includes(secret),
				);
			}
			process.env.SONARR_URL = "http://192.168.1.20:8989/sonarr/";
			assert.equal(
				(await loadConfigFromEnvOnly()).services.sonarr?.baseUrl,
				"http://192.168.1.20:8989/sonarr",
			);
		} finally {
			for (const key of Object.keys(process.env))
				if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
		}
	}),
]);
if (import.meta.url === `file://${process.argv[1]}`) testRunner.printSummary();
