#!/usr/bin/env tsx

/**
 * Step-by-step trace of queueDiagnostics method to debug why detection isn't working
 */

import { serviceRegistry } from "../src/services/registry.js";
import type { ServiceConfig } from "../src/services/base.js";
import { fetchJson } from "../src/core.js";

async function loadConfig() {
  const configPath = process.env.ARR_MCP_CONFIG || "config.json";

  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("❌ Failed to load config:", error);
    process.exit(1);
  }
}

function traceAnalyzeQueueItem(item: any): any {
  console.log(`\n🔬 TRACE: Analyzing item ${item.id}`);
  console.log(`   Title: ${item.title}`);

  const status = item.status?.toLowerCase() || "";
  const statusMessages = item.statusMessages || [];
  const errorMessage = item.errorMessage || "";

  console.log(`   Status: "${status}"`);
  console.log(`   StatusMessages count: ${statusMessages.length}`);
  console.log(`   ErrorMessage: "${errorMessage}"`);

  if (statusMessages.length > 0) {
    console.log(`   StatusMessages details:`);
    statusMessages.forEach((msg: any, index: number) => {
      console.log(`     ${index + 1}. Title: "${msg.title || 'No title'}"`);
      if (msg.messages && msg.messages.length > 0) {
        msg.messages.forEach((submsg: string, subIndex: number) => {
          console.log(`        Message ${subIndex + 1}: "${submsg}"`);
        });
      }
    });
  }

  // Build allMessages exactly as the code does
  const allMessages = [
    status,
    ...statusMessages.map((m: any) => m.title || m.message || ""),
    ...statusMessages.flatMap((m: any) => m.messages || []),
    errorMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  console.log(`   Combined allMessages: "${allMessages}"`);

  // Test each condition
  console.log(`   Condition checks:`);

  // TheXEM mapping issues
  const hasThexemMapping = allMessages.includes("thexem") && allMessages.includes("mapping");
  console.log(`     TheXEM mapping: ${hasThexemMapping}`);

  if (hasThexemMapping) {
    const result = {
      id: item.id,
      title: item.title,
      status: item.status,
      category: { type: "mapping", severity: "warning", autoFixable: true },
      message: "TheXEM mapping issue detected",
      suggestedAction: "Trigger manual import to bypass mapping requirements",
    };
    console.log(`   ✅ MATCHED: TheXEM mapping`);
    return result;
  }

  // Quality downgrade issues
  const hasCustomFormatUpgrade = allMessages.includes("not a custom format upgrade");
  const hasDoNotImprove = allMessages.includes("do not improve on existing");
  console.log(`     "not a custom format upgrade": ${hasCustomFormatUpgrade}`);
  console.log(`     "do not improve on existing": ${hasDoNotImprove}`);

  if (hasCustomFormatUpgrade || hasDoNotImprove) {
    const result = {
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
    console.log(`   ✅ MATCHED: Quality downgrade`);
    return result;
  }

  // Network/connection errors
  const hasTimeout = allMessages.includes("timeout");
  const hasConnection = allMessages.includes("connection");
  const hasNetwork = allMessages.includes("network");
  const hasDns = allMessages.includes("dns");
  console.log(`     timeout: ${hasTimeout}`);
  console.log(`     connection: ${hasConnection}`);
  console.log(`     network: ${hasNetwork}`);
  console.log(`     dns: ${hasDns}`);

  if (hasTimeout || hasConnection || hasNetwork || hasDns) {
    const result = {
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
    console.log(`   ✅ MATCHED: Network error`);
    return result;
  }

  // Disk space issues
  const hasDisk = allMessages.includes("disk");
  const hasSpace = allMessages.includes("space");
  const hasFull = allMessages.includes("full");
  console.log(`     disk: ${hasDisk}`);
  console.log(`     space: ${hasSpace}`);
  console.log(`     full: ${hasFull}`);

  if (hasDisk && (hasSpace || hasFull)) {
    const result = {
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
    console.log(`   ✅ MATCHED: Disk space`);
    return result;
  }

  // Permission issues
  const hasPermission = allMessages.includes("permission");
  const hasAccessDenied = allMessages.includes("access denied");
  console.log(`     permission: ${hasPermission}`);
  console.log(`     access denied: ${hasAccessDenied}`);

  if (hasPermission || hasAccessDenied) {
    const result = {
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
    console.log(`   ✅ MATCHED: Permissions`);
    return result;
  }

  // Check if item appears stuck
  const statusIncludesWarning = status.includes("warning");
  const statusIncludesError = status.includes("error");
  const hasStatusMessages = statusMessages.length > 0;

  console.log(`     status includes "warning": ${statusIncludesWarning}`);
  console.log(`     status includes "error": ${statusIncludesError}`);
  console.log(`     has status messages: ${hasStatusMessages}`);

  const isStuck = statusIncludesWarning || statusIncludesError || hasStatusMessages;
  console.log(`     isStuck: ${isStuck}`);

  if (isStuck) {
    const result = {
      id: item.id,
      title: item.title,
      status: item.status,
      category: { type: "unknown", severity: "warning", autoFixable: false },
      message: "Item appears stuck with unrecognized issue",
      suggestedAction: "Manual investigation required",
    };
    console.log(`   ✅ MATCHED: Stuck (unknown issue)`);
    return result;
  }

  // No issues detected
  const result = {
    id: item.id,
    title: item.title,
    status: item.status,
    category: { type: "unknown", severity: "info", autoFixable: false },
    message: "No issues detected",
    suggestedAction: "No action needed",
  };
  console.log(`   ❌ NO MATCH: No issues detected`);
  return result;
}

async function traceQueueDiagnostics() {
  console.log("🚀 TRACE: Queue Diagnostics Step-by-Step");
  console.log("========================================\n");

  // Load configuration
  const config = await loadConfig();

  // Initialize services
  serviceRegistry.clear();

  if (config.services) {
    for (const [name, serviceConfig] of Object.entries(config.services)) {
      try {
        serviceRegistry.register(name, serviceConfig as ServiceConfig);
        console.log(`✅ Registered service: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to register service ${name}:`, error);
      }
    }
  }

  const serviceName = "radarr-uhd";
  const service = serviceRegistry.get(serviceName);

  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    return;
  }

  try {
    console.log(`\n🔍 TRACE: Fetching queue data for ${serviceName}`);

    // Get the service internals
    const baseUrl = (service as any).baseUrl;
    const apiKey = (service as any).apiKey;

    console.log(`   Base URL: ${baseUrl}`);
    console.log(`   API Key: ${apiKey ? '***' : 'Missing'}`);

    // Build the queue API URL
    const queueUrl = `${baseUrl}/api/v3/queue`;
    console.log(`   Queue URL: ${queueUrl}`);

    // Fetch raw queue data
    const queueResponse = await fetchJson(queueUrl, {
      headers: {
        'X-Api-Key': apiKey
      }
    });

    console.log(`   Raw response keys: ${Object.keys(queueResponse).join(", ")}`);
    console.log(`   Total records: ${queueResponse.totalRecords || 'Unknown'}`);
    console.log(`   Records array length: ${queueResponse.records?.length || 0}`);

    const allItems = queueResponse.records || [];
    console.log(`\n📋 TRACE: Processing ${allItems.length} queue items`);

    if (allItems.length === 0) {
      console.log("   ℹ️  No items in queue");
      return;
    }

    // Analyze each item
    const issuesAnalyzed = [];
    const fixesAttempted = [];

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      console.log(`\n📝 TRACE: Processing item ${i + 1}/${allItems.length}`);

      const analysis = traceAnalyzeQueueItem(item);

      // Check filtering logic
      const isRealIssue = !(
        analysis.category.type === "unknown" &&
        analysis.category.severity === "info"
      );

      console.log(`   Filtering result: isRealIssue = ${isRealIssue}`);
      console.log(`     Category type: ${analysis.category.type}`);
      console.log(`     Severity: ${analysis.category.severity}`);
      console.log(`     Auto-fixable: ${analysis.category.autoFixable}`);

      if (isRealIssue) {
        issuesAnalyzed.push(analysis);
        console.log(`   ✅ INCLUDED in issues analyzed`);

        if (analysis.category.autoFixable) {
          console.log(`   🔧 AUTO-FIX would be attempted`);
          // We won't actually attempt fixes in this trace
          fixesAttempted.push({
            id: item.id,
            action: "remove_from_queue",
            attempted: false,
            success: false,
            reason: "Trace mode - not actually executing"
          });
        } else {
          console.log(`   ⚠️  Requires manual intervention`);
        }
      } else {
        console.log(`   ❌ FILTERED OUT`);
      }
    }

    console.log(`\n📊 TRACE: Final Results`);
    console.log(`   Total Queue Items: ${allItems.length}`);
    console.log(`   Issues Found: ${issuesAnalyzed.length}`);
    console.log(`   Fixes That Would Be Attempted: ${fixesAttempted.length}`);

    if (issuesAnalyzed.length > 0) {
      console.log(`\n✅ SUCCESS: Issues were detected!`);
      issuesAnalyzed.forEach((issue, index) => {
        console.log(`   Issue ${index + 1}: ${issue.category.type} (${issue.category.severity})`);
      });
    } else {
      console.log(`\n❌ PROBLEM: No issues detected when there should be`);
    }

  } catch (error) {
    console.error("❌ TRACE failed:", error);
    if (error instanceof Error) {
      console.error("   Stack:", error.stack);
    }
  }
}

async function main() {
  await traceQueueDiagnostics();
  console.log("\n" + "=".repeat(50));
  console.log("🎯 Trace completed!");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Trace script failed:", error);
    process.exit(1);
  });
}
