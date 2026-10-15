import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createServiceError,
	fetchJson,
	handleError,
	serializeError,
} from "../dist/core.js";

test("safe normalized errors keep their actionable message across the MCP boundary", () => {
	const first = handleError(
		createServiceError("sonarr", 0, "Request timeout after 15ms"),
		"sonarr",
	).error;
	assert.deepEqual(serializeError(first), first);
	assert.ok(
		!JSON.stringify(
			serializeError({
				status: 500,
				message: "private-marker",
				raw: "private-marker",
			}),
		).includes("private-marker"),
	);
});

test("caller cancellation is composed with timeout and never starts already-cancelled writes", async () => {
	const original = globalThis.fetch;
	let calls = 0;
	try {
		const controller = new AbortController();
		controller.abort(new Error("private-marker"));
		globalThis.fetch = async () => {
			calls++;
			return new Response("{}");
		};
		await assert.rejects(
			fetchJson("http://local.invalid", {
				signal: controller.signal,
				method: "DELETE",
			}),
			(error) => error.message === "Request cancelled",
		);
		assert.equal(calls, 0);
		await assert.rejects(
			fetchJson("not-a-url", { signal: controller.signal }),
			(error) => error.message === "Request cancelled",
		);
		const active = new AbortController();
		let bodyCancelled = false;
		globalThis.fetch = async () =>
			new Response(
				new ReadableStream({
					start(c) {
						c.enqueue(new TextEncoder().encode("{"));
					},
					cancel() {
						bodyCancelled = true;
					},
				}),
			);
		const result = fetchJson("http://local.invalid", { signal: active.signal });
		active.abort(new Error("private-marker"));
		await assert.rejects(
			result,
			(error) => error.message === "Request cancelled",
		);
		assert.equal(bodyCancelled, true);
		assert.deepEqual(
			await fetchJson("http://local.invalid", {
				signal: new AbortController().signal,
				timeoutMs: 10,
			}).catch(serializeError),
			{
				service: "unknown",
				status: 0,
				message: "Request timeout after 10ms",
				code: undefined,
			},
		);
	} finally {
		globalThis.fetch = original;
	}
});
