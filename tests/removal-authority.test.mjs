import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJson } from "../dist/core.js";
import { withRemovalAuthority } from "../dist/removal-authority.js";

test("claimed authority is scoped to exact provider and target, never sibling IDs or redirect destinations", async () => {
	const original=globalThis.fetch;
	const paths=[];
	globalThis.fetch=async (url)=>{paths.push(String(url)); return new Response(null,{status:204});};
	try {
		const permit={approvalId:"claimed",planHash:"a".repeat(64),allowed:[{origin:"http://127.0.0.1:1",path:"/api/v3/series/1"}]};
		await withRemovalAuthority(permit,()=>fetchJson("http://127.0.0.1:1/api/v3/series/1",{method:"DELETE"}));
		for(const url of ["http://127.0.0.1:1/api/v3/series/2","http://127.0.0.1:2/api/v3/series/1"])
			await assert.rejects(withRemovalAuthority(permit,()=>fetchJson(url,{method:"DELETE"})),e=>/human approval/i.test(e.message));
		assert.equal(paths.length,1);
	} finally {globalThis.fetch=original;}
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
			fetchJson("http://127.0.0.1:1/api?mode=queue&name=delete&value=exact-id&del_files=0"),
			(error) => /human approval/i.test(error.message),
		);
		assert.equal(writes, 0);
	} finally {
		globalThis.fetch = original;
	}
});
