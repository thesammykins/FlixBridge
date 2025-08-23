#!/usr/bin/env tsx

import { serviceRegistry } from "../src/services/registry.js";
import type { ServiceConfig } from "../src/services/base.js";
import { debug } from "../src/debug.js";
import { loadConfigFromEnvOnly } from "../src/config.js";

interface SmokeTestConfig {
	services: Record<string, ServiceConfig>;
	downloaders?: Record<string, any>;
}

async function loadConfig(): Promise<SmokeTestConfig> {
	return await loadConfigFromEnvOnly();
}

async function testService(
	serviceName: string,
	serviceConfig: ServiceConfig,
): Promise<{ service: string; tests: number; duration: number }> {
	console.log(`\n🧪 Testing ${serviceName}...`);
	const startTime = Date.now();
	let testCount = 0;

	try {
		// Register the service
		serviceRegistry.register(serviceName, serviceConfig);
		const service = serviceRegistry.get(serviceName);
		if (!service) {
			throw new Error(`Failed to register service: ${serviceName}`);
		}

		// Test system status
		console.log(`  📊 Testing system status...`);
		const statusResult = await service.systemStatus();
		testCount++;
		if (!statusResult.ok) {
			throw new Error(
				`System status failed: ${JSON.stringify(statusResult.error)}`,
			);
		}
		console.log(
			`  ✅ System status: ${statusResult.data?.name} v${statusResult.data?.version} (healthy: ${statusResult.data?.isHealthy})`,
		);

		// Test queue list
		console.log(`  📥 Testing queue list...`);
		const queueResult = await service.queueList({ pageSize: 10 });
		testCount++;
		if (!queueResult.ok) {
			throw new Error(
				`Queue list failed: ${JSON.stringify(queueResult.error)}`,
			);
		}
		console.log(
			`  ✅ Queue list: ${queueResult.data?.total} total items, ${queueResult.data?.items.length} returned`,
		);

		// Test root folder list
		console.log(`  📁 Testing root folder list...`);
		const rootFolderResult = await service.rootFolderList();
		testCount++;
		if (!rootFolderResult.ok) {
			throw new Error(
				`Root folder list failed: ${JSON.stringify(rootFolderResult.error)}`,
			);
		}
		console.log(
			`  ✅ Root folders: ${rootFolderResult.data?.total} folders found`,
		);

		// Test queue diagnostics (Phase 3 enhancement)
		console.log(`  🔍 Testing queue diagnostics...`);
		const diagnosticsResult = await service.queueDiagnostics();
		testCount++;
		if (!diagnosticsResult.ok) {
			console.log(
				`  ⚠️ Queue diagnostics failed: ${JSON.stringify(diagnosticsResult.error)}`,
			);
		} else {
			const data = diagnosticsResult.data;
			console.log(
				`  ✅ Queue diagnostics: ${data?.total || 0} items analyzed, ${data?.issues?.length || 0} issues found`,
			);
		}

		// Test quality profiles
		console.log(`  ⚙️ Testing quality profiles...`);
		const profilesResult = await service.listQualityProfiles();
		testCount++;
		if (!profilesResult.ok) {
			console.log(
				`  ⚠️ Quality profiles failed: ${JSON.stringify(profilesResult.error)}`,
			);
		} else {
			console.log(
				`  ✅ Quality profiles: ${profilesResult.data?.total || 0} profiles available`,
			);
		}

		const duration = Date.now() - startTime;
		console.log(
			`✅ ${serviceName} tests passed (${testCount} tests, ${duration}ms)`,
		);

		return { service: serviceName, tests: testCount, duration };
	} catch (error) {
		const duration = Date.now() - startTime;
		console.log(
			`❌ ${serviceName} tests failed: ${error instanceof Error ? error.message : "Unknown error"} (${testCount} tests, ${duration}ms)`,
		);
		throw error;
	}
}

async function main(): Promise<void> {
	console.log("🚀 Starting ARR MCP Server smoke tests...");

	// Enable debug mode for smoke tests
	process.env.FLIX_BRIDGE_DEBUG = "1";
	debug("Smoke test session started");

	try {
		const config = await loadConfig();
		const serviceNames = Object.keys(config.services);

		if (serviceNames.length === 0) {
			throw new Error("No services configured for testing");
		}

		console.log(
			`📋 Found ${serviceNames.length} services to test: ${serviceNames.join(", ")}`,
		);

		if (config.downloaders) {
			console.log(
				`📥 Found ${Object.keys(config.downloaders).length} downloaders configured: ${Object.keys(config.downloaders).join(", ")}`,
			);
		}

		// Clear any existing services
		serviceRegistry.clear();

		const results: Array<{
			service: string;
			success: boolean;
			error?: string;
			tests?: number;
			duration?: number;
		}> = [];

		for (const serviceName of serviceNames) {
			try {
				const testResult = await testService(
					serviceName,
					config.services[serviceName]!,
				);
				results.push({
					service: serviceName,
					success: true,
					tests: testResult.tests,
					duration: testResult.duration,
				});
			} catch (error) {
				results.push({
					service: serviceName,
					success: false,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}

		// Summary
		console.log("\n📊 Smoke Test Summary:");
		const passed = results.filter((r) => r.success).length;
		const failed = results.filter((r) => !r.success).length;
		const totalTests = results.reduce((sum, r) => sum + (r.tests || 0), 0);
		const totalDuration = results.reduce(
			(sum, r) => sum + (r.duration || 0),
			0,
		);

		console.log(`  ✅ Passed: ${passed} services`);
		console.log(`  ❌ Failed: ${failed} services`);
		console.log(`  🧪 Total tests: ${totalTests}`);
		console.log(`  ⏱️ Total duration: ${totalDuration}ms`);

		if (passed > 0) {
			console.log("\n✅ Passed services:");
			results
				.filter((r) => r.success)
				.forEach((r) => {
					console.log(`  - ${r.service}: ${r.tests} tests, ${r.duration}ms`);
				});
		}

		if (failed > 0) {
			console.log("\n❌ Failed services:");
			results
				.filter((r) => !r.success)
				.forEach((r) => {
					console.log(`  - ${r.service}: ${r.error}`);
				});
			process.exit(1);
		}

		console.log("\n🎉 All smoke tests passed!");
		debug("Smoke test session completed successfully");
	} catch (error) {
		console.error("💥 Smoke test setup failed:", error);
		debug("Smoke test session failed", {
			error: error instanceof Error ? error.message : "Unknown error",
		});
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("💥 Unhandled error in smoke tests:", error);
		process.exit(1);
	});
}
