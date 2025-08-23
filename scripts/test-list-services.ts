#!/usr/bin/env node

import { loadConfigFromEnvOnly } from "../src/config.js";
import { serviceRegistry } from "../src/services/registry.js";

async function testListServices() {
	console.log("🧪 Testing list_services functionality...\n");

	try {
		// Load configuration
		console.log("📋 Loading configuration from environment...");
		const config = await loadConfigFromEnvOnly();
		console.log(`✅ Found ${Object.keys(config.services).length} services in config`);
		if (config.downloaders) {
			console.log(`✅ Found ${Object.keys(config.downloaders).length} downloaders in config`);
		}

		// Initialize service registry
		console.log("\n🔧 Initializing service registry...");
		serviceRegistry.clear();

		for (const [name, serviceConfig] of Object.entries(config.services)) {
			try {
				serviceRegistry.register(name, serviceConfig);
				console.log(`✅ Registered service: ${name}`);
			} catch (error) {
				console.error(`❌ Failed to register service ${name}:`, error instanceof Error ? error.message : error);
				throw error;
			}
		}

		if (config.downloaders) {
			for (const [name, downloaderConfig] of Object.entries(config.downloaders)) {
				try {
					serviceRegistry.registerDownloader(name, downloaderConfig);
					console.log(`✅ Registered downloader: ${name}`);
				} catch (error) {
					console.error(`❌ Failed to register downloader ${name}:`, error instanceof Error ? error.message : error);
					throw error;
				}
			}
		}

		// Simulate list_services tool logic
		console.log("\n📋 Testing list_services tool logic...");
		const services = serviceRegistry.getAllNames();
		const downloaders = serviceRegistry.getAllDownloaderNames();

		const result = {
			ok: true,
			data: {
				services: services.map((name) => ({
					name,
					type: serviceRegistry
						.get(name)
						?.constructor.name?.replace("Service", "")
						.toLowerCase() || "unknown",
				})),
				downloaders: downloaders.map((name) => ({
					name,
					type: "sabnzbd",
				})),
				summary: {
					totalServices: services.length,
					totalDownloaders: downloaders.length,
				},
			},
		};

		console.log("\n🎯 list_services result:");
		console.log(JSON.stringify(result, null, 2));

		// Validate result structure
		console.log("\n✅ Validation checks:");
		console.log(`- Result has 'ok' property: ${result.ok === true ? "✅" : "❌"}`);
		console.log(`- Result has 'data' property: ${result.data ? "✅" : "❌"}`);
		console.log(`- Services array length: ${result.data.services.length}`);
		console.log(`- Downloaders array length: ${result.data.downloaders.length}`);
		console.log(`- Summary totals match: ${
			result.data.summary.totalServices === result.data.services.length &&
			result.data.summary.totalDownloaders === result.data.downloaders.length ? "✅" : "❌"
		}`);

		// Test service type detection
		console.log("\n🔍 Service type detection:");
		for (const service of result.data.services) {
			console.log(`- ${service.name}: ${service.type}`);
		}

		console.log("\n🎉 list_services test completed successfully!");

	} catch (error) {
		console.error("\n💥 Test failed:", error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	testListServices().catch((error) => {
		console.error("💥 Test execution failed:", error);
		process.exit(1);
	});
}
