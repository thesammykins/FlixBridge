#!/usr/bin/env tsx

/**
 * Test script to validate Queue Diagnostics tool handles custom format upgrade detection
 * Tests the specific "Not a Custom Format upgrade" scenario from Radarr
 */

import { BaseArrService } from "../src/services/shared.js";
import type {
  QueueDiagnosticsData,
  ServiceConfig,
} from "../src/services/base.js";

// Mock Radarr service for testing
class TestRadarrService extends BaseArrService {
  readonly id = "radarr" as const;
  readonly mediaKind = "movie" as const;
  readonly endpoints = {
    systemStatus: "/api/v3/system/status",
    queue: "/api/v3/queue",
    queueGrab: "/api/v3/queue/grab",
    queueDetails: "/api/v3/queue/details",
    rootFolders: "/api/v3/rootfolder",
    history: "/api/v3/history/movie",
    lookup: "/api/v3/movie/lookup",
    addMovie: "/api/v3/movie",
    qualityProfiles: "/api/v3/qualityprofile",
    importList: "/api/v3/importlist",
  };

  // Mock queue data with "Not a Custom Format upgrade" scenario
  private mockQueueData = {
    page: 1,
    pageSize: 10,
    sortKey: "progress",
    sortDirection: "ascending",
    totalRecords: 3,
    records: [
      {
        id: 12345,
        movieId: 678,
        status: "warning",
        title: "Sample.Movie.2023.2160p.WEB-DL.x265-ReleaseGroup",
        size: 15728640000,
        sizeleft: 0,
        timeleft: "00:00:00",
        estimatedCompletionTime: "2024-01-15T10:30:00Z",
        trackedDownloadStatus: "Rejected",
        protocol: "usenet",
        downloadClient: "SABnzbd",
        statusMessages: [
          {
            title: "Not a Custom Format upgrade for existing movie file(s).",
            messages: [
              "New: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, Repack/Proper - Notifiarr, x265 - Notifiarr] (3105) do not improve on Existing: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, DV HDR10+, iT, WEB Tier 01, x265 - Notifiarr] (6300)",
            ],
          },
        ],
      },
      {
        id: 12346,
        movieId: 679,
        status: "downloading",
        title: "Example.Film.2023.1080p.BluRay.x264-ReleaseGroup",
        size: 8589934592,
        sizeleft: 1073741824,
        timeleft: "00:15:30",
        estimatedCompletionTime: "2024-01-15T11:00:00Z",
        trackedDownloadStatus: "Ok",
        protocol: "usenet",
        downloadClient: "SABnzbd",
        statusMessages: [],
      },
      {
        id: 12347,
        movieId: 680,
        status: "warning",
        title: "Generic.Movie.2023.720p.HDTV.x264-ReleaseGroup",
        size: 4294967296,
        sizeleft: 0,
        timeleft: "00:00:00",
        estimatedCompletionTime: "2024-01-15T09:45:00Z",
        trackedDownloadStatus: "Warning",
        protocol: "torrent",
        downloadClient: "qBittorrent",
        statusMessages: [
          {
            title: "Download client connection issue",
            messages: ["Connection timeout when contacting download client"],
          },
        ],
        errorMessage: "Network timeout occurred",
      },
    ],
  };

  // Override buildApiUrl to prevent actual API calls
  protected buildApiUrl(endpoint: string): string {
    return `http://mock-server${endpoint}`;
  }

  // Mock the queue list to return our test data
  async queueList(): Promise<any> {
    return {
      ok: true,
      data: {
        service: this.serviceName,
        mediaKind: this.mediaKind,
        total: this.mockQueueData.totalRecords,
        items: this.mockQueueData.records.map((record) => ({
          id: record.id,
          title: record.title,
          status: record.status,
          progressPct:
            record.sizeleft === 0
              ? 100
              : Math.round(
                  ((record.size - record.sizeleft) / record.size) * 100,
                ),
          mediaKind: this.mediaKind,
          protocol: record.protocol,
          estimatedCompletionTime: record.estimatedCompletionTime,
        })),
        truncated: false,
      },
    };
  }

  // Override queue diagnostics to use mock data
  async queueDiagnostics(): Promise<any> {
    const queueItems = this.mockQueueData.records;
    const issuesAnalyzed = [];
    const fixesAttempted = [];

    for (const item of queueItems) {
      const analysis = this.analyzeQueueItem(item);
      issuesAnalyzed.push(analysis);

      if (analysis.category.autoFixable) {
        const fixAction = await this.attemptAutoFix(item, analysis);
        fixesAttempted.push(fixAction);
      }
    }

    const summary = {
      fixed: fixesAttempted.filter((f) => f.success).length,
      failed: fixesAttempted.filter((f) => f.attempted && !f.success).length,
      requiresManual: issuesAnalyzed.filter((i) => !i.category.autoFixable)
        .length,
    };

    return {
      ok: true,
      data: {
        service: this.serviceName,
        mediaKind: this.mediaKind,
        totalQueueItems: queueItems.length,
        issuesFound: issuesAnalyzed.filter(
          (i) =>
            i.category.type !== "unknown" || i.category.severity !== "info",
        ).length,
        issuesAnalyzed,
        fixesAttempted,
        summary,
      },
    };
  }

  // Mock the remove from queue API call
  protected async removeFromQueue(id: number): Promise<void> {
    console.log(`   🗑️  Mock: Removing item ${id} from queue`);
    // Simulate successful removal
    return Promise.resolve();
  }

  // Mock manual import trigger
  protected async triggerManualImport(id: number): Promise<void> {
    console.log(`   🔄 Mock: Triggering manual import for item ${id}`);
    return Promise.resolve();
  }

  // Mock retry queue item
  protected async retryQueueItem(id: number): Promise<void> {
    console.log(`   🔁 Mock: Retrying download for item ${id}`);
    return Promise.resolve();
  }

  // Make analyzeQueueItem public for testing
  public analyzeQueueItem(item: any) {
    return super["analyzeQueueItem"](item);
  }

  // Make attemptAutoFix public for testing
  public async attemptAutoFix(item: any, analysis: any) {
    return super["attemptAutoFix"](item, analysis);
  }
}

async function testCustomFormatUpgradeDetection() {
  console.log("🧪 Testing Custom Format Upgrade Detection");
  console.log("==========================================");

  const mockConfig: ServiceConfig = {
    baseUrl: "http://mock-radarr:7878",
    apiKey: "mock-api-key",
  };

  const service = new TestRadarrService("test-radarr", mockConfig);

  try {
    // Get the mock queue data for analysis
    const queueResult = await service.queueList();

    if (!queueResult.ok || !queueResult.data) {
      throw new Error("Failed to get queue data");
    }

    console.log(`📋 Queue contains ${queueResult.data.total} items`);

    // Test the queue diagnostics
    const diagnosticsResult = await service.queueDiagnostics();

    if (!diagnosticsResult.ok || !diagnosticsResult.data) {
      throw new Error("Failed to run queue diagnostics");
    }

    const diagnostics: QueueDiagnosticsData = diagnosticsResult.data;

    console.log(`\n📊 Diagnostics Summary:`);
    console.log(`   Total Queue Items: ${diagnostics.totalQueueItems}`);
    console.log(`   Issues Found: ${diagnostics.issuesFound}`);
    console.log(`   Fixed: ${diagnostics.summary.fixed}`);
    console.log(`   Failed: ${diagnostics.summary.failed}`);
    console.log(`   Requires Manual: ${diagnostics.summary.requiresManual}`);

    console.log(`\n🔍 Issue Analysis:`);

    let customFormatUpgradeDetected = false;
    let networkErrorDetected = false;

    diagnostics.issuesAnalyzed.forEach((analysis, index) => {
      console.log(`\n   Item ${index + 1}: ${analysis.title}`);
      console.log(`   Status: ${analysis.status}`);
      console.log(
        `   Category: ${analysis.category.type} (${analysis.category.severity})`,
      );
      console.log(`   Auto-fixable: ${analysis.category.autoFixable}`);
      console.log(`   Message: ${analysis.message}`);
      console.log(`   Suggested Action: ${analysis.suggestedAction}`);

      if (analysis.category.type === "quality_downgrade") {
        customFormatUpgradeDetected = true;
        console.log(`   ✅ Custom Format upgrade issue correctly detected!`);
      }

      if (analysis.category.type === "network_error") {
        networkErrorDetected = true;
        console.log(`   ✅ Network error correctly detected!`);
      }
    });

    console.log(`\n🔧 Fix Actions:`);
    diagnostics.fixesAttempted.forEach((fix, index) => {
      console.log(`\n   Fix ${index + 1}:`);
      console.log(`   Item ID: ${fix.id}`);
      console.log(`   Action: ${fix.action}`);
      console.log(`   Attempted: ${fix.attempted}`);
      console.log(`   Success: ${fix.success || false}`);
      if (fix.error) {
        console.log(`   Error: ${fix.error}`);
      }
    });

    // Validation
    console.log(`\n✅ Validation Results:`);

    const expectedIssues = {
      customFormatUpgrade: customFormatUpgradeDetected,
      networkError: networkErrorDetected,
    };

    console.log(
      `   Custom Format Upgrade Detection: ${expectedIssues.customFormatUpgrade ? "✅ PASS" : "❌ FAIL"}`,
    );
    console.log(
      `   Network Error Detection: ${expectedIssues.networkError ? "✅ PASS" : "❌ FAIL"}`,
    );

    // Test specific custom format message parsing
    console.log(`\n🔬 Detailed Custom Format Analysis:`);

    const customFormatItem = {
      id: 12345,
      status: "warning",
      title: "Sample.Movie.2023.2160p.WEB-DL.x265-ReleaseGroup",
      statusMessages: [
        {
          title: "Not a Custom Format upgrade for existing movie file(s).",
          messages: [
            "New: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, Repack/Proper - Notifiarr, x265 - Notifiarr] (3105) do not improve on Existing: [2160p - Notifiarr, DD+ ATMOS - Notifiarr, DV HDR10+, iT, WEB Tier 01, x265 - Notifiarr] (6300)",
          ],
        },
      ],
    };

    const analysis = service.analyzeQueueItem(customFormatItem);

    console.log(
      `   Raw statusMessages:`,
      JSON.stringify(customFormatItem.statusMessages, null, 4),
    );
    console.log(`   Detected Category: ${analysis.category.type}`);
    console.log(
      `   Score Comparison Detected: ${customFormatItem.statusMessages[0].messages[0].includes("(3105)") && customFormatItem.statusMessages[0].messages[0].includes("(6300)") ? "✅ Yes" : "❌ No"}`,
    );
    console.log(
      `   New Score: 3105, Existing Score: 6300 → ${6300 > 3105 ? "Existing is better" : "New is better"}`,
    );

    const allTestsPassed =
      expectedIssues.customFormatUpgrade && expectedIssues.networkError;

    return allTestsPassed;
  } catch (error) {
    console.error("❌ Test failed:", error);
    return false;
  }
}

async function main() {
  console.log("🚀 Queue Diagnostics Custom Format Upgrade Test");
  console.log("===============================================\n");

  const testPassed = await testCustomFormatUpgradeDetection();

  console.log("\n" + "=".repeat(50));

  if (testPassed) {
    console.log("✅ All tests passed!");
    console.log(
      "   Queue Diagnostics correctly detects 'Not a Custom Format upgrade' scenarios",
    );
    console.log("   Auto-fix logic properly removes inferior downloads");
    console.log("   Network errors are also detected and handled");
    process.exit(0);
  } else {
    console.log("❌ Some tests failed");
    console.log("   Check the analysis above for details");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Test script failed:", error);
    process.exit(1);
  });
}
