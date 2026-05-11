#!/usr/bin/env tsx
/**
 * Main test runner - executes all test files
 * Run with: npm test or tsx tests/run-all.ts
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testRunner } from "./helpers/test-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
	console.log("🧪 Flix-Bridge Test Suite");
	console.log("=".repeat(60));

	try {
		// Run unit tests
		console.log("\n📦 Loading Unit Tests...");
		const unitTestsDir = join(__dirname, "unit");

		// Import all test files (they will auto-register via describe())
		await import("./unit/service-discovery.test.js");
		await import("./unit/queue-operations.test.js");
		await import("./unit/system-operations.test.js");
		await import("./unit/queue-diagnostics.test.js");
		await import("./unit/mcp-stdio.test.js");

		// Print summary
		testRunner.printSummary();
	} catch (error) {
		console.error("\n💥 Test execution failed:");
		console.error(error);
		process.exit(1);
	}
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("💥 Fatal error:", error);
		process.exit(1);
	});
}

export { main };
