#!/usr/bin/env tsx

/**
 * Debug script to examine actual queue data from radarr-uhd service
 * This helps identify why Queue Diagnostics isn't detecting custom format upgrade issues
 */

import { serviceRegistry } from "../src/services/registry.js";
import type { ServiceConfig } from "../src/services/base.js";

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

async function debugQueueData(serviceName: string) {
  console.log(`🔍 Debugging queue data for service: ${serviceName}`);
  console.log("=" + "=".repeat(50));

  const service = serviceRegistry.get(serviceName);
  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    console.log(
      `Available services: ${serviceRegistry.getAllNames().join(", ")}`,
    );
    return;
  }

  try {
    // Get raw queue data
    console.log("\n📋 Fetching queue data...");
    const queueResult = await service.queueList();

    if (!queueResult.ok) {
      console.error("❌ Failed to get queue data:", queueResult.error);
      return;
    }

    const queueData = queueResult.data;
    console.log(`✅ Found ${queueData?.total || 0} items in queue`);

    if (!queueData?.items || queueData.items.length === 0) {
      console.log("ℹ️  Queue is empty, nothing to debug");
      return;
    }

    // Now get raw queue details to see full statusMessages
    console.log("\n🔬 Examining queue items for status messages...");

    // We need to call the raw API to see the full statusMessages structure
    const baseUrl = (service as any).baseUrl;
    const apiKey = (service as any).apiKey;

    if (!baseUrl || !apiKey) {
      console.error("❌ Could not extract base URL or API key from service");
      return;
    }

    const { fetchJson } = await import("../src/core.js");
    const queueUrl = `${baseUrl}/api/v3/queue?page=1&pageSize=50`;

    console.log(`🌐 Calling: ${queueUrl.replace(apiKey, "***")}`);

    const rawQueueData = await fetchJson(queueUrl, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    console.log(`\n📊 Raw queue response structure:`);
    console.log(`   Records found: ${rawQueueData.records?.length || 0}`);

    if (rawQueueData.records && rawQueueData.records.length > 0) {
      rawQueueData.records.forEach((item: any, index: number) => {
        console.log(`\n🎬 Item ${index + 1}: ${item.title || "Unknown Title"}`);
        console.log(`   ID: ${item.id}`);
        console.log(`   Status: ${item.status}`);
        console.log(
          `   TrackedDownloadStatus: ${item.trackedDownloadStatus || "N/A"}`,
        );

        if (item.errorMessage) {
          console.log(`   ErrorMessage: ${item.errorMessage}`);
        }

        if (item.statusMessages && item.statusMessages.length > 0) {
          console.log(`   StatusMessages (${item.statusMessages.length}):`);
          item.statusMessages.forEach((msg: any, msgIndex: number) => {
            console.log(
              `     ${msgIndex + 1}. Title: "${msg.title || "No title"}"`,
            );
            if (msg.messages && msg.messages.length > 0) {
              msg.messages.forEach((submsg: string, subIndex: number) => {
                console.log(`        Message ${subIndex + 1}: "${submsg}"`);
              });
            }
          });

          // Check for custom format upgrade patterns
          const allMessages = [
            item.status?.toLowerCase() || "",
            ...item.statusMessages.map((m: any) =>
              (m.title || "").toLowerCase(),
            ),
            ...item.statusMessages.flatMap((m: any) =>
              (m.messages || []).map((msg: string) => msg.toLowerCase()),
            ),
            item.errorMessage?.toLowerCase() || "",
          ]
            .filter(Boolean)
            .join(" ");

          const hasCustomFormatUpgrade =
            allMessages.includes("not a custom format upgrade") ||
            allMessages.includes("do not improve on existing") ||
            allMessages.includes("custom format") ||
            allMessages.includes("upgrade");

          const hasDowngrade = allMessages.includes("downgrade");

          console.log(`   🔍 Detection Analysis:`);
          console.log(`      All messages combined: "${allMessages}"`);
          console.log(
            `      Contains "custom format": ${allMessages.includes("custom format")}`,
          );
          console.log(
            `      Contains "upgrade": ${allMessages.includes("upgrade")}`,
          );
          console.log(
            `      Contains "not a custom format upgrade": ${allMessages.includes("not a custom format upgrade")}`,
          );
          console.log(
            `      Contains "do not improve": ${allMessages.includes("do not improve")}`,
          );
          console.log(`      Contains "downgrade": ${hasDowngrade}`);
          console.log(
            `      Should be detected: ${hasCustomFormatUpgrade ? "✅ YES" : "❌ NO"}`,
          );

          // Test our actual analysis function on this item
          console.log(`   🧪 Testing actual analyzeQueueItem function:`);
          try {
            const testService = serviceRegistry.get("radarr-uhd");
            if (testService && (testService as any).analyzeQueueItem) {
              const analysis = (testService as any).analyzeQueueItem(item);
              console.log(
                `      Analysis result: ${JSON.stringify(analysis, null, 8)}`,
              );
            } else {
              console.log(`      ❌ Could not access analyzeQueueItem method`);
            }
          } catch (error) {
            console.log(`      ❌ Analysis test failed: ${error}`);
          }
        } else {
          console.log(`   StatusMessages: None`);
        }

        console.log(`   Raw item keys: ${Object.keys(item).join(", ")}`);
      });
    }

    // Now run our queue diagnostics to see what it detects
    console.log("\n🧪 Running Queue Diagnostics...");
    const diagnosticsResult = await service.queueDiagnostics();

    if (diagnosticsResult.ok && diagnosticsResult.data) {
      const diagnostics = diagnosticsResult.data;
      console.log(`\n📊 Diagnostics Results:`);
      console.log(`   Total Queue Items: ${diagnostics.totalQueueItems}`);
      console.log(`   Issues Found: ${diagnostics.issuesFound}`);
      console.log(`   Issues Analyzed: ${diagnostics.issuesAnalyzed.length}`);
      console.log(`   Fixes Attempted: ${diagnostics.fixesAttempted.length}`);

      if (diagnostics.issuesAnalyzed.length > 0) {
        console.log(`\n🔍 Issue Analysis Details:`);
        diagnostics.issuesAnalyzed.forEach((analysis: any, index: number) => {
          console.log(`\n   Analysis ${index + 1}:`);
          console.log(`     Item ID: ${analysis.id}`);
          console.log(`     Title: ${analysis.title}`);
          console.log(`     Status: ${analysis.status}`);
          console.log(`     Category Type: ${analysis.category.type}`);
          console.log(`     Severity: ${analysis.category.severity}`);
          console.log(`     Auto-fixable: ${analysis.category.autoFixable}`);
          console.log(`     Message: ${analysis.message}`);
          console.log(`     Suggested Action: ${analysis.suggestedAction}`);
        });
      }

      if (diagnostics.fixesAttempted.length > 0) {
        console.log(`\n🔧 Fix Actions:`);
        diagnostics.fixesAttempted.forEach((fix: any, index: number) => {
          console.log(`\n   Fix ${index + 1}:`);
          console.log(`     Item ID: ${fix.id}`);
          console.log(`     Action: ${fix.action}`);
          console.log(`     Attempted: ${fix.attempted}`);
          console.log(`     Success: ${fix.success || false}`);
          if (fix.error) {
            console.log(`     Error: ${fix.error}`);
          }
        });
      }
    } else {
      console.error("❌ Queue diagnostics failed:", diagnosticsResult.error);
    }
  } catch (error) {
    console.error("❌ Debug failed:", error);
    if (error instanceof Error) {
      console.error("   Stack:", error.stack);
    }
  }
}

async function main() {
  console.log("🚀 Queue Data Debug Tool");
  console.log("========================\n");

  const serviceName = process.argv[2] || "radarr-uhd";

  console.log(`Target service: ${serviceName}`);
  console.log(`Config file: ${process.env.ARR_MCP_CONFIG || "config.json"}`);

  // Load configuration
  const config = await loadConfig();

  // Initialize services
  serviceRegistry.clear();

  if (config.services) {
    for (const [name, serviceConfig] of Object.entries(config.services)) {
      try {
        serviceRegistry.register(name, serviceConfig as ServiceConfig);
      } catch (error) {
        console.error(`❌ Failed to register service ${name}:`, error);
      }
    }
  }

  const availableServices = serviceRegistry.getAllNames();
  console.log(`Available services: ${availableServices.join(", ")}\n`);

  if (!availableServices.includes(serviceName)) {
    console.error(`❌ Service '${serviceName}' not found in configuration`);
    console.log(`Usage: npx tsx scripts/debug-queue.ts [service-name]`);
    console.log(`Available services: ${availableServices.join(", ")}`);
    process.exit(1);
  }

  await debugQueueData(serviceName);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Debug script failed:", error);
    process.exit(1);
  });
}
