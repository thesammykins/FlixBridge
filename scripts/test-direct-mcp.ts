#!/usr/bin/env tsx

/**
 * Direct test of MCP server tools to validate Queue Diagnostics functionality
 * This bypasses any service registry issues and tests the actual tool implementation
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

async function testQueueDiagnosticsTool() {
  console.log("🧪 Testing Queue Diagnostics Tool Directly");
  console.log("==========================================\n");

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

  console.log(`\nAvailable services: ${serviceRegistry.getAllNames().join(", ")}\n`);

  // Test the Queue Diagnostics tool directly
  const serviceName = "radarr-uhd";
  const service = serviceRegistry.get(serviceName);

  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    return;
  }

  console.log(`🔍 Testing Queue Diagnostics on: ${serviceName}`);

  try {
    // Call the queue diagnostics method directly
    const result = await service.queueDiagnostics();

    console.log("\n📊 Queue Diagnostics Result:");
    console.log(`   OK: ${result.ok}`);

    if (result.ok && result.data) {
      const data = result.data;
      console.log(`   Service: ${data.service}`);
      console.log(`   Media Kind: ${data.mediaKind}`);
      console.log(`   Total Queue Items: ${data.totalQueueItems}`);
      console.log(`   Issues Found: ${data.issuesFound}`);
      console.log(`   Issues Analyzed: ${data.issuesAnalyzed.length}`);
      console.log(`   Fixes Attempted: ${data.fixesAttempted.length}`);

      if (data.issuesAnalyzed.length > 0) {
        console.log("\n🔍 Issues Analyzed:");
        data.issuesAnalyzed.forEach((issue, index) => {
          console.log(`\n   Issue ${index + 1}:`);
          console.log(`     ID: ${issue.id}`);
          console.log(`     Title: ${issue.title}`);
          console.log(`     Status: ${issue.status}`);
          console.log(`     Category: ${issue.category.type} (${issue.category.severity})`);
          console.log(`     Auto-fixable: ${issue.category.autoFixable}`);
          console.log(`     Message: ${issue.message}`);
          console.log(`     Suggested Action: ${issue.suggestedAction}`);
        });
      } else {
        console.log("\n⚠️  No issues were analyzed - this indicates a problem");
      }

      if (data.fixesAttempted.length > 0) {
        console.log("\n🔧 Fixes Attempted:");
        data.fixesAttempted.forEach((fix, index) => {
          console.log(`\n   Fix ${index + 1}:`);
          console.log(`     ID: ${fix.id}`);
          console.log(`     Action: ${fix.action}`);
          console.log(`     Attempted: ${fix.attempted}`);
          console.log(`     Success: ${fix.success}`);
          if (fix.error) {
            console.log(`     Error: ${fix.error}`);
          }
        });
      }

      console.log("\n📈 Summary:");
      console.log(`   Fixed: ${data.summary.fixed}`);
      console.log(`   Failed: ${data.summary.failed}`);
      console.log(`   Requires Manual: ${data.summary.requiresManual}`);

      // Validate expected behavior
      if (data.totalQueueItems > 0 && data.issuesFound === 0) {
        console.log("\n❌ ISSUE DETECTED:");
        console.log("   Queue has items but no issues found");
        console.log("   This suggests the detection logic isn't working");
      } else if (data.issuesFound > 0 && data.fixesAttempted.length === 0) {
        console.log("\n❌ ISSUE DETECTED:");
        console.log("   Issues found but no fixes attempted");
        console.log("   This suggests the auto-fix logic isn't working");
      } else if (data.issuesFound > 0 && data.fixesAttempted.length > 0) {
        console.log("\n✅ SUCCESS:");
        console.log("   Issues found and fixes attempted");
        console.log("   Queue Diagnostics is working correctly");
      }

    } else if (result.error) {
      console.error("❌ Queue Diagnostics failed:", result.error);
    } else {
      console.error("❌ Unexpected result structure");
    }

  } catch (error) {
    console.error("❌ Test failed:", error);
    if (error instanceof Error) {
      console.error("   Stack:", error.stack);
    }
  }
}

async function testSystemStatus() {
  console.log("\n🔍 Testing System Status (baseline test)");
  console.log("========================================");

  const serviceName = "radarr-uhd";
  const service = serviceRegistry.get(serviceName);

  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    return;
  }

  try {
    const result = await service.systemStatus();
    console.log(`   System Status OK: ${result.ok}`);
    if (result.ok && result.data) {
      console.log(`   Service Name: ${result.data.service}`);
      console.log(`   Version: ${result.data.version}`);
      console.log(`   Healthy: ${result.data.isHealthy}`);
    }
  } catch (error) {
    console.error("❌ System Status test failed:", error);
  }
}

async function testQueueList() {
  console.log("\n🔍 Testing Queue List (baseline test)");
  console.log("====================================");

  const serviceName = "radarr-uhd";
  const service = serviceRegistry.get(serviceName);

  if (!service) {
    console.error(`❌ Service '${serviceName}' not found`);
    return;
  }

  try {
    const result = await service.queueList();
    console.log(`   Queue List OK: ${result.ok}`);
    if (result.ok && result.data) {
      console.log(`   Total Items: ${result.data.total}`);
      console.log(`   Items Returned: ${result.data.items.length}`);
      result.data.items.forEach((item, index) => {
        console.log(`   Item ${index + 1}: ${item.title} (${item.status})`);
      });
    }
  } catch (error) {
    console.error("❌ Queue List test failed:", error);
  }
}

async function main() {
  console.log("🚀 Direct MCP Tool Test");
  console.log("=======================\n");

  await testSystemStatus();
  await testQueueList();
  await testQueueDiagnosticsTool();

  console.log("\n" + "=".repeat(50));
  console.log("🎯 Test completed!");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Test script failed:", error);
    process.exit(1);
  });
}
