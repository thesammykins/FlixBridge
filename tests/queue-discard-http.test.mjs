import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJson } from "../dist/core.js";
import { withQueueDiscardAuthority } from "../dist/removal-authority.js";

const url =
	"http://fixture.invalid/base/api/v3/queue/7?removeFromClient=true&blocklist=false&skipRedownload=false&changeCategory=false";
const permit = {
	kind: "queue-discard-policy",
	executionId: "synthetic-execution",
	planHash: "a".repeat(64),
	allowed: [{ origin: "http://fixture.invalid", path: "/base/api/v3/queue/7" }],
	beforeRemoval: async () => {},
};

test("distinct async-local policy authority rejects wrong routes, methods, flags, duplicate parameters and bodies at shared HTTP boundary", async (t) => {
	const original = globalThis.fetch;
	const sent = [];
	globalThis.fetch = async (input, options) => {
		sent.push({ input, options });
		return new Response(null, { status: 204 });
	};
	t.after(() => {
		globalThis.fetch = original;
	});
	await withQueueDiscardAuthority(permit, async () => {
		for (const [target, options] of [
			[url.replace("fixture.invalid", "other.invalid"), { method: "DELETE" }],
			[url.replace("/queue/7", "/movie/7"), { method: "DELETE" }],
			[url.replace("/queue/7", "/queue/8"), { method: "DELETE" }],
			[url.replace("blocklist=false", "blocklist=true"), { method: "DELETE" }],
			[
				url.replace("removeFromClient=true", "removeFromClient=false"),
				{ method: "DELETE" },
			],
			[
				url.replace("skipRedownload=false", "skipRedownload=true"),
				{ method: "DELETE" },
			],
			[
				url.replace("changeCategory=false", "changeCategory=true"),
				{ method: "DELETE" },
			],
			[`${url}&extra=true`, { method: "DELETE" }],
			[`${url}&blocklist=false`, { method: "DELETE" }],
			[url, { method: "DELETE", body: "{}" }],
			[url, { method: "POST" }],
			[
				"http://fixture.invalid/api?mode=queue&name=delete&value=job",
				{ method: "GET" },
			],
		])
			await assert.rejects(fetchJson(target, options));
		assert.equal(sent.length, 0);
		await fetchJson(url, { method: "DELETE" });
	});
	assert.equal(sent.length, 1);
	await assert.rejects(fetchJson(url, { method: "DELETE" }));
	assert.equal(sent.length, 1);
});
test("policy mutation redirect is never replayed to its destination", async (t) => {
	const original = globalThis.fetch;
	const sent = [];
	globalThis.fetch = async (input, options) => {
		sent.push({ input, options });
		return new Response(null, {
			status: 307,
			headers: { location: "/base/api/v3/queue/7" },
		});
	};
	t.after(() => {
		globalThis.fetch = original;
	});
	await assert.rejects(
		withQueueDiscardAuthority(permit, () =>
			fetchJson(url, { method: "DELETE" }),
		),
	);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].options.redirect, "manual");
});
