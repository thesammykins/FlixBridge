#!/usr/bin/env tsx

import {
	createService,
	systemStatus,
	queueList,
	rootFolderList,
} from "../src/core.js";

interface MultiInstanceConfig {
	services: Record<
		string,
		{
			baseUrl: string;
			apiKey: string;
			description?: string;
			tags?: string[];
		}
	>;
}

async function demonstrateMultiInstance(): Promise<void> {
	console.log("🏗️  Multi-Instance ARR MCP Demo");
	console.log("=====================================\n");

	// Example configuration with multiple instances
	const config: MultiInstanceConfig = {
		services: {
			"sonarr-main": {
				baseUrl: "http://localhost:8989",
				apiKey: "main-api-key",
				description: "Main Sonarr for 1080p TV shows",
				tags: ["main", "tv", "1080p"],
			},
			"sonarr-4k": {
				baseUrl: "http://localhost:8990",
				apiKey: "4k-api-key",
				description: "4K Sonarr for UHD TV shows",
				tags: ["4k", "tv", "uhd"],
			},
			"sonarr-anime": {
				baseUrl: "http://anime-server:8989",
				apiKey: "anime-api-key",
				description: "Anime-focused Sonarr instance",
				tags: ["anime", "tv", "specialized"],
			},
			"radarr-main": {
				baseUrl: "http://localhost:7878",
				apiKey: "main-radarr-key",
				description: "Main Radarr for 1080p movies",
				tags: ["main", "movies", "1080p"],
			},
			"radarr-4k": {
				baseUrl: "http://localhost:7879",
				apiKey: "4k-radarr-key",
				description: "4K Radarr for UHD movies",
				tags: ["4k", "movies", "uhd"],
			},
		},
	};

	console.log("📋 Configured Services:");
	for (const [name, cfg] of Object.entries(config.services)) {
		const serviceType = name.toLowerCase().includes("sonarr")
			? "sonarr"
			: "radarr";
		console.log(
			`  • ${name} (${serviceType}) - ${cfg.description || cfg.baseUrl}`,
		);
		if (cfg.tags) {
			console.log(`    Tags: ${cfg.tags.join(", ")}`);
		}
	}

	console.log("\n🔧 Creating Service Instances:");

	// Create service instances
	const services: Record<string, any> = {};
	for (const [name, cfg] of Object.entries(config.services)) {
		const serviceType = name.toLowerCase().includes("sonarr")
			? ("sonarr" as const)
			: ("radarr" as const);

		services[name] = createService(serviceType, cfg.baseUrl, cfg.apiKey);
		console.log(`  ✅ Created ${name} (${serviceType})`);
	}

	console.log("\n🧪 Testing Multi-Instance Operations:");

	// Test system status across all instances
	console.log("\n1️⃣  System Status Check:");
	for (const [name, service] of Object.entries(services)) {
		try {
			console.log(`  📊 Checking ${name}...`);
			const result = await systemStatus(service);
			if (result.ok) {
				console.log(
					`    ✅ ${result.data.name} v${result.data.version} (${result.data.isHealthy ? "healthy" : "unhealthy"})`,
				);
			} else {
				console.log(`    ❌ Error: ${JSON.stringify(result.error)}`);
			}
		} catch (error) {
			console.log(`    ❌ Failed: ${error}`);
		}
	}

	// Test queue operations on specific instances
	console.log("\n2️⃣  Queue Operations:");

	const testQueueOperations = async (serviceName: string) => {
		console.log(`  📥 Testing queue for ${serviceName}...`);
		try {
			const result = await queueList(services[serviceName], { pageSize: 5 });
			if (result.ok) {
				console.log(
					`    ✅ Found ${result.data.total} items in ${serviceName} queue (${result.data.mediaKind})`,
				);
				if (result.data.items.length > 0) {
					console.log(`    📝 Sample items:`);
					result.data.items.slice(0, 2).forEach((item: any) => {
						console.log(
							`      - #${item.id}: ${item.title} (${item.status})${
								item.progressPct ? ` - ${item.progressPct}%` : ""
							}`,
						);
					});
				}
			} else {
				console.log(`    ❌ Queue error: ${JSON.stringify(result.error)}`);
			}
		} catch (error) {
			console.log(`    ❌ Queue failed: ${error}`);
		}
	};

	// Test a few specific instances
	await testQueueOperations("sonarr-main");
	await testQueueOperations("sonarr-4k");
	await testQueueOperations("radarr-main");

	// Test root folder discovery
	console.log("\n3️⃣  Root Folder Discovery:");

	const testRootFolders = async (serviceName: string) => {
		console.log(`  📁 Checking root folders for ${serviceName}...`);
		try {
			const result = await rootFolderList(services[serviceName]);
			if (result.ok) {
				console.log(
					`    ✅ Found ${result.data.total} root folders for ${serviceName}`,
				);
				result.data.folders.forEach((folder: any) => {
					const freeSpace = folder.freeSpaceBytes
						? `(${(folder.freeSpaceBytes / 1024 / 1024 / 1024).toFixed(1)}GB free)`
						: "";
					console.log(`      - ${folder.path} ${freeSpace}`);
				});
			} else {
				console.log(`    ❌ Folder error: ${JSON.stringify(result.error)}`);
			}
		} catch (error) {
			console.log(`    ❌ Folder check failed: ${error}`);
		}
	};

	await testRootFolders("sonarr-main");
	await testRootFolders("radarr-4k");

	console.log("\n🎯 Multi-Instance Usage Examples:");
	console.log(`
  // Get status from specific instance
  {
    "tool": "System Status",
    "arguments": { "service": "sonarr-4k" }
  }

  // List queue from anime Sonarr
  {
    "tool": "Queue List",
    "arguments": {
      "service": "sonarr-anime",
      "pageSize": 20
    }
  }

  // Grab items from main Radarr
  {
    "tool": "Queue Grab",
    "arguments": {
      "service": "radarr-main",
      "ids": [123, 456]
    }
  }

  // Check storage on 4K instances
  {
    "tool": "Root Folders",
    "arguments": { "service": "radarr-4k" }
  }
  `);

	console.log("\n📊 Service Categories:");

	const sonarrServices = Object.keys(config.services).filter((name) =>
		name.includes("sonarr"),
	);
	const radarrServices = Object.keys(config.services).filter((name) =>
		name.includes("radarr"),
	);
	const fourKServices = Object.keys(config.services).filter((name) =>
		config.services[name]?.tags?.includes("4k"),
	);
	const mainServices = Object.keys(config.services).filter((name) =>
		config.services[name]?.tags?.includes("main"),
	);

	console.log(`  📺 TV (Sonarr): ${sonarrServices.join(", ")}`);
	console.log(`  🎬 Movies (Radarr): ${radarrServices.join(", ")}`);
	console.log(`  🎞️  4K Quality: ${fourKServices.join(", ")}`);
	console.log(`  ⭐ Main Instances: ${mainServices.join(", ")}`);

	console.log("\n✅ Multi-instance demonstration complete!");
	console.log("\n💡 Key Benefits:");
	console.log(
		"  • Separate instances for different quality levels (1080p vs 4K)",
	);
	console.log(
		"  • Specialized instances for different content types (anime, kids)",
	);
	console.log("  • Geographic separation (different servers/locations)");
	console.log("  • Environment separation (production vs testing)");
	console.log("  • All accessible through single MCP interface");
}

// Example of service filtering helper functions
export function filterServicesByTag(
	config: MultiInstanceConfig,
	tag: string,
): string[] {
	return Object.entries(config.services)
		.filter(([_, cfg]) => cfg.tags?.includes(tag))
		.map(([name, _]) => name);
}

export function filterServicesByType(
	config: MultiInstanceConfig,
	type: "sonarr" | "radarr",
): string[] {
	return Object.keys(config.services).filter((name) =>
		name.toLowerCase().includes(type),
	);
}

export function getServicesByPriority(config: MultiInstanceConfig): {
	main: string[];
	secondary: string[];
	specialized: string[];
} {
	const main = filterServicesByTag(config, "main");
	const specialized = filterServicesByTag(config, "specialized");
	const all = Object.keys(config.services);
	const secondary = all.filter(
		(name) => !main.includes(name) && !specialized.includes(name),
	);

	return { main, secondary, specialized };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	demonstrateMultiInstance().catch((error) => {
		console.error("❌ Demo failed:", error);
		process.exit(1);
	});
}
