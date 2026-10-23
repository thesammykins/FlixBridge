import assert from "node:assert/strict";
import { test } from "node:test";
import { instanceBindings } from "../dist/approval-plans.js";

test("approval instance bindings include selected media server, credential and actual server identity without exposing values", async () => {
	const env = { ...process.env };
	const original = globalThis.fetch;
	for (const key of Object.keys(process.env))
		if (/^(FLIX_BRIDGE_)?(SONARR|RADARR|SABNZBD|PLEX|JELLYFIN)_/.test(key))
			delete process.env[key];
	process.env.RADARR_URL = "http://127.0.0.1:1/arr";
	process.env.RADARR_API_KEY = "synthetic-arr-key-8439";
	process.env.JELLYFIN_URL = "http://127.0.0.1:2/jelly";
	process.env.JELLYFIN_API_KEY = "synthetic-jelly-key-6827";
	let identity = "server-one";
	globalThis.fetch = async () =>
		Response.json({ Id: identity, ServerName: "Synthetic", Version: "10.10" });
	try {
		const first = await instanceBindings(["jellyfin"]);
		process.env.JELLYFIN_API_KEY = "synthetic-jelly-key-changed-0287";
		const second = await instanceBindings(["jellyfin"]);
		assert.notDeepEqual(first, second);
		identity = "server-two";
		const third = await instanceBindings(["jellyfin"]);
		assert.notDeepEqual(second, third);
		assert.doesNotMatch(
			JSON.stringify(third),
			/synthetic-jelly|127\.0\.0\.1|server-two/,
		);
	} finally {
		process.env = env;
		globalThis.fetch = original;
	}
});
