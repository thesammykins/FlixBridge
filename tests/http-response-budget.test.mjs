import assert from "node:assert/strict";
import { test } from "node:test";

const { fetchJson } = await import(
	process.env.FLIXBRIDGE_HTTP_TEST_ENTRY ??
		new URL("../dist/core.js", import.meta.url).href
);

test("response budget counts actual stream bytes and cancels overflow without forwarding its option", async (t) => {
	const original = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = original;
	});
	let cancelled = false;
	let supplied;
	globalThis.fetch = async (_url, options) => {
		supplied = options;
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"value":123456789}'));
				},
				cancel() {
					cancelled = true;
				},
			}),
			{ headers: { "Content-Length": "1" } },
		);
	};
	await assert.rejects(
		fetchJson("http://fixture.invalid/large", { maxResponseBytes: 8 }),
		(error) => error.message === "HTTP response exceeds size limit",
	);
	assert.equal(cancelled, true);
	assert.equal(supplied.maxResponseBytes, undefined);
});

test("invalid or unbounded response budgets reject before any request", async (t) => {
	const original = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = original;
	});
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		return Response.json({});
	};
	for (const maxResponseBytes of [
		0,
		-1,
		1.5,
		Infinity,
		NaN,
		64 * 1024 * 1024 + 1,
	]) {
		await assert.rejects(
			fetchJson("http://fixture.invalid/invalid", { maxResponseBytes }),
			(error) => error.message === "Invalid HTTP response byte budget",
		);
	}
	assert.equal(requests, 0);
});

test("maximum inventory budget still rejects larger decompressed streams", async (t) => {
	const original = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = original;
	});
	let cancelled = false;
	globalThis.fetch = async () =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(64 * 1024 * 1024 + 1));
				},
				cancel() {
					cancelled = true;
				},
			}),
			{ headers: { "Content-Length": "1" } },
		);
	await assert.rejects(
		fetchJson("http://fixture.invalid/oversized", {
			maxResponseBytes: 64 * 1024 * 1024,
		}),
		(error) => error.message === "HTTP response exceeds size limit",
	);
	assert.equal(cancelled, true);
});
