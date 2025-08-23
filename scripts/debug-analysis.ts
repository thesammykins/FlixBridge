#!/usr/bin/env tsx

/**
 * Direct test of the analyzeQueueItem function to debug why detection isn't working
 */

// Test item based on the actual data from radarr-uhd
const testItem = {
	movieId: 1234,
	languages: [],
	quality: {},
	customFormats: [],
	customFormatScore: 3105,
	size: 15728640000,
	title: "Movie.Title.2025.PROPER.2160p.WEB-DL.DDP5.1.Atmos.H.265-ReleaseGroup",
	estimatedCompletionTime: "2024-01-15T10:30:00Z",
	added: "2024-01-15T09:00:00Z",
	status: "completed",
	trackedDownloadStatus: "warning",
	trackedDownloadState: "importPending",
	statusMessages: [
		{
			title:
				"Movie.Title.2025.PROPER.2160p.WEB-DL.DDP5.1.Atmos.H.265-ReleaseGroup",
			messages: [
				"Not a Custom Format upgrade for existing movie file(s). New: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, Repack/Proper - Notifiarr, x265 - Notifiarr] (3105) do not improve on Existing: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, DV HDR10+, iT, WEB Tier 01, x265 - Notifiarr] (6300)",
			],
		},
	],
	errorMessage: "",
	downloadId: "SABnzbd_nzo_abc123",
	protocol: "usenet",
	downloadClient: "SABnzbd",
	downloadClientHasPostImportCategory: false,
	indexer: "TestIndexer",
	outputPath: "/downloads/completed/movies",
	sizeleft: 0,
	timeleft: "00:00:00",
	id: 1875853230,
};

function analyzeQueueItem(item: any) {
	console.log("🔬 Analyzing queue item step by step...");

	const status = item.status?.toLowerCase() || "";
	const statusMessages = item.statusMessages || [];
	const errorMessage = item.errorMessage || "";

	console.log(`   Status: "${status}"`);
	console.log(`   StatusMessages: ${JSON.stringify(statusMessages, null, 2)}`);
	console.log(`   ErrorMessage: "${errorMessage}"`);

	const allMessages = [
		status,
		...statusMessages.map((m: any) => m.title || m.message || ""),
		...statusMessages.flatMap((m: any) => m.messages || []),
		errorMessage,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

	console.log(`   Combined messages: "${allMessages}"`);

	// Check each condition
	const checks = {
		"thexem and mapping":
			allMessages.includes("thexem") && allMessages.includes("mapping"),
		"not a custom format upgrade": allMessages.includes(
			"not a custom format upgrade",
		),
		"do not improve on existing": allMessages.includes(
			"do not improve on existing",
		),
		timeout: allMessages.includes("timeout"),
		connection: allMessages.includes("connection"),
		network: allMessages.includes("network"),
		dns: allMessages.includes("dns"),
		"disk and space":
			allMessages.includes("disk") &&
			(allMessages.includes("space") || allMessages.includes("full")),
		permission: allMessages.includes("permission"),
		"access denied": allMessages.includes("access denied"),
	};

	console.log(`   Detection checks:`);
	Object.entries(checks).forEach(([check, result]) => {
		console.log(`      ${check}: ${result ? "✅" : "❌"}`);
	});

	// TheXEM mapping issues
	if (allMessages.includes("thexem") && allMessages.includes("mapping")) {
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: { type: "mapping", severity: "warning", autoFixable: true },
			message: "TheXEM mapping issue detected",
			suggestedAction: "Trigger manual import to bypass mapping requirements",
		};
	}

	// Quality downgrade issues
	if (
		allMessages.includes("not a custom format upgrade") ||
		allMessages.includes("do not improve on existing")
	) {
		console.log(`   ✅ MATCHED: Quality downgrade pattern!`);
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: {
				type: "quality_downgrade",
				severity: "warning",
				autoFixable: true,
			},
			message: "Download is not an upgrade over existing file",
			suggestedAction: "Remove from queue as existing file is better quality",
		};
	}

	// Network/connection errors
	if (
		allMessages.includes("timeout") ||
		allMessages.includes("connection") ||
		allMessages.includes("network") ||
		allMessages.includes("dns")
	) {
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: {
				type: "network_error",
				severity: "warning",
				autoFixable: true,
			},
			message: "Network connectivity issue detected",
			suggestedAction: "Retry download after network issue resolution",
		};
	}

	// Disk space issues
	if (
		allMessages.includes("disk") &&
		(allMessages.includes("space") || allMessages.includes("full"))
	) {
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: {
				type: "disk_space",
				severity: "critical",
				autoFixable: false,
			},
			message: "Insufficient disk space",
			suggestedAction: "Free up disk space manually",
		};
	}

	// Permission issues
	if (
		allMessages.includes("permission") ||
		allMessages.includes("access denied")
	) {
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: {
				type: "permissions",
				severity: "critical",
				autoFixable: false,
			},
			message: "File system permission issue",
			suggestedAction: "Fix file permissions manually",
		};
	}

	// Check if item appears stuck (downloading for too long)
	const isStuck =
		status.includes("warning") ||
		status.includes("error") ||
		statusMessages.length > 0;

	if (isStuck) {
		console.log(`   ⚠️  Item appears stuck but no specific pattern matched`);
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: { type: "unknown", severity: "warning", autoFixable: false },
			message: "Item appears stuck with unrecognized issue",
			suggestedAction: "Manual investigation required",
		};
	}

	// No issues detected
	console.log(`   ℹ️  No issues detected`);
	return {
		id: item.id,
		title: item.title,
		status: item.status,
		category: { type: "unknown", severity: "info", autoFixable: false },
		message: "No issues detected",
		suggestedAction: "No action needed",
	};
}

function testFiltering(analysis: any) {
	console.log("\n🔍 Testing filtering logic...");

	// This is the current filtering logic
	const isRealIssue = !(
		analysis.category.type === "unknown" &&
		analysis.category.severity === "info"
	);

	console.log(`   Analysis category: ${analysis.category.type}`);
	console.log(`   Analysis severity: ${analysis.category.severity}`);
	console.log(
		`   Is real issue (should be included): ${isRealIssue ? "✅ YES" : "❌ NO"}`,
	);

	return isRealIssue;
}

function main() {
	console.log("🚀 Direct Analysis Function Test");
	console.log("================================\n");

	console.log("🎬 Test item:");
	console.log(`   Title: ${testItem.title}`);
	console.log(`   Status: ${testItem.status}`);
	console.log(`   TrackedDownloadStatus: ${testItem.trackedDownloadStatus}`);
	console.log(
		`   StatusMessages: ${testItem.statusMessages.length} messages\n`,
	);

	const analysis = analyzeQueueItem(testItem);

	console.log("\n📊 Analysis Result:");
	console.log(JSON.stringify(analysis, null, 2));

	const wouldBeIncluded = testFiltering(analysis);

	console.log(`\n🎯 Final Result:`);
	console.log(
		`   Would this issue be included in diagnostics: ${wouldBeIncluded ? "✅ YES" : "❌ NO"}`,
	);
	console.log(
		`   Would auto-fix be attempted: ${analysis.category.autoFixable ? "✅ YES" : "❌ NO"}`,
	);

	if (wouldBeIncluded && analysis.category.autoFixable) {
		console.log(`   Expected action: ${analysis.suggestedAction}`);
		console.log(`   ✅ This should work correctly!`);
	} else {
		console.log(`   ❌ This explains why it's not working`);
	}
}

main();
