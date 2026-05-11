/**
 * Tests for Service Discovery (list_services tool)
 * Validates service and downloader registration and discovery
 */

import { serviceRegistry } from "../../src/services/registry.js";
import {
	assertArrayLength,
	assertHasData,
	assertHasProperty,
	assertOk,
	assertPropertyEquals,
} from "../helpers/assertions.js";
import { createMockServiceConfig } from "../helpers/mock-services.js";
import { describe, test } from "../helpers/test-runner.js";

await describe("Service Discovery - list_services", [
	test("should discover registered Sonarr services", async () => {
		// Setup
		serviceRegistry.clear();
		const config = createMockServiceConfig({
			baseUrl: "http://localhost:8989",
		});
		serviceRegistry.register("sonarr-main", config);

		// Execute
		const services = serviceRegistry.getAllNames();

		// Assert
		assertArrayLength(services, 1, "registered services");
		assertArrayLength(serviceRegistry.getAllNames(), 1);

		const service = serviceRegistry.get("sonarr-main");
		assertHasProperty(service as object, "id", "service");
		assertPropertyEquals(service as { id: string }, "id", "sonarr");
	}),

	test("should discover registered Radarr services", async () => {
		// Setup
		serviceRegistry.clear();
		const config = createMockServiceConfig({
			baseUrl: "http://localhost:7878",
		});
		serviceRegistry.register("radarr-main", config);

		// Execute
		const services = serviceRegistry.getAllNames();

		// Assert
		assertArrayLength(services, 1, "registered services");

		const service = serviceRegistry.get("radarr-main");
		assertHasProperty(service as object, "id", "service");
		assertPropertyEquals(service as { id: string }, "id", "radarr");
	}),

	test("should handle multiple service instances", async () => {
		// Setup
		serviceRegistry.clear();
		const config1 = createMockServiceConfig({
			baseUrl: "http://localhost:8989",
		});
		const config2 = createMockServiceConfig({
			baseUrl: "http://localhost:8990",
		});
		const config3 = createMockServiceConfig({
			baseUrl: "http://localhost:7878",
		});

		serviceRegistry.register("sonarr-hd", config1);
		serviceRegistry.register("sonarr-4k", config2);
		serviceRegistry.register("radarr-main", config3);

		// Execute
		const services = serviceRegistry.getAllNames();

		// Assert
		assertArrayLength(services, 3, "registered services");
		assertArrayLength(
			services.filter((name) => name.startsWith("sonarr")),
			2,
			"Sonarr services",
		);
		assertArrayLength(
			services.filter((name) => name.startsWith("radarr")),
			1,
			"Radarr services",
		);
	}),

	test("should detect service type from name", async () => {
		// Setup
		serviceRegistry.clear();
		serviceRegistry.register("sonarr-anime", createMockServiceConfig());
		serviceRegistry.register("radarr-4k", createMockServiceConfig());

		// Execute
		const sonarrService = serviceRegistry.get("sonarr-anime");
		const radarrService = serviceRegistry.get("radarr-4k");

		// Assert
		assertPropertyEquals(sonarrService as { id: string }, "id", "sonarr");
		assertPropertyEquals(
			sonarrService as { mediaKind: string },
			"mediaKind",
			"series",
		);

		assertPropertyEquals(radarrService as { id: string }, "id", "radarr");
		assertPropertyEquals(
			radarrService as { mediaKind: string },
			"mediaKind",
			"movie",
		);
	}),

	test("should generate service list output format", async () => {
		// Setup
		serviceRegistry.clear();
		serviceRegistry.register("sonarr-main", createMockServiceConfig());
		serviceRegistry.register("radarr-main", createMockServiceConfig());

		// Execute - simulate list_services tool logic
		const services = serviceRegistry.getAllNames();
		const downloaders = serviceRegistry.getAllDownloaderNames();

		const result = {
			ok: true as const,
			data: {
				services: services.map((name) => ({
					name,
					type: serviceRegistry.get(name)?.id || "unknown",
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

		// Assert
		assertOk(result);
		assertHasData(result);
		assertHasProperty(result.data, "services");
		assertHasProperty(result.data, "downloaders");
		assertHasProperty(result.data, "summary");

		assertArrayLength(result.data.services, 2, "services in result");
		assertPropertyEquals(result.data.summary, "totalServices", 2);
		assertPropertyEquals(result.data.summary, "totalDownloaders", 0);

		// Check service types
		const sonarrEntry = result.data.services.find(
			(s) => s.name === "sonarr-main",
		);
		const radarrEntry = result.data.services.find(
			(s) => s.name === "radarr-main",
		);

		assertHasProperty(sonarrEntry as object, "type");
		assertPropertyEquals(sonarrEntry as { type: string }, "type", "sonarr");

		assertHasProperty(radarrEntry as object, "type");
		assertPropertyEquals(radarrEntry as { type: string }, "type", "radarr");
	}),

	test("should handle empty registry", async () => {
		// Setup
		serviceRegistry.clear();

		// Execute
		const services = serviceRegistry.getAllNames();
		const downloaders = serviceRegistry.getAllDownloaderNames();

		// Assert
		assertArrayLength(services, 0, "services");
		assertArrayLength(downloaders, 0, "downloaders");
	}),
]);
