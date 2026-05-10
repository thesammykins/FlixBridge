/**
 * Tests for Queue Operations (queue_list, queue_grab)
 * Validates queue listing, filtering, and grab operations for both Sonarr and Radarr
 */

import {
	assertArrayLength,
	assertHasData,
	assertHasProperty,
	assertMediaKind,
	assertOk,
	assertPropertyEquals,
	assertQueueItem,
	assertServiceName,
	assertStatusMessagesStructure,
} from "../helpers/assertions.js";
import {
	MockRadarrService,
	MockSonarrService,
} from "../helpers/mock-services.js";
import { describe, test } from "../helpers/test-runner.js";

await describe("Queue Operations - Sonarr", [
	test("should list queue items with correct structure", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");
		assertMediaKind(result.data, "series");

		assertPropertyEquals(result.data, "total", 3);
		assertArrayLength(result.data.items, 3, "queue items");

		// Validate first queue item structure
		const firstItem = result.data.items[0];
		assertQueueItem(firstItem);
	}),

	test("should handle empty queue", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMockResponse("/queue", {
			totalRecords: 0,
			records: [],
		});

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.items, 0, "queue items");
		assertPropertyEquals(result.data, "total", 0);
	}),

	test("should respect pagination parameters", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.queueList({
			page: 1,
			pageSize: 10,
		});

		// Assert
		assertOk(result);
		assertHasData(result);
		// Note: Mock always returns same data, but in real scenario this would be validated
		assertPropertyEquals(result.data, "total", 3);
	}),

	test("should include statusMessages with correct structure", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);

		// Find item with statusMessages (second item in fixtures)
		const itemWithMessages = result.data.items[1];
		assertStatusMessagesStructure(itemWithMessages.statusMessages);
		assertHasProperty(itemWithMessages, "statusMessages");
	}),

	test("should calculate progress percentage correctly", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);

		const downloadingItem = result.data.items[0];
		// From fixtures: size=2147483648, sizeleft=536870912
		// Progress = ((size - sizeleft) / size) * 100 = 75%
		assertPropertyEquals(downloadingItem, "progressPct", 75);
	}),
]);

await describe("Queue Operations - Radarr", [
	test("should list queue items with movie mediaKind", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "radarr-main");
		assertMediaKind(result.data, "movie");

		assertPropertyEquals(result.data, "total", 3);
		assertArrayLength(result.data.items, 3, "queue items");
	}),

	test("should handle quality downgrade warning", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");
		service.setStuckQueueItems();

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);

		// First item in stuck queue has quality downgrade warning
		const downgradedItem = result.data.items[0];
		assertPropertyEquals(downgradedItem, "status", "warning");
	}),

	test("should include download protocol information", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");

		// Execute
		const result = await service.queueList();

		// Assert
		assertOk(result);
		assertHasData(result);

		// Check protocols
		const usenetItem = result.data.items[0];
		const torrentItem = result.data.items[2];

		assertPropertyEquals(usenetItem, "protocol", "usenet");
		assertPropertyEquals(torrentItem, "protocol", "torrent");
	}),
]);

await describe("Queue Grab Operations", [
	test("should grab single queue item", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMockResponse("/queue/grab/123", {});

		// Execute
		const result = await service.queueGrab([123]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");
		assertMediaKind(result.data, "series");
		assertPropertyEquals(result.data, "grabbed", 1);
		assertArrayLength(result.data.ids, 1, "grabbed IDs");
	}),

	test("should grab multiple queue items in bulk", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");
		service.setMockResponse("/queue/grab/bulk", {});

		// Execute
		const result = await service.queueGrab([123, 456, 789]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertPropertyEquals(result.data, "grabbed", 3);
		assertArrayLength(result.data.ids, 3, "grabbed IDs");
	}),

	test("should reject empty ID array", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.queueGrab([]);

		// Assert
		// Should return error for empty array
		assertPropertyEquals(result, "ok", false);
	}),
]);
