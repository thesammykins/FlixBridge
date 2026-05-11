/**
 * Tests for System Operations (system_status, root_folders)
 * Validates system information and storage configuration
 */

import {
	assertArrayLength,
	assertHasData,
	assertHasProperty,
	assertMediaKind,
	assertOk,
	assertPropertyEquals,
	assertServiceName,
	assertValidRootFolder,
} from "../helpers/assertions.js";
import {
	MockRadarrService,
	MockSonarrService,
} from "../helpers/mock-services.js";
import { describe, test } from "../helpers/test-runner.js";

await describe("System Status - Sonarr", [
	test("should return system status with correct structure", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.systemStatus();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");

		assertHasProperty(result.data, "name");
		assertHasProperty(result.data, "version");
		assertHasProperty(result.data, "isHealthy");

		assertPropertyEquals(result.data, "isHealthy", true);
	}),

	test("should include version information", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.systemStatus();

		// Assert
		assertOk(result);
		assertHasData(result);

		// Version should be from fixtures: "4.0.0.746"
		assertPropertyEquals(result.data, "version", "4.0.0.746");
	}),

	test("should handle instance name from config", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-anime");

		// Execute
		const result = await service.systemStatus();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-anime");

		// Name should use instanceName from API or fall back to appName
		assertHasProperty(result.data, "name");
	}),
]);

await describe("System Status - Radarr", [
	test("should return Radarr system status", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");

		// Execute
		const result = await service.systemStatus();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "radarr-main");

		// Version should be from fixtures: "5.2.6.8376"
		assertPropertyEquals(result.data, "version", "5.2.6.8376");
	}),

	test("should indicate healthy status", async () => {
		// Setup
		const service = new MockRadarrService("radarr-4k");

		// Execute
		const result = await service.systemStatus();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertPropertyEquals(result.data, "isHealthy", true);
	}),
]);

await describe("Root Folders - Sonarr", [
	test("should list root folders with storage information", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.rootFolderList();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");
		assertMediaKind(result.data, "series");

		assertArrayLength(result.data.folders, 2, "root folders");
		assertPropertyEquals(result.data, "total", 2);

		// Validate folder structure
		for (const folder of result.data.folders) {
			assertValidRootFolder(folder);
		}
	}),

	test("should include free space information", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.rootFolderList();

		// Assert
		assertOk(result);
		assertHasData(result);

		const firstFolder = result.data.folders[0];

		// From fixtures: freeSpace: 1000000000000 (1TB)
		assertPropertyEquals(firstFolder, "freeSpaceBytes", 1000000000000);
	}),

	test("should provide default root folder ID", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.rootFolderList();

		// Assert
		assertOk(result);
		assertHasData(result);

		// Default should be first folder's ID
		assertHasProperty(result.data, "defaultId");
		assertPropertyEquals(result.data, "defaultId", 1);
	}),

	test("should handle empty root folder list", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMockResponse("/rootfolder", []);

		// Execute
		const result = await service.rootFolderList();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.folders, 0, "root folders");
		assertPropertyEquals(result.data, "total", 0);
	}),
]);

await describe("Root Folders - Radarr", [
	test("should list Radarr root folders", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");

		// Execute
		const result = await service.rootFolderList();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "radarr-main");
		assertMediaKind(result.data, "movie");

		assertArrayLength(result.data.folders, 2, "root folders");

		// Check paths are movie-specific
		const firstFolder = result.data.folders[0];
		assertPropertyEquals(firstFolder, "path", "/media/movies");
	}),

	test("should include 4K folder configuration", async () => {
		// Setup
		const service = new MockRadarrService("radarr-4k");

		// Execute
		const result = await service.rootFolderList();

		// Assert
		assertOk(result);
		assertHasData(result);

		// Check for 4K-specific folder
		const uhd4kFolder = result.data.folders.find(
			(f: { path: string }) => f.path === "/media/movies-4k",
		);

		assertHasProperty(uhd4kFolder as object, "id");
		assertHasProperty(uhd4kFolder as object, "freeSpaceBytes");
	}),
]);
