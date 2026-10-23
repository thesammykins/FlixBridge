import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJson } from "../dist/core.js";
import { withRemovalAuthority } from "../dist/removal-authority.js";

test("claimed authority is scoped to exact provider and target, never sibling IDs or redirect destinations", async () => {
	const original = globalThis.fetch;
	const paths = [];
	globalThis.fetch = async (url) => {
		paths.push(String(url));
		return new Response(null, { status: 204 });
	};
	try {
		const permit = {
			approvalId: "claimed",
			planHash: "a".repeat(64),
			allowed: [{ origin: "http://127.0.0.1:1", path: "/api/v3/series/1" }],
		};
		await withRemovalAuthority(permit, () =>
			fetchJson("http://127.0.0.1:1/api/v3/series/1", { method: "DELETE" }),
		);
		for (const url of [
			"http://127.0.0.1:1/api/v3/series/2",
			"http://127.0.0.1:2/api/v3/series/1",
		])
			await assert.rejects(
				withRemovalAuthority(permit, () =>
					fetchJson(url, { method: "DELETE" }),
				),
				(e) => /human approval/i.test(e.message),
			);
		assert.equal(paths.length, 1);
	} finally {
		globalThis.fetch = original;
	}
});

test("the shared HTTP gate revalidates every destructive target, not just the first in a batch", async () => {
	const original = globalThis.fetch;
	let checks = 0;
	const writes = [];
	globalThis.fetch = async (url) => {
		writes.push(new URL(url).pathname);
		return new Response(null, { status: 204 });
	};
	try {
		const permit = {
			approvalId: "claimed",
			planHash: "a".repeat(64),
			allowed: [1, 2].map((id) => ({
				origin: "http://127.0.0.1:1",
				path: `/api/v3/series/${id}`,
			})),
			beforeRemoval: async () => {
				checks++;
				if (checks === 2) throw new Error("Synthetic drift");
			},
		};
		await assert.rejects(
			withRemovalAuthority(permit, async () => {
				await fetchJson("http://127.0.0.1:1/api/v3/series/1", {
					method: "DELETE",
				});
				await fetchJson("http://127.0.0.1:1/api/v3/series/2", {
					method: "DELETE",
				});
			}),
		);
		assert.equal(checks, 2);
		assert.deepEqual(writes, ["/api/v3/series/1"]);
	} finally {
		globalThis.fetch = original;
	}
});

test("a timed-out removal preflight aborts its evidence reads and never sends the DELETE", async () => {
	const original = globalThis.fetch;
	let reads = 0;
	let writes = 0;
	let aborted = 0;
	globalThis.fetch = async (url, options) => {
		if (options.method === "DELETE") {
			writes++;
			return new Response(null, { status: 204 });
		}
		reads++;
		return new Promise((resolve, reject) =>
			options.signal.addEventListener(
				"abort",
				() => {
					aborted++;
					reject(new DOMException("Aborted", "AbortError"));
				},
				{ once: true },
			),
		);
	};
	try {
		const permit = {
			approvalId: "claimed",
			planHash: "a".repeat(64),
			allowed: [{ origin: "http://127.0.0.1:1", path: "/api/v3/series/1" }],
			beforeRemoval: async () => {
				await fetchJson("http://127.0.0.1:1/snapshot", { timeoutMs: 1000 });
			},
		};
		await assert.rejects(
			withRemovalAuthority(permit, () =>
				fetchJson("http://127.0.0.1:1/api/v3/series/1", {
					method: "DELETE",
					timeoutMs: 25,
				}),
			),
			(error) => /timeout|cancel/i.test(error.message),
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(reads, 1);
		assert.equal(aborted, 1);
		assert.equal(writes, 0);
	} finally {
		globalThis.fetch = original;
	}
});

test("SAB destructive GET redirects are never replayed, even to the approved same endpoint", async () => {
	const original = globalThis.fetch;
	let calls = 0;
	const url =
		"http://127.0.0.1:1/api?mode=queue&name=delete&value=exact-id&del_files=0";
	globalThis.fetch = async () => {
		calls++;
		return calls === 1
			? new Response(null, { status: 302, headers: { Location: url } })
			: new Response(null, { status: 204 });
	};
	try {
		await assert.rejects(
			withRemovalAuthority(
				{
					approvalId: "claimed",
					planHash: "a".repeat(64),
					allowed: [
						{ origin: "http://127.0.0.1:1", path: "/api", ids: ["exact-id"] },
					],
				},
				() => fetchJson(url),
			),
			(e) => /redirect/i.test(e.message),
		);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = original;
	}
});

test("raw HTTP deletion is blocked before reaching a provider without human authority", async () => {
	const original = globalThis.fetch;
	let writes = 0;
	globalThis.fetch = async () => {
		writes++;
		return new Response(null, { status: 204 });
	};
	try {
		await assert.rejects(
			fetchJson("http://127.0.0.1:1/api/v3/series/1", { method: "DELETE" }),
			(error) => /human approval/i.test(error.message),
		);
		assert.equal(writes, 0);
	} finally {
		globalThis.fetch = original;
	}
});

test("SABnzbd deletion through a GET query needs the same human authority", async () => {
	const original = globalThis.fetch;
	let writes = 0;
	globalThis.fetch = async () => {
		writes++;
		return Response.json({ status: true });
	};
	try {
		await assert.rejects(
			fetchJson(
				"http://127.0.0.1:1/api?mode=queue&name=delete&value=exact-id&del_files=0",
			),
			(error) => /human approval/i.test(error.message),
		);
		assert.equal(writes, 0);
	} finally {
		globalThis.fetch = original;
	}
});
