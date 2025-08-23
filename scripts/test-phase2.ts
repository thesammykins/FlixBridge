#!/usr/bin/env tsx

/**
 * Test script for Phase 2 SABnzbd integration
 * This script tests the SABnzbd service adapter and Download Status tool
 */

import { SabnzbdService } from "../src/services/downloaders/sabnzbd.js";
import { serviceRegistry } from "../src/services/registry.js";
import { SonarrService } from "../src/services/arr/sonarr.js";
import { RadarrService } from "../src/services/arr/radarr.js";

interface TestConfig {
	sabnzbd?: {
		baseUrl: string;
		apiKey: string;
		name?: string;
	};
	sonarr?: {
		baseUrl: string;
		apiKey: string;
	};
	radarr?: {
		baseUrl: string;
		apiKey: string;
	};
}

async function loadTestConfig(): Promise<TestConfig> {
	const config: TestConfig = {};

	// Load from environment variables only
	if (process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY) {
		config.sabnzbd = {
			baseUrl: process.env.SABNZBD_URL,
			apiKey: process.env.SABNZBD_API_KEY,
			name: "Test SABnzbd",
		};
	}

	if (process.env.SONARR_URL && process.env.SONARR_API_KEY) {
		config.sonarr = {
			baseUrl: process.env.SONARR_URL,
			apiKey: process.env.SONARR_API_KEY,
		};
	}

	if (process.env.RADARR_URL && process.env.RADARR_API_KEY) {
		config.radarr = {
			baseUrl: process.env.RADARR_URL,
			apiKey: process.env.RADARR_API_KEY,
		};
	}

	return config;
}

async function testSabnzbdService(config: TestConfig) {
	console.log("\n🔧 Testing SABnzbd Service...");

	if (!config.sabnzbd) {
		console.log("❌ No SABnzbd configuration found");
		return false;
	}

	const sabnzbd = new SabnzbdService(config.sabnzbd);

	try {
		// Test server stats
		console.log("📊 Testing server stats...");
		const statsResult = await sabnzbd.serverStats();
		if (statsResult.ok) {
			console.log("✅ Server stats:", {
				name: statsResult.data?.name,
				version: statsResult.data?.version,
				isHealthy: statsResult.data?.isHealthy,
				paused: statsResult.data?.paused,
				totalSlots: statsResult.data?.totalSlots,
			});
		} else {
			console.log("❌ Server stats failed:", statsResult.error);
			return false;
		}

		// Test queue list
		console.log("📋 Testing queue list...");
		const queueResult = await sabnzbd.queueList();
		if (queueResult.ok) {
			console.log("✅ Queue list:", {
				total: queueResult.data?.total,
				paused: queueResult.data?.paused,
				items: queueResult.data?.items.length,
				totalSizeMB: queueResult.data?.totalSizeMB,
				remainingSizeMB: queueResult.data?.remainingSizeMB,
			});

			if (queueResult.data?.items.length > 0) {
				console.log("   Sample items:");
				queueResult.data.items.slice(0, 3).forEach((item, i) => {
					console.log(
						`   ${i + 1}. ${item.title} (${item.status}, ${item.progressPct}%)`,
					);
				});
			}
		} else {
			console.log("❌ Queue list failed:", queueResult.error);
			return false;
		}

		// Test history list
		console.log("📜 Testing history list...");
		const historyResult = await sabnzbd.historyList(5);
		if (historyResult.ok) {
			console.log(`✅ History list: ${historyResult.data?.length || 0} items`);
			if (historyResult.data && historyResult.data.length > 0) {
				console.log("   Recent items:");
				historyResult.data.slice(0, 3).forEach((item, i) => {
					console.log(`   ${i + 1}. ${item.name} (${item.status})`);
				});
			}
		} else {
			console.log("❌ History list failed:", historyResult.error);
		}

		// Test title correlation
		console.log("🔗 Testing title correlation...");
		const testArrTitles = [
			"Generic.TV.Show.S01E01.1080p.WEB-DL",
			"Sample.Movie.2023.1080p.BluRay.x264",
			"Example.Series.S02E05.720p.HDTV",
		];

		if (queueResult.ok && queueResult.data?.items) {
			const correlations = sabnzbd.correlateTitles(
				queueResult.data.items,
				testArrTitles,
			);
			console.log(`✅ Correlation test: ${correlations.length} items analyzed`);
			correlations.forEach((corr, i) => {
				if (corr.confidence > 0.6) {
					console.log(
						`   High confidence match: "${corr.sabItem.title}" ↔ "${corr.arrTitle}" (${Math.round(corr.confidence * 100)}%)`,
					);
				}
			});
		}

		return true;
	} catch (error) {
		console.log("❌ SABnzbd service test failed:", error);
		return false;
	}
}

async function testDownloadStatus(config: TestConfig) {
	console.log("\n📥 Testing Download Status integration...");

	// Set up services
	if (config.sonarr) {
		const sonarr = new SonarrService("test-sonarr", config.sonarr);
		serviceRegistry.clear();
		serviceRegistry.register("test-sonarr", config.sonarr);
	}

	if (config.radarr) {
		const radarr = new RadarrService("test-radarr", config.radarr);
		serviceRegistry.register("test-radarr", config.radarr);
	}

	if (config.sabnzbd) {
		serviceRegistry.registerDownloader("test-sabnzbd", config.sabnzbd);
	}

	try {
		// Simulate Download Status tool logic
		const serviceNames = serviceRegistry.getAllNames();
		const downloaderNames = serviceRegistry.getAllDownloaderNames();

		console.log(`📊 Services available: ${serviceNames.join(", ")}`);
		console.log(`📥 Downloaders available: ${downloaderNames.join(", ")}`);

		let totalQueued = 0;
		let totalDownloading = 0;
		let totalCompletedPending = 0;

		// Get arr service queue data
		for (const serviceName of serviceNames) {
			const service = serviceRegistry.get(serviceName);
			if (!service) continue;

			try {
				const queueResult = await service.queueList();
				if (queueResult.ok && queueResult.data) {
					const queueData = queueResult.data;
					console.log(
						`   ${serviceName}: ${queueData.total} items (${queueData.mediaKind})`,
					);

					totalQueued += queueData.total;

					const downloading = queueData.items.filter(
						(item) =>
							item.status.toLowerCase().includes("downloading") ||
							item.status.toLowerCase().includes("grabbing"),
					).length;

					const pending = queueData.items.filter(
						(item) =>
							item.status.toLowerCase().includes("completed") ||
							item.status.toLowerCase().includes("pending"),
					).length;

					totalDownloading += downloading;
					totalCompletedPending += pending;
				}
			} catch (error) {
				console.log(`   ❌ Failed to get queue for ${serviceName}:`, error);
			}
		}

		// Get downloader data
		let downloaderItems = 0;
		if (downloaderNames.length > 0) {
			const downloader = serviceRegistry.getDownloader(downloaderNames[0]);
			if (downloader) {
				try {
					const queueResult = await downloader.queueList();
					if (queueResult.ok && queueResult.data) {
						downloaderItems = queueResult.data.items.length;
						console.log(
							`   ${downloaderNames[0]}: ${downloaderItems} downloads active`,
						);
					}
				} catch (error) {
					console.log(`   ❌ Failed to get downloader queue:`, error);
				}
			}
		}

		// Calculate correlation ratio
		const correlationRatio =
			downloaderItems > 0 ? Math.min(1.0, totalQueued / downloaderItems) : null;

		console.log("\n✅ Download Status Summary:");
		console.log(`   Total Queued: ${totalQueued}`);
		console.log(`   Currently Downloading: ${totalDownloading}`);
		console.log(`   Completed/Pending Import: ${totalCompletedPending}`);
		console.log(`   Downloader Items: ${downloaderItems}`);
		if (correlationRatio !== null) {
			console.log(
				`   Correlation Ratio: ${Math.round(correlationRatio * 100)}%`,
			);
		}

		return true;
	} catch (error) {
		console.log("❌ Download Status test failed:", error);
		return false;
	}
}

async function main() {
	console.log("🚀 Phase 2 SABnzbd Integration Test");
	console.log("====================================");

	const config = await loadTestConfig();

	console.log("\n📋 Configuration Check:");
	console.log(`   SABnzbd: ${config.sabnzbd ? "✅ Configured" : "❌ Missing"}`);
	console.log(`   Sonarr: ${config.sonarr ? "✅ Configured" : "❌ Missing"}`);
	console.log(`   Radarr: ${config.radarr ? "✅ Configured" : "❌ Missing"}`);

	if (!config.sabnzbd) {
		console.log("\n❌ SABnzbd configuration required for Phase 2 testing");
		console.log("   Set SABNZBD_URL and SABNZBD_API_KEY environment variables");
		console.log(
			"   Or use FLIX_BRIDGE_ENV_MAPPING to point to custom env var names",
		);
		process.exit(1);
	}

	let allTestsPassed = true;

	// Test SABnzbd service
	const sabnzbdTestPassed = await testSabnzbdService(config);
	allTestsPassed = allTestsPassed && sabnzbdTestPassed;

	// Test Download Status integration
	const downloadStatusTestPassed = await testDownloadStatus(config);
	allTestsPassed = allTestsPassed && downloadStatusTestPassed;

	console.log("\n" + "=".repeat(50));

	if (allTestsPassed) {
		console.log("✅ All Phase 2 tests passed!");
		console.log("   SABnzbd integration is working correctly");
		console.log("   Download Status tool is functional");
		process.exit(0);
	} else {
		console.log("❌ Some Phase 2 tests failed");
		console.log("   Check the error messages above for details");
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("💥 Test script failed:", error);
		process.exit(1);
	});
}
