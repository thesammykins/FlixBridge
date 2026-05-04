/**
 * Tests for Remove Content Operations
 * Validates content removal preview, protocol filtering, and safety features
 */

import { describe, test } from "../helpers/test-runner.js";
import {
	assertOk,
	assertHasData,
	assertArrayLength,
	assertServiceName,
	assertMediaKind,
	assertPropertyEquals,
	assertHasProperty,
} from "../helpers/assertions.js";
import {
	MockSonarrService,
	MockRadarrService,
} from "../helpers/mock-services.js";

await describe("Remove Content - Queue Preparation", [
	test("should prepare queue item removal with all details", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.prepareRemoval("queue", [123]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");
		assertMediaKind(result.data, "series");

		assertPropertyEquals(result.data, "kind", "queue");
		assertArrayLength(result.data.requestedIds, 1, "requested IDs");
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		assertPropertyEquals(target, "id", 123);
		assertPropertyEquals(target, "source", "queue");
		assertHasProperty(target, "title");
		assertHasProperty(target, "downloadId");
		assertHasProperty(target, "protocol");
	}),

	test("should handle multiple queue items in preparation", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.prepareRemoval("queue", [123, 124, 125]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.requestedIds, 3, "requested IDs");
		assertArrayLength(result.data.targets, 3, "targets");

		// Verify targets are sorted by ID
		const ids = result.data.targets.map((t: { id: number }) => t.id);
		assertPropertyEquals({ sorted: ids }, "sorted", [123, 124, 125]);
	}),

	test("should report missing queue items", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute - request non-existent ID
		const result = await service.prepareRemoval("queue", [999]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.requestedIds, 1, "requested IDs");
		assertArrayLength(result.data.missingIds, 1, "missing IDs");
		assertArrayLength(result.data.targets, 0, "targets should be empty");
		assertPropertyEquals(result.data.missingIds, "0", 999);
	}),

	test("should handle partial matches with some missing IDs", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute - mix of valid and invalid IDs
		const result = await service.prepareRemoval("queue", [123, 999, 124]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.requestedIds, 3, "requested IDs");
		assertArrayLength(result.data.missingIds, 1, "missing IDs");
		assertArrayLength(result.data.targets, 2, "valid targets");
		assertHasProperty(result.data, "notes");
	}),
]);

await describe("Remove Content - Protocol Detection", [
	test("should identify usenet protocol items", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMixedProtocolQueue();

		// Execute
		const result = await service.prepareRemoval("queue", [500]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		assertPropertyEquals(target, "protocol", "usenet");
		assertPropertyEquals(target, "downloadId", "SABnzbd_nzo_usenet001");
	}),

	test("should identify torrent protocol items", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMixedProtocolQueue();

		// Execute
		const result = await service.prepareRemoval("queue", [501]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		assertPropertyEquals(target, "protocol", "torrent");
		assertPropertyEquals(target, "downloadId", "qBittorrent_abc123");
	}),

	test("should handle undefined protocol gracefully", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMixedProtocolQueue();

		// Execute
		const result = await service.prepareRemoval("queue", [503]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		// Protocol should be undefined, not throw an error
		assertPropertyEquals(target, "downloadId", "UnknownClient_xyz789");
	}),

	test("should prepare mixed protocol items", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setMixedProtocolQueue();

		// Execute - all 4 items: 2 usenet, 1 torrent, 1 undefined
		const result = await service.prepareRemoval("queue", [500, 501, 502, 503]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 4, "all protocols prepared");

		// Verify each protocol is present
		const protocols = result.data.targets.map(
			(t: { protocol?: string }) => t.protocol,
		);
		const usenetCount = protocols.filter((p: string) => p === "usenet").length;
		const torrentCount = protocols.filter(
			(p: string) => p === "torrent",
		).length;
		const undefinedCount = protocols.filter(
			(p: string | undefined) => p === undefined,
		).length;

		assertPropertyEquals({ usenet: usenetCount }, "usenet", 2);
		assertPropertyEquals({ torrent: torrentCount }, "torrent", 1);
		assertPropertyEquals({ undefined: undefinedCount }, "undefined", 1);
	}),
]);

await describe("Remove Content - Manual Review Flags", [
	test("should flag items requiring manual investigation", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setStuckQueueItems();

		// Execute - item 200 has "Manual investigation required"
		const result = await service.prepareRemoval("queue", [200]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		assertPropertyEquals(target, "id", 200);
		assertPropertyEquals(target, "manualReviewRequired", true);
	}),

	test("should not flag items without manual review messages", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute - normal downloading item
		const result = await service.prepareRemoval("queue", [123]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		assertPropertyEquals(target, "manualReviewRequired", false);
	}),

	test("should flatten statusMessages for manual review detection", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setStuckQueueItems();

		// Execute
		const result = await service.prepareRemoval("queue", [200]);

		// Assert
		assertOk(result);
		assertHasData(result);

		const target = result.data.targets[0];
		assertHasProperty(target, "statusMessages");
		// Should contain flattened messages including "Manual investigation required"
		const messages = target.statusMessages as string[];
		const hasManualMessage = messages.some((msg: string) =>
			msg.toLowerCase().includes("manual investigation required"),
		);
		assertPropertyEquals({ hasManualMessage }, "hasManualMessage", true);
	}),
]);

await describe("Remove Content - Cross-Service Compatibility", [
	test("should prepare Sonarr queue items", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.prepareRemoval("queue", [123]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "sonarr-main");
		assertMediaKind(result.data, "series");
	}),

	test("should prepare Radarr queue items", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");

		// Execute
		const result = await service.prepareRemoval("queue", [201]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertServiceName(result.data, "radarr-main");
		assertMediaKind(result.data, "movie");
	}),

	test("should handle Radarr torrent items", async () => {
		// Setup
		const service = new MockRadarrService("radarr-main");

		// Execute - item 203 is torrent in radarr fixtures
		const result = await service.prepareRemoval("queue", [203]);

		// Assert
		assertOk(result);
		assertHasData(result);
		assertArrayLength(result.data.targets, 1, "targets");

		const target = result.data.targets[0];
		assertPropertyEquals(target, "protocol", "torrent");
		assertPropertyEquals(target, "downloadId", "qBittorrent_interstellar789");
	}),
]);

await describe("Remove Content - Edge Cases", [
	test("should reject empty ID array", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute
		const result = await service.prepareRemoval("queue", []);

		// Assert - should fail validation
		assertPropertyEquals(result, "ok", false);
		assertHasProperty(result, "error");
	}),

	test("should filter out invalid IDs", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute - includes negative and zero
		const result = await service.prepareRemoval("queue", [-1, 0, 123, -999]);

		// Assert
		assertOk(result);
		assertHasData(result);
		// Only ID 123 should be in requestedIds (after normalization)
		assertArrayLength(result.data.requestedIds, 1, "valid IDs only");
		assertPropertyEquals(result.data.requestedIds, "0", 123);
	}),

	test("should deduplicate IDs", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");

		// Execute - duplicate IDs
		const result = await service.prepareRemoval("queue", [123, 123, 123]);

		// Assert
		assertOk(result);
		assertHasData(result);
		// Should have deduplicated to 1 ID
		assertArrayLength(result.data.requestedIds, 1, "deduplicated IDs");
		assertArrayLength(result.data.targets, 1, "single target");
	}),

	test("should include error messages in target details", async () => {
		// Setup
		const service = new MockSonarrService("sonarr-main");
		service.setStuckQueueItems();

		// Execute - item 200 has errorMessage
		const result = await service.prepareRemoval("queue", [200]);

		// Assert
		assertOk(result);
		assertHasData(result);

		const target = result.data.targets[0];
		assertHasProperty(target, "errorMessage");
		assertPropertyEquals(
			target,
			"errorMessage",
			"Automatic import is not possible.",
		);
	}),
]);
