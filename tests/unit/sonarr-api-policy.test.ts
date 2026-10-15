import assert from "node:assert/strict";
import { loadConfigFromEnvOnly } from "../../src/config.js";
import { ServiceRegistry } from "../../src/services/registry.js";
import { describe, test, testRunner } from "../helpers/test-runner.js";

async function withServiceEnv(
	values: Record<string, string>,
	run: () => Promise<void>,
): Promise<void> {
	const pattern = /^(?:FLIX_BRIDGE_)?(?:SONARR|RADARR|SABNZBD)_/;
	const previous = Object.entries(process.env).filter(([key]) =>
		pattern.test(key),
	);
	for (const [key] of previous) delete process.env[key];
	Object.assign(process.env, values);
	try {
		await run();
	} finally {
		for (const key of Object.keys(process.env))
			if (pattern.test(key)) delete process.env[key];
		for (const [key, value] of previous) process.env[key] = value;
	}
}

await describe("Sonarr API policy configuration", [
	test("discovers an explicit API family per instance without changing its URL", async () => {
		await withServiceEnv(
			{
				SONARR_HD_URL: "http://sonarr.example/proxy",
				SONARR_HD_API_KEY: "fixture",
				SONARR_HD_API_VERSION: "5",
			},
			async () => {
				const config = await loadConfigFromEnvOnly();
				assert.equal(config.services["sonarr-hd"]?.apiVersion, 5);
				assert.equal(
					config.services["sonarr-hd"]?.baseUrl,
					"http://sonarr.example/proxy",
				);
			},
		);
	}),
	test("keeps omitted policy absent for legacy behavior", async () => {
		await withServiceEnv(
			{ SONARR_URL: "http://sonarr.example", SONARR_API_KEY: "fixture" },
			async () => {
				assert.equal(
					(await loadConfigFromEnvOnly()).services.sonarr?.apiVersion,
					undefined,
				);
			},
		);
	}),
	test("supports prefixed aliases and single-instance auto without cross-instance inheritance", async () => {
		await withServiceEnv(
			{
				FLIX_BRIDGE_SONARR_URL: "http://sonarr.example",
				FLIX_BRIDGE_SONARR_KEY: "fixture",
				FLIX_BRIDGE_SONARR_API_VERSION: "auto",
				SONARR_ANIME_URL: "http://anime.example",
				SONARR_ANIME_API_KEY: "fixture",
				FLIX_BRIDGE_SONARR_ANIME_API_VERSION: "3",
			},
			async () => {
				const { services } = await loadConfigFromEnvOnly();
				assert.equal(services.sonarr?.apiVersion, "auto");
				assert.equal(services["sonarr-anime"]?.apiVersion, 3);
			},
		);
	}),
	test("rejects invalid and empty policies instead of silently preserving a default", async () => {
		for (const value of ["", "v5", " 5", "5 ", "4", "AUTO", "false"]) {
			await withServiceEnv(
				{
					SONARR_URL: "http://sonarr.example",
					SONARR_API_KEY: "fixture",
					SONARR_API_VERSION: value,
				},
				async () => {
					await assert.rejects(
						loadConfigFromEnvOnly(),
						/API_VERSION must be auto, 3 or 5/,
					);
				},
			);
		}
	}),
	test("rejects conflicting single-instance aliases in either insertion order", async () => {
		for (const aliases of [
			{ SONARR_API_VERSION: "3", FLIX_BRIDGE_SONARR_API_VERSION: "5" },
			{ FLIX_BRIDGE_SONARR_API_VERSION: "5", SONARR_API_VERSION: "3" },
		]) {
			await withServiceEnv(
				{
					SONARR_URL: "http://sonarr.example",
					SONARR_API_KEY: "fixture",
					...aliases,
				},
				async () => {
					await assert.rejects(
						loadConfigFromEnvOnly(),
						/Conflicting Sonarr API_VERSION aliases/,
					);
				},
			);
		}
	}),
	test("rejects conflicting slug aliases but accepts identical policies", async () => {
		await withServiceEnv(
			{
				SONARR_HD_URL: "http://sonarr.example",
				SONARR_HD_API_KEY: "fixture",
				SONARR_HD_API_VERSION: "3",
				FLIX_BRIDGE_SONARR_HD_API_VERSION: "5",
			},
			async () => {
				await assert.rejects(
					loadConfigFromEnvOnly(),
					/Conflicting Sonarr API_VERSION aliases/,
				);
			},
		);
		await withServiceEnv(
			{
				SONARR_HD_URL: "http://sonarr.example",
				SONARR_HD_API_KEY: "fixture",
				SONARR_HD_API_VERSION: "5",
				FLIX_BRIDGE_SONARR_HD_API_VERSION: "5",
			},
			async () => {
				assert.equal(
					(await loadConfigFromEnvOnly()).services["sonarr-hd"]?.apiVersion,
					5,
				);
			},
		);
	}),
	test("rejects Sonarr policy variables on Radarr and SABnzbd", async () => {
		for (const key of [
			"RADARR_API_VERSION",
			"RADARR_HD_API_VERSION",
			"FLIX_BRIDGE_RADARR_HD_API_VERSION",
			"SABNZBD_API_VERSION",
			"FLIX_BRIDGE_SABNZBD_MAIN_API_VERSION",
		]) {
			await withServiceEnv(
				{
					SONARR_URL: "http://sonarr.example",
					SONARR_API_KEY: "fixture",
					[key]: "5",
				},
				async () => {
					await assert.rejects(
						loadConfigFromEnvOnly(),
						/API_VERSION is supported only for Sonarr/,
					);
				},
			);
		}
	}),
]);

await describe("Service configuration identity", [
	test("rejects duplicate custom instance names rather than overwriting their policies", async () => {
		await withServiceEnv(
			{
				SONARR_A_URL: "http://a.example",
				SONARR_A_API_KEY: "fixture",
				SONARR_A_NAME: "sonarr-library",
				SONARR_A_API_VERSION: "3",
				SONARR_B_URL: "http://b.example",
				SONARR_B_API_KEY: "fixture",
				SONARR_B_NAME: "sonarr-library",
				SONARR_B_API_VERSION: "5",
			},
			async () => {
				await assert.rejects(loadConfigFromEnvOnly(), /Duplicate service name/);
			},
		);
	}),
	test("rejects names that would route configured Sonarr credentials to the wrong service kind", async () => {
		for (const name of ["radarr-hd", "sonarr-radarr", "library"]) {
			await withServiceEnv(
				{
					SONARR_HD_URL: "http://sonarr.example",
					SONARR_HD_API_KEY: "fixture",
					SONARR_HD_NAME: name,
				},
				async () => {
					await assert.rejects(
						loadConfigFromEnvOnly(),
						/Invalid service name for configured type/,
					);
				},
			);
		}
	}),
]);

await describe("Sonarr API policy registration", [
	test("rejects a Sonarr policy on a programmatically registered Radarr", () => {
		const registry = new ServiceRegistry();
		assert.throws(
			() =>
				registry.register("radarr-hd", {
					baseUrl: "http://radarr.example",
					apiKey: "fixture",
					apiVersion: 5,
				}),
			/API policy is supported only for Sonarr/,
		);
	}),
	test("rejects invalid programmatic policy values", () => {
		const registry = new ServiceRegistry();
		const config = {
			baseUrl: "http://sonarr.example",
			apiKey: "fixture",
			apiVersion: 4,
		};
		// Deliberately cross the untyped programmatic boundary.
		assert.throws(
			() => registry.register("sonarr-hd", config as never),
			/Invalid Sonarr API policy/,
		);
	}),
	test("rejects names containing both service kinds before registering them", () => {
		const registry = new ServiceRegistry();
		assert.throws(
			() =>
				registry.register("sonarr-radarr", {
					baseUrl: "http://sonarr.example",
					apiKey: "fixture",
				}),
			/Ambiguous service type/,
		);
		assert.equal(registry.getAll().length, 0);
	}),
	test("does not overwrite an existing instance during registration", () => {
		const registry = new ServiceRegistry();
		registry.register("sonarr-hd", {
			baseUrl: "http://sonarr.example",
			apiKey: "fixture",
		});
		const first = registry.get("sonarr-hd");
		assert.throws(
			() =>
				registry.register("sonarr-hd", {
					baseUrl: "http://other.example",
					apiKey: "fixture",
					apiVersion: 5,
				}),
			/Duplicate service name/,
		);
		assert.equal(registry.get("sonarr-hd"), first);
	}),
]);

if (process.argv[1]?.endsWith("sonarr-api-policy.test.ts"))
	testRunner.printSummary();
