#!/usr/bin/env tsx

/**
 * Test script for slug-based environment configuration
 * This script tests the new slug-based environment discovery system
 */

import { loadConfigFromEnvOnly } from "../src/config.js";

// Test data - mock environment variables
const testCases = [
  {
    name: "Multi-instance slug-based configuration",
    env: {
      SONARR_MAIN_URL: "http://sonarr-main:8989",
      SONARR_MAIN_API_KEY: "sonarr-main-key",
      SONARR_4K_URL: "http://sonarr-4k:8989",
      SONARR_4K_API_KEY: "sonarr-4k-key",
      SONARR_ANIME_URL: "http://sonarr-anime:8989",
      SONARR_ANIME_API_KEY: "sonarr-anime-key",
      SONARR_ANIME_NAME: "sonarr-anime-special",
      RADARR_MAIN_URL: "http://radarr-main:7878",
      RADARR_MAIN_API_KEY: "radarr-main-key",
      RADARR_UHD_URL: "http://radarr-uhd:7878",
      RADARR_UHD_API_KEY: "radarr-uhd-key",
      SABNZBD_MAIN_URL: "http://sab-main:8080",
      SABNZBD_MAIN_API_KEY: "sab-main-key",
      SABNZBD_4K_URL: "http://sab-4k:8080",
      SABNZBD_4K_API_KEY: "sab-4k-key",
    },
    expectedServices: [
      "sonarr-main",
      "sonarr-4k",
      "sonarr-anime-special",
      "radarr-main",
      "radarr-uhd"
    ],
    expectedDownloaders: [
      "sabnzbd-main",
      "sabnzbd-4k"
    ]
  },
  {
    name: "Prefixed FlixBridge configuration",
    env: {
      FLIX_BRIDGE_SONARR_HD_URL: "http://sonarr-hd:8989",
      FLIX_BRIDGE_SONARR_HD_KEY: "sonarr-hd-key",
      FLIX_BRIDGE_RADARR_UHD_URL: "http://radarr-uhd:7878",
      FLIX_BRIDGE_RADARR_UHD_KEY: "radarr-uhd-key",
      FLIX_BRIDGE_SABNZBD_MAIN_URL: "http://sab-main:8080",
      FLIX_BRIDGE_SABNZBD_MAIN_KEY: "sab-main-key",
    },
    expectedServices: [
      "sonarr-hd",
      "radarr-uhd"
    ],
    expectedDownloaders: [
      "sabnzbd-main"
    ]
  },
  {
    name: "Slug services with fallback downloader",
    env: {
      FLIX_BRIDGE_SONARR_HD_URL: "http://sonarr-hd:8989",
      FLIX_BRIDGE_SONARR_HD_KEY: "sonarr-hd-key",
      FLIX_BRIDGE_RADARR_HD_URL: "http://radarr-hd:7878",
      FLIX_BRIDGE_RADARR_HD_KEY: "radarr-hd-key",
      FLIX_BRIDGE_SABNZBD_URL: "http://sab-main:8080",
      FLIX_BRIDGE_SABNZBD_KEY: "sab-main-key",
    },
    expectedServices: [
      "sonarr-hd",
      "radarr-hd"
    ],
    expectedDownloaders: [
      "sabnzbd"
    ]
  },
  {
    name: "Single instance fallback configuration",
    env: {
      SONARR_URL: "http://localhost:8989",
      SONARR_API_KEY: "sonarr-key",
      RADARR_URL: "http://localhost:7878",
      RADARR_API_KEY: "radarr-key",
      SABNZBD_URL: "http://localhost:8080",
      SABNZBD_API_KEY: "sabnzbd-key"
    },
    expectedServices: [
      "sonarr",
      "radarr"
    ],
    expectedDownloaders: [
      "sabnzbd"
    ]
  },
  {
    name: "Prefixed single instance fallback configuration",
    env: {
      FLIX_BRIDGE_SONARR_URL: "http://localhost:8989",
      FLIX_BRIDGE_SONARR_KEY: "sonarr-key",
      FLIX_BRIDGE_RADARR_URL: "http://localhost:7878",
      FLIX_BRIDGE_RADARR_KEY: "radarr-key",
      FLIX_BRIDGE_SABNZBD_URL: "http://localhost:8080",
      FLIX_BRIDGE_SABNZBD_KEY: "sabnzbd-key",
      FLIX_BRIDGE_SABNZBD_NAME: "SABnzbd Main"
    },
    expectedServices: [
      "sonarr",
      "radarr"
    ],
    expectedDownloaders: [
      "sabnzbd"
    ]
  },
  {
    name: "Mixed valid and incomplete slugs",
    env: {
      SONARR_MAIN_URL: "http://sonarr-main:8989",
      SONARR_MAIN_API_KEY: "sonarr-main-key",
      SONARR_INCOMPLETE_URL: "http://sonarr-incomplete:8989",
      // Missing SONARR_INCOMPLETE_API_KEY
      RADARR_VALID_URL: "http://radarr-valid:7878",
      RADARR_VALID_API_KEY: "radarr-valid-key",
      RADARR_ALSO_INCOMPLETE_API_KEY: "some-key",
      // Missing RADARR_ALSO_INCOMPLETE_URL
    },
    expectedServices: [
      "sonarr-main",
      "radarr-valid"
    ],
    expectedDownloaders: []
  },
  {
    name: "URL normalization test",
    env: {
      SONARR_TEST_URL: "http://localhost:8989/",
      SONARR_TEST_API_KEY: "test-key",
    },
    expectedServices: [
      "sonarr-test"
    ],
    expectedDownloaders: []
  },
  {
    name: "No configuration",
    env: {},
    shouldFail: true
  }
];

function mockEnv(env: Record<string, string>) {
  // Clear existing relevant env vars
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SONARR_') || key.startsWith('RADARR_') || key.startsWith('SABNZBD_') || key.startsWith('FLIX_BRIDGE_SONARR_') || key.startsWith('FLIX_BRIDGE_RADARR_') || key.startsWith('FLIX_BRIDGE_SABNZBD_')) {
      delete process.env[key];
    }
  }

  // Set test env vars
  Object.assign(process.env, env);
}

function restoreEnv() {
  // Clear test env vars
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SONARR_') || key.startsWith('RADARR_') || key.startsWith('SABNZBD_') || key.startsWith('FLIX_BRIDGE_SONARR_') || key.startsWith('FLIX_BRIDGE_RADARR_') || key.startsWith('FLIX_BRIDGE_SABNZBD_')) {
      delete process.env[key];
    }
  }
}

async function runTest(testCase: typeof testCases[0]) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log("=" + "=".repeat(testCase.name.length + 10));

  try {
    // Mock environment
    mockEnv(testCase.env);

    // Enable debug for testing
    process.env.FLIX_BRIDGE_DEBUG = "1";

    if (testCase.shouldFail) {
      try {
        await loadConfigFromEnvOnly();
        console.log("❌ Expected test to fail but it succeeded");
        return false;
      } catch (error) {
        console.log("✅ Test correctly failed with expected error");
        console.log(`   Error: ${error instanceof Error ? error.message : error}`);
        return true;
      }
    }

    const config = await loadConfigFromEnvOnly();

    // Validate services
    const actualServices = Object.keys(config.services).sort();
    const expectedServices = testCase.expectedServices?.sort() || [];

    console.log(`📋 Expected services: [${expectedServices.join(", ")}]`);
    console.log(`📋 Actual services:   [${actualServices.join(", ")}]`);

    if (JSON.stringify(actualServices) !== JSON.stringify(expectedServices)) {
      console.log("❌ Service names mismatch");
      return false;
    }

    // Validate downloaders
    const actualDownloaders = Object.keys(config.downloaders || {}).sort();
    const expectedDownloaders = testCase.expectedDownloaders?.sort() || [];

    console.log(`📥 Expected downloaders: [${expectedDownloaders.join(", ")}]`);
    console.log(`📥 Actual downloaders:   [${actualDownloaders.join(", ")}]`);

    if (JSON.stringify(actualDownloaders) !== JSON.stringify(expectedDownloaders)) {
      console.log("❌ Downloader names mismatch");
      return false;
    }

    // Validate service configurations
    for (const [serviceName, serviceConfig] of Object.entries(config.services)) {
      if (!serviceConfig.baseUrl || !serviceConfig.apiKey) {
        console.log(`❌ Service ${serviceName} missing baseUrl or apiKey`);
        return false;
      }

      // Check URL normalization
      if (serviceConfig.baseUrl.endsWith('/')) {
        console.log(`❌ Service ${serviceName} URL not normalized (ends with /)`);
        return false;
      }
    }

    // Validate downloader configurations
    for (const [downloaderName, downloaderConfig] of Object.entries(config.downloaders || {})) {
      if (!downloaderConfig.baseUrl || !downloaderConfig.apiKey) {
        console.log(`❌ Downloader ${downloaderName} missing baseUrl or apiKey`);
        return false;
      }

      if (!downloaderConfig.name) {
        console.log(`❌ Downloader ${downloaderName} missing name`);
        return false;
      }
    }

    console.log("✅ All validations passed");
    return true;

  } catch (error) {
    console.log("❌ Test failed with error:");
    console.log(`   ${error instanceof Error ? error.message : error}`);
    return false;
  } finally {
    restoreEnv();
  }
}

async function main() {
  console.log("🚀 FlixBridge Slug-Based Configuration Test Suite");
  console.log("================================================");

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const success = await runTest(testCase);
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Results Summary");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log("\n🎉 All tests passed! Slug-based configuration is working correctly.");
    process.exit(0);
  } else {
    console.log(`\n💥 ${failed} test(s) failed. Please check the implementation.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Test suite failed to run:", error);
    process.exit(1);
  });
}
