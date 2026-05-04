/**
 * Simple test runner that executes test files and reports results
 * No external dependencies - uses plain Node.js
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface TestResult {
	name: string;
	status: "pass" | "fail" | "skip";
	duration: number;
	error?: Error;
}

export interface TestSuiteResult {
	suite: string;
	tests: TestResult[];
	totalTests: number;
	passed: number;
	failed: number;
	skipped: number;
	duration: number;
}

export class TestRunner {
	private results: TestSuiteResult[] = [];

	/**
	 * Run a test function and capture results
	 */
	async runTest(
		name: string,
		testFn: () => Promise<void> | void,
	): Promise<TestResult> {
		const startTime = Date.now();

		try {
			await testFn();
			return {
				name,
				status: "pass",
				duration: Date.now() - startTime,
			};
		} catch (error) {
			return {
				name,
				status: "fail",
				duration: Date.now() - startTime,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	/**
	 * Run a test suite containing multiple tests
	 */
	async runSuite(
		suiteName: string,
		tests: Array<{ name: string; fn: () => Promise<void> | void }>,
	): Promise<TestSuiteResult> {
		const startTime = Date.now();
		const testResults: TestResult[] = [];

		console.log(`\n📦 Running suite: ${suiteName}`);

		for (const test of tests) {
			const result = await this.runTest(test.name, test.fn);
			testResults.push(result);

			if (result.status === "pass") {
				console.log(`  ✅ ${result.name} (${result.duration}ms)`);
			} else if (result.status === "fail") {
				console.log(`  ❌ ${result.name} (${result.duration}ms)`);
				if (result.error) {
					console.log(`     Error: ${result.error.message}`);
					if (result.error.stack) {
						console.log(
							`     ${result.error.stack.split("\n").slice(1, 3).join("\n     ")}`,
						);
					}
				}
			} else {
				console.log(`  ⏭️  ${result.name} (skipped)`);
			}
		}

		const suiteResult: TestSuiteResult = {
			suite: suiteName,
			tests: testResults,
			totalTests: testResults.length,
			passed: testResults.filter((t) => t.status === "pass").length,
			failed: testResults.filter((t) => t.status === "fail").length,
			skipped: testResults.filter((t) => t.status === "skip").length,
			duration: Date.now() - startTime,
		};

		this.results.push(suiteResult);

		return suiteResult;
	}

	/**
	 * Discover and run all test files in a directory
	 */
	async runDirectory(dirPath: string): Promise<void> {
		const files = await readdir(dirPath, { withFileTypes: true });

		for (const file of files) {
			if (file.isFile() && file.name.endsWith(".test.ts")) {
				const testPath = join(dirPath, file.name);
				console.log(`\n🔍 Loading: ${testPath}`);

				try {
					await import(testPath);
				} catch (error) {
					console.error(`❌ Failed to load test file: ${testPath}`);
					console.error(error);
				}
			}
		}
	}

	/**
	 * Print summary of all test results
	 */
	printSummary(): void {
		console.log(`\n${"=".repeat(60)}`);
		console.log("📊 Test Summary");
		console.log("=".repeat(60));

		const totalSuites = this.results.length;
		const totalTests = this.results.reduce((sum, r) => sum + r.totalTests, 0);
		const totalPassed = this.results.reduce((sum, r) => sum + r.passed, 0);
		const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
		const totalSkipped = this.results.reduce((sum, r) => sum + r.skipped, 0);
		const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log(`\nSuites:  ${totalSuites}`);
		console.log(`Tests:   ${totalTests}`);
		console.log(`✅ Passed: ${totalPassed}`);
		console.log(`❌ Failed: ${totalFailed}`);
		console.log(`⏭️  Skipped: ${totalSkipped}`);
		console.log(`⏱️  Duration: ${totalDuration}ms`);

		if (totalFailed > 0) {
			console.log("\n❌ Failed tests:");
			for (const suite of this.results) {
				const failedTests = suite.tests.filter((t) => t.status === "fail");
				if (failedTests.length > 0) {
					console.log(`\n  ${suite.suite}:`);
					for (const test of failedTests) {
						console.log(`    - ${test.name}`);
						if (test.error) {
							console.log(`      ${test.error.message}`);
						}
					}
				}
			}
		}

		console.log(`\n${"=".repeat(60)}`);

		// Exit with error code if any tests failed
		if (totalFailed > 0) {
			process.exit(1);
		}
	}

	/**
	 * Get all test results
	 */
	getResults(): TestSuiteResult[] {
		return this.results;
	}
}

// Global test runner instance
export const testRunner = new TestRunner();

/**
 * Helper function to define a test suite
 */
export function describe(
	suiteName: string,
	tests: Array<{ name: string; fn: () => Promise<void> | void }>,
): Promise<TestSuiteResult> {
	return testRunner.runSuite(suiteName, tests);
}

/**
 * Helper function to define a test
 */
export function test(
	name: string,
	fn: () => Promise<void> | void,
): { name: string; fn: () => Promise<void> | void } {
	return { name, fn };
}
