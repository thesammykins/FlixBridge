#!/usr/bin/env tsx

/**
 * Test script to verify environment variable mapping configuration
 * This tests all three configuration methods to ensure they work correctly
 */

import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

// Mock the configuration loading functions from index.ts
interface ServiceConfig {
  baseUrl: string;
  apiKey: string;
}

interface SabnzbdConfig {
  baseUrl: string;
  apiKey: string;
  name?: string;
}

interface EnvVarMapping {
  services?: {
    sonarr?: {
      baseUrl?: string;
      apiKey?: string;
    };
    radarr?: {
      baseUrl?: string;
      apiKey?: string;
    };
  };
  downloaders?: {
    sabnzbd?: {
      baseUrl?: string;
      apiKey?: string;
      name?: string;
    };
  };
}

function loadEnvVarMapping(): EnvVarMapping | null {
  const mappingJson = process.env.FLIX_BRIDGE_ENV_MAPPING;
  if (!mappingJson) {
    return null;
  }

  try {
    return JSON.parse(mappingJson) as EnvVarMapping;
  } catch {
    console.error(
      "Failed to parse FLIX_BRIDGE_ENV_MAPPING, falling back to hardcoded env vars",
    );
    return null;
  }
}

function buildConfigFromEnvMapping(mapping: EnvVarMapping) {
  const services: Record<string, ServiceConfig> = {};
  const downloaders: Record<string, SabnzbdConfig> = {};

  // Map services from custom env vars
  if (mapping.services?.sonarr) {
    const sonarrBaseUrl = mapping.services.sonarr.baseUrl
      ? process.env[mapping.services.sonarr.baseUrl]
      : undefined;
    const sonarrApiKey = mapping.services.sonarr.apiKey
      ? process.env[mapping.services.sonarr.apiKey]
      : undefined;

    if (sonarrBaseUrl && sonarrApiKey) {
      services.sonarr = {
        baseUrl: sonarrBaseUrl,
        apiKey: sonarrApiKey,
      };
    }
  }

  if (mapping.services?.radarr) {
    const radarrBaseUrl = mapping.services.radarr.baseUrl
      ? process.env[mapping.services.radarr.baseUrl]
      : undefined;
    const radarrApiKey = mapping.services.radarr.apiKey
      ? process.env[mapping.services.radarr.apiKey]
      : undefined;

    if (radarrBaseUrl && radarrApiKey) {
      services.radarr = {
        baseUrl: radarrBaseUrl,
        apiKey: radarrApiKey,
      };
    }
  }

  // Map downloaders from custom env vars
  if (mapping.downloaders?.sabnzbd) {
    const sabnzbdBaseUrl = mapping.downloaders.sabnzbd.baseUrl
      ? process.env[mapping.downloaders.sabnzbd.baseUrl]
      : undefined;
    const sabnzbdApiKey = mapping.downloaders.sabnzbd.apiKey
      ? process.env[mapping.downloaders.sabnzbd.apiKey]
      : undefined;
    const sabnzbdName = mapping.downloaders.sabnzbd.name
      ? process.env[mapping.downloaders.sabnzbd.name]
      : undefined;

    if (sabnzbdBaseUrl && sabnzbdApiKey) {
      downloaders.sabnzbd = {
        baseUrl: sabnzbdBaseUrl,
        apiKey: sabnzbdApiKey,
        name: sabnzbdName || "SABnzbd",
      };
    }
  }

  if (Object.keys(services).length === 0) {
    throw new Error(
      "No services configured. Please check your env var mapping or set environment variables directly",
    );
  }

  const config: any = { services };
  if (Object.keys(downloaders).length > 0) {
    config.downloaders = downloaders;
  }
  return config;
}

function buildConfigFromHardcodedEnvVars() {
  const services: Record<string, ServiceConfig> = {};
  const downloaders: Record<string, SabnzbdConfig> = {};

  if (process.env.SONARR_URL && process.env.SONARR_API_KEY) {
    services.sonarr = {
      baseUrl: process.env.SONARR_URL,
      apiKey: process.env.SONARR_API_KEY,
    };
  }
  if (process.env.RADARR_URL && process.env.RADARR_API_KEY) {
    services.radarr = {
      baseUrl: process.env.RADARR_URL,
      apiKey: process.env.RADARR_API_KEY,
    };
  }
  if (process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY) {
    downloaders.sabnzbd = {
      baseUrl: process.env.SABNZBD_URL,
      apiKey: process.env.SABNZBD_API_KEY,
      name: "SABnzbd",
    };
  }

  if (Object.keys(services).length === 0) {
    throw new Error(
      "No services configured. Please set environment variables or create config.json",
    );
  }

  const config: any = { services };
  if (Object.keys(downloaders).length > 0) {
    config.downloaders = downloaders;
  }
  return config;
}

async function loadConfig() {
  const configPath = process.env.FLIX_BRIDGE_CONFIG || "config.json";

  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    // Try to load env var mapping configuration
    const envMapping = loadEnvVarMapping();
    if (envMapping) {
      return buildConfigFromEnvMapping(envMapping);
    }

    // Fall back to hardcoded env var names
    return buildConfigFromHardcodedEnvVars();
  }
}

// Test utilities
function clearEnv() {
  delete process.env.FLIX_BRIDGE_CONFIG;
  delete process.env.FLIX_BRIDGE_ENV_MAPPING;
  delete process.env.SONARR_URL;
  delete process.env.SONARR_API_KEY;
  delete process.env.RADARR_URL;
  delete process.env.RADARR_API_KEY;
  delete process.env.SABNZBD_URL;
  delete process.env.SABNZBD_API_KEY;
  delete process.env.MCP_SONARR_BASE_URL;
  delete process.env.MCP_SONARR_API_KEY;
  delete process.env.MCP_RADARR_BASE_URL;
  delete process.env.MCP_RADARR_API_KEY;
  delete process.env.CUSTOM_SONARR_URL;
  delete process.env.CUSTOM_SONARR_KEY;
  delete process.env.CUSTOM_SAB_URL;
  delete process.env.CUSTOM_SAB_KEY;
  delete process.env.CUSTOM_SAB_NAME;
  delete process.env.PARTIAL_SONARR_URL;
  delete process.env.PARTIAL_SONARR_KEY;
}

function setNonExistentConfigPath() {
  process.env.FLIX_BRIDGE_CONFIG = "non-existent-config.json";
}

function cleanupTestFiles() {
  const testFiles = ["test-config.json", "test-config-multi.json"];
  testFiles.forEach((file) => {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  });
}

// Test cases
async function testConfigFile() {
  console.log("🧪 Testing config file method...");

  const testConfig = {
    services: {
      sonarr: {
        baseUrl: "http://test-sonarr:8989",
        apiKey: "test-sonarr-key",
      },
      radarr: {
        baseUrl: "http://test-radarr:7878",
        apiKey: "test-radarr-key",
      },
    },
    downloaders: {
      sabnzbd: {
        baseUrl: "http://test-sabnzbd:8080",
        apiKey: "test-sabnzbd-key",
        name: "Test SABnzbd",
      },
    },
  };

  writeFileSync("test-config.json", JSON.stringify(testConfig, null, 2));
  process.env.FLIX_BRIDGE_CONFIG = "test-config.json";

  try {
    const config = await loadConfig();

    if (config.services.sonarr.baseUrl !== "http://test-sonarr:8989") {
      throw new Error("Config file: Sonarr baseUrl mismatch");
    }
    if (config.services.radarr.apiKey !== "test-radarr-key") {
      throw new Error("Config file: Radarr apiKey mismatch");
    }
    if (config.downloaders.sabnzbd.name !== "Test SABnzbd") {
      throw new Error("Config file: SABnzbd name mismatch");
    }

    console.log("✅ Config file method works correctly");
    return true;
  } catch (error) {
    console.log("❌ Config file method failed:", error.message);
    return false;
  }
}

async function testEnvMapping() {
  console.log("🧪 Testing custom env mapping method...");

  clearEnv();
  setNonExistentConfigPath();

  const mapping = {
    services: {
      sonarr: {
        baseUrl: "MCP_SONARR_BASE_URL",
        apiKey: "MCP_SONARR_API_KEY",
      },
      radarr: {
        baseUrl: "MCP_RADARR_BASE_URL",
        apiKey: "MCP_RADARR_API_KEY",
      },
    },
  };

  process.env.FLIX_BRIDGE_ENV_MAPPING = JSON.stringify(mapping);
  process.env.MCP_SONARR_BASE_URL = "http://mapped-sonarr:8989";
  process.env.MCP_SONARR_API_KEY = "mapped-sonarr-key";
  process.env.MCP_RADARR_BASE_URL = "http://mapped-radarr:7878";
  process.env.MCP_RADARR_API_KEY = "mapped-radarr-key";

  try {
    const config = await loadConfig();

    if (config.services.sonarr.baseUrl !== "http://mapped-sonarr:8989") {
      throw new Error("Env mapping: Sonarr baseUrl mismatch");
    }
    if (config.services.radarr.apiKey !== "mapped-radarr-key") {
      throw new Error("Env mapping: Radarr apiKey mismatch");
    }

    console.log("✅ Custom env mapping method works correctly");
    return true;
  } catch (error) {
    console.log("❌ Custom env mapping method failed:", error.message);
    return false;
  }
}

async function testHardcodedEnvVars() {
  console.log("🧪 Testing hardcoded env vars method...");

  clearEnv();
  setNonExistentConfigPath();

  process.env.SONARR_URL = "http://hardcoded-sonarr:8989";
  process.env.SONARR_API_KEY = "hardcoded-sonarr-key";
  process.env.RADARR_URL = "http://hardcoded-radarr:7878";
  process.env.RADARR_API_KEY = "hardcoded-radarr-key";
  process.env.SABNZBD_URL = "http://hardcoded-sabnzbd:8080";
  process.env.SABNZBD_API_KEY = "hardcoded-sabnzbd-key";

  try {
    const config = await loadConfig();

    if (config.services.sonarr.baseUrl !== "http://hardcoded-sonarr:8989") {
      throw new Error("Hardcoded env: Sonarr baseUrl mismatch");
    }
    if (config.services.radarr.apiKey !== "hardcoded-radarr-key") {
      throw new Error("Hardcoded env: Radarr apiKey mismatch");
    }
    if (
      config.downloaders.sabnzbd.baseUrl !== "http://hardcoded-sabnzbd:8080"
    ) {
      throw new Error("Hardcoded env: SABnzbd baseUrl mismatch");
    }

    console.log("✅ Hardcoded env vars method works correctly");
    return true;
  } catch (error) {
    console.log("❌ Hardcoded env vars method failed:", error.message);
    return false;
  }
}

async function testPriorityOrder() {
  console.log("🧪 Testing configuration priority order...");

  // Set up all three methods with different values
  const testConfig = {
    services: {
      sonarr: {
        baseUrl: "http://file-sonarr:8989",
        apiKey: "file-sonarr-key",
      },
    },
  };

  writeFileSync("test-config.json", JSON.stringify(testConfig, null, 2));
  process.env.FLIX_BRIDGE_CONFIG = "test-config.json";

  const mapping = {
    services: {
      sonarr: {
        baseUrl: "MCP_SONARR_BASE_URL",
        apiKey: "MCP_SONARR_API_KEY",
      },
    },
  };

  process.env.FLIX_BRIDGE_ENV_MAPPING = JSON.stringify(mapping);
  process.env.MCP_SONARR_BASE_URL = "http://mapped-sonarr:8989";
  process.env.MCP_SONARR_API_KEY = "mapped-sonarr-key";
  process.env.SONARR_URL = "http://hardcoded-sonarr:8989";
  process.env.SONARR_API_KEY = "hardcoded-sonarr-key";

  try {
    const config = await loadConfig();

    // Should use config file (highest priority)
    if (config.services.sonarr.baseUrl !== "http://file-sonarr:8989") {
      throw new Error(
        "Priority order: Config file should have highest priority",
      );
    }

    console.log("✅ Configuration priority order works correctly");
    return true;
  } catch (error) {
    console.log("❌ Configuration priority order failed:", error.message);
    return false;
  }
}

async function testCustomEnvVarNames() {
  console.log("🧪 Testing custom environment variable names...");

  clearEnv();
  setNonExistentConfigPath();

  const mapping = {
    services: {
      sonarr: {
        baseUrl: "CUSTOM_SONARR_URL",
        apiKey: "CUSTOM_SONARR_KEY",
      },
    },
    downloaders: {
      sabnzbd: {
        baseUrl: "CUSTOM_SAB_URL",
        apiKey: "CUSTOM_SAB_KEY",
        name: "CUSTOM_SAB_NAME",
      },
    },
  };

  process.env.FLIX_BRIDGE_ENV_MAPPING = JSON.stringify(mapping);
  process.env.CUSTOM_SONARR_URL = "http://custom-sonarr:8989";
  process.env.CUSTOM_SONARR_KEY = "custom-sonarr-key";
  process.env.CUSTOM_SAB_URL = "http://custom-sab:8080";
  process.env.CUSTOM_SAB_KEY = "custom-sab-key";
  process.env.CUSTOM_SAB_NAME = "Custom SABnzbd";

  try {
    const config = await loadConfig();

    if (config.services.sonarr.baseUrl !== "http://custom-sonarr:8989") {
      throw new Error("Custom env names: Sonarr baseUrl mismatch");
    }
    if (config.downloaders.sabnzbd.name !== "Custom SABnzbd") {
      throw new Error("Custom env names: SABnzbd name mismatch");
    }

    console.log("✅ Custom environment variable names work correctly");
    return true;
  } catch (error) {
    console.log("❌ Custom environment variable names failed:", error.message);
    return false;
  }
}

async function testInvalidMapping() {
  console.log("🧪 Testing invalid mapping handling...");

  clearEnv();
  setNonExistentConfigPath();

  // Set invalid JSON
  process.env.FLIX_BRIDGE_ENV_MAPPING = "invalid-json";
  process.env.SONARR_URL = "http://fallback-sonarr:8989";
  process.env.SONARR_API_KEY = "fallback-sonarr-key";

  try {
    const config = await loadConfig();

    // Should fall back to hardcoded env vars
    if (config.services.sonarr.baseUrl !== "http://fallback-sonarr:8989") {
      throw new Error(
        "Invalid mapping: Should fall back to hardcoded env vars",
      );
    }

    console.log("✅ Invalid mapping handling works correctly");
    return true;
  } catch (error) {
    console.log("❌ Invalid mapping handling failed:", error.message);
    return false;
  }
}

async function testPartialMapping() {
  console.log("🧪 Testing partial mapping (only some services)...");

  clearEnv();
  setNonExistentConfigPath();

  const mapping = {
    services: {
      sonarr: {
        baseUrl: "PARTIAL_SONARR_URL",
        apiKey: "PARTIAL_SONARR_KEY",
      },
      // No radarr mapping
    },
  };

  process.env.FLIX_BRIDGE_ENV_MAPPING = JSON.stringify(mapping);
  process.env.PARTIAL_SONARR_URL = "http://partial-sonarr:8989";
  process.env.PARTIAL_SONARR_KEY = "partial-sonarr-key";
  // Don't set radarr env vars

  try {
    const config = await loadConfig();

    if (config.services.sonarr.baseUrl !== "http://partial-sonarr:8989") {
      throw new Error("Partial mapping: Sonarr should be configured");
    }
    if (config.services.radarr) {
      throw new Error("Partial mapping: Radarr should not be configured");
    }

    console.log("✅ Partial mapping works correctly");
    return true;
  } catch (error) {
    console.log("❌ Partial mapping failed:", error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log("🚀 Starting environment variable mapping tests\n");

  const tests = [
    testConfigFile,
    testEnvMapping,
    testHardcodedEnvVars,
    testPriorityOrder,
    testCustomEnvVarNames,
    testInvalidMapping,
    testPartialMapping,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.log("❌ Test failed with exception:", error.message);
      failed++;
    }
    console.log();
  }

  // Cleanup
  clearEnv();
  cleanupTestFiles();

  console.log("📊 Test Results:");
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed === 0) {
    console.log(
      "\n🎉 All tests passed! Environment variable mapping is working correctly.",
    );
  } else {
    console.log(
      `\n😞 ${failed} test(s) failed. Please check the implementation.`,
    );
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error("💥 Test runner failed:", error);
    process.exit(1);
  });
}
