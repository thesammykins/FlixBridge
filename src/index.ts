#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { serviceRegistry } from "./services/registry.js";
import type { ServiceConfig } from "./services/base.js";
import type { SabnzbdConfig } from "./services/downloaders/sabnzbd.js";
import { debugToolTiming } from "./debug.js";
import { metricsCollector } from "./metrics.js";

const tools = [
  {
    name: "system_status",
    description: "Get system status and health information",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
  },
  {
    name: "queue_list",
    description: "List items in download queue with status and progress",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
      required: ["service"],
    },
  },
  {
    name: "queue_grab",
    description: "Force grab/retry download of queued items",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        ids: { type: "array", items: { type: "number" } },
      },
      required: ["service", "ids"],
    },
  },
  {
    name: "root_folders",
    description: "List configured root folders and storage information",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
  },
  {
    name: "history_detail",
    description: "Get download/import history details",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        page: { type: "number" },
        pageSize: { type: "number" },
        since: { type: "string" },
      },
      required: ["service"],
    },
  },
  {
    name: "search",
    description: "Search for media (series/movies) to add",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["service", "query"],
    },
  },
  {
    name: "add_new",
    description: "Add new media to library",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        title: { type: "string" },
        foreignId: { type: "number" },
        rootFolderPath: { type: "string" },
        qualityProfileId: { type: "number" },
        monitored: { type: "boolean" },
      },
      required: ["service", "title", "foreignId"],
    },
  },
  {
    name: "import_issues",
    description: "Check for import issues and stuck downloads",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
  },
  {
    name: "quality_profiles",
    description: "List available quality profiles with recommendations",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
  },
  {
    name: "queue_diagnostics",
    description: "Analyze and auto-fix stuck queue items",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        autoFix: { type: "boolean" },
      },
      required: ["service"],
    },
  },
  {
    name: "all_services_diagnostics",
    description: "Analyze and auto-fix stuck queue items across all services",
    inputSchema: {
      type: "object",
      properties: {
        autoFix: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    name: "download_status",
    description:
      "Get unified download status across arr services and downloaders",
    inputSchema: {
      type: "object",
      properties: {
        services: { type: "array", items: { type: "string" } },
        includeDownloader: { type: "boolean" },
        downloader: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "server_metrics",
    description: "Get server performance metrics and health status",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        detailed: { type: "boolean" },
      },
      required: [],
    },
  },
];

const InputSchema = z.object({
  service: z.string().optional(),
  title: z.string().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  ids: z.array(z.number()).optional(),
  since: z.string().optional(),
  limit: z.number().optional(),
  query: z.string().optional(),
  foreignId: z.number().optional(),
  rootFolderPath: z.string().optional(),
  qualityProfileId: z.number().optional(),
  monitored: z.boolean().optional(),
  autoFix: z.boolean().optional(),
  services: z.array(z.string()).optional(),
  includeDownloader: z.boolean().optional(),
  downloader: z.string().optional(),
  detailed: z.boolean().optional(),
});

class ArrMcpServer {
  private server = new Server({
    name: "arr-mcp",
    version: "0.2.7",
  });
  private config?: {
    services: Record<string, ServiceConfig>;
    downloaders?: Record<string, SabnzbdConfig>;
  };

  constructor() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const input = InputSchema.parse(args);

      let result;

      // Handle multi-service tools
      if (name === "all_services_diagnostics") {
        result = await debugToolTiming(name, "multi", () =>
          this.runAllServicesDiagnostics(input.autoFix ?? true),
        );
      } else if (name === "download_status") {
        result = await debugToolTiming(name, "multi", () =>
          this.runDownloadStatus(input),
        );
      } else {
        const service = serviceRegistry.get(input.service!);
        if (!service) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unknown service: ${input.service}. Available services: ${serviceRegistry.getAllNames().join(", ")}`,
          );
        }

        result = await debugToolTiming(
          name,
          input.service || "unknown",
          async () => {
            switch (name) {
              case "system_status":
                return await service.systemStatus();
              case "queue_list":
                return await service.queueList({
                  page: input.page,
                  pageSize: input.pageSize,
                });
              case "queue_grab":
                if (!input.ids || input.ids.length === 0) {
                  throw new McpError(
                    ErrorCode.InvalidParams,
                    "Missing or empty ids array",
                  );
                }
                return await service.queueGrab(input.ids);
              case "root_folders":
                return await service.rootFolderList();
              case "history_detail":
                return await service.historyDetail({
                  page: input.page,
                  pageSize: input.pageSize,
                  since: input.since,
                });
              case "search":
                if (!input.query) {
                  throw new McpError(
                    ErrorCode.InvalidParams,
                    "Missing query parameter",
                  );
                }
                return await service.search(input.query, {
                  limit: input.limit,
                });
              case "add_new":
                if (!input.title || !input.foreignId) {
                  throw new McpError(
                    ErrorCode.InvalidParams,
                    "Missing required parameters: title and foreignId",
                  );
                }
                return await service.addNew({
                  title: input.title,
                  foreignId: input.foreignId,
                  rootFolderPath: input.rootFolderPath,
                  qualityProfileId: input.qualityProfileId,
                  monitored: input.monitored,
                });
              case "import_issues":
                return await service.importIssues();
              case "quality_profiles":
                return await service.listQualityProfiles();
              case "queue_diagnostics":
                return await service.queueDiagnostics(input.autoFix);
              case "server_metrics":
                if (input.service) {
                  const serviceMetrics = metricsCollector.getServiceMetrics(
                    input.service,
                  );
                  if (!serviceMetrics) {
                    throw new McpError(
                      ErrorCode.InvalidParams,
                      `No metrics found for service: ${input.service}`,
                    );
                  }
                  return {
                    ok: true,
                    data: {
                      service: input.service,
                      ...serviceMetrics,
                      health: metricsCollector.getHealthStatus(),
                    },
                  };
                } else {
                  const summary = metricsCollector.getSummary();
                  const health = metricsCollector.getHealthStatus();
                  return {
                    ok: true,
                    data: {
                      ...summary,
                      health,
                      ...(input.detailed && {
                        recentOperations:
                          metricsCollector.getRecentOperations(10),
                        exportedMetrics: metricsCollector.exportMetrics(),
                      }),
                    },
                  };
                }
              default:
                throw new McpError(
                  ErrorCode.MethodNotFound,
                  `Unknown tool: ${name}`,
                );
            }
          },
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    });
  }

  private async runAllServicesDiagnostics(autoFix: boolean = true) {
    const allServices = serviceRegistry.getAll();
    const serviceResults = [];

    let totalQueueItems = 0;
    let totalIssuesFound = 0;
    let totalFixed = 0;
    let totalFailed = 0;
    let totalRequiresManual = 0;

    for (const service of allServices) {
      try {
        const diagnostics = await service.queueDiagnostics(autoFix);
        if (diagnostics.ok && diagnostics.data) {
          serviceResults.push(diagnostics.data);
          totalQueueItems += diagnostics.data.totalQueueItems;
          totalIssuesFound += diagnostics.data.issuesFound;
          totalFixed += diagnostics.data.summary.fixed;
          totalFailed += diagnostics.data.summary.failed;
          totalRequiresManual += diagnostics.data.summary.requiresManual;
        }
      } catch (error) {
        console.error(
          `Failed to run diagnostics for ${service.serviceName}:`,
          error,
        );
      }
    }

    return {
      ok: true,
      data: {
        totalServices: allServices.length,
        servicesScanned: allServices.map((s) => s.serviceName),
        overallSummary: {
          totalQueueItems,
          totalIssuesFound,
          totalFixed,
          totalFailed,
          totalRequiresManual,
        },
        serviceResults,
      },
    };
  }

  private async runDownloadStatus(input: {
    services?: string[];
    includeDownloader?: boolean;
    downloader?: string;
  }) {
    const targetServices = input.services || serviceRegistry.getAllNames();
    const includeDownloaderFlag = input.includeDownloader ?? true;
    const downloaderName =
      input.downloader || Object.keys(this.config?.downloaders || {})[0];

    const serviceResults = [];
    let totalQueued = 0;
    let totalDownloading = 0;
    let totalCompletedPendingImport = 0;

    // Get arr service data
    for (const serviceName of targetServices) {
      const service = serviceRegistry.get(serviceName);
      if (!service) continue;

      try {
        const queueResult = await service.queueList();
        if (queueResult.ok && queueResult.data) {
          const queueData = queueResult.data;
          const downloading = queueData.items.filter(
            (item) =>
              item.status.toLowerCase().includes("downloading") ||
              item.status.toLowerCase().includes("grabbing"),
          ).length;
          const pending = queueData.items.filter(
            (item) =>
              item.status.toLowerCase().includes("completed") ||
              item.status.toLowerCase().includes("pending"),
          ).length;

          serviceResults.push({
            service: serviceName,
            mediaKind: queueData.mediaKind,
            total: queueData.total,
            downloading,
            pending,
          });

          totalQueued += queueData.total;
          totalDownloading += downloading;
          totalCompletedPendingImport += pending;
        }
      } catch (error) {
        console.error(`Failed to get queue data for ${serviceName}:`, error);
      }
    }

    let downloaderData = null;
    if (includeDownloaderFlag && downloaderName) {
      const downloader = serviceRegistry.getDownloader(downloaderName);
      if (downloader) {
        try {
          const [statusResult, queueResult] = await Promise.all([
            downloader.serverStats(),
            downloader.queueList(),
          ]);

          if (
            statusResult.ok &&
            queueResult.ok &&
            statusResult.data &&
            queueResult.data
          ) {
            downloaderData = {
              service: downloaderName,
              name: statusResult.data.name,
              version: statusResult.data.version,
              isHealthy: statusResult.data.isHealthy,
              paused: statusResult.data.paused,
              totalSlots: queueResult.data.total,
              speedKBps: queueResult.data.speedKBps,
              totalSizeMB: queueResult.data.totalSizeMB,
              remainingSizeMB: queueResult.data.remainingSizeMB,
              items: queueResult.data.items.length,
            };
          }
        } catch (error) {
          console.error(
            `Failed to get downloader data for ${downloaderName}:`,
            error,
          );
        }
      }
    }

    return {
      ok: true,
      data: {
        services: targetServices,
        totals: {
          queued: totalQueued,
          downloading: totalDownloading,
          completedPendingImport: totalCompletedPendingImport,
        },
        serviceResults,
        downloader: downloaderData,
        correlationRatio: downloaderData
          ? Math.min(1.0, totalQueued / Math.max(1, downloaderData.items))
          : null,
      },
    };
  }

  initialize(config: {
    services: Record<string, ServiceConfig>;
    downloaders?: Record<string, SabnzbdConfig>;
  }) {
    this.config = config;
    serviceRegistry.clear();

    for (const [name, serviceConfig] of Object.entries(config.services)) {
      try {
        serviceRegistry.register(name, serviceConfig);
        console.log(`✅ Registered service: ${name}`);
      } catch (error) {
        console.error(
          `❌ Failed to register service ${name}:`,
          error instanceof Error ? error.message : error,
        );
        throw error;
      }
    }

    // Register downloaders
    if (config.downloaders) {
      for (const [name, downloaderConfig] of Object.entries(
        config.downloaders,
      )) {
        try {
          serviceRegistry.registerDownloader(name, downloaderConfig);
          console.log(`✅ Registered downloader: ${name}`);
        } catch (error) {
          console.error(
            `❌ Failed to register downloader ${name}:`,
            error instanceof Error ? error.message : error,
          );
          throw error;
        }
      }
    }

    const registeredServices = serviceRegistry.getAllNames();
    const registeredDownloaders = serviceRegistry.getAllDownloaderNames();
    console.log(
      `🚀 ARR MCP Server initialized with ${registeredServices.length} services: ${registeredServices.join(", ")}`,
    );
    if (registeredDownloaders.length > 0) {
      console.log(
        `📥 Registered ${registeredDownloaders.length} downloaders: ${registeredDownloaders.join(", ")}`,
      );
    }
  }

  async run() {
    await this.server.connect(new StdioServerTransport());
  }
}

interface EnvVarMapping {
  services?: Record<
    string,
    {
      baseUrl?: string;
      apiKey?: string;
    }
  >;
  downloaders?: Record<
    string,
    {
      baseUrl?: string;
      apiKey?: string;
      name?: string;
    }
  >;
}

async function loadConfig() {
  const configPath = process.env.FLIX_BRIDGE_CONFIG || "config.json";

  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch {
    // Try to load env var mapping configuration
    const envMapping = loadEnvVarMapping();
    if (envMapping) {
      return buildConfigFromEnvMapping(envMapping);
    }

    // Fall back to hardcoded env var names
    return buildConfigFromHardcodedEnvVars();
  }
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

  // Check if this is the new nested format or old flat format
  if (mapping.services || mapping.downloaders) {
    // New nested format: { services: {...}, downloaders: {...} }

    // Map services from custom env vars - support any service name
    if (mapping.services) {
      for (const [serviceName, serviceMapping] of Object.entries(
        mapping.services,
      )) {
        const baseUrl = serviceMapping.baseUrl
          ? process.env[serviceMapping.baseUrl]
          : undefined;
        const apiKey = serviceMapping.apiKey
          ? process.env[serviceMapping.apiKey]
          : undefined;

        if (baseUrl && apiKey) {
          services[serviceName] = {
            baseUrl: baseUrl,
            apiKey: apiKey,
          };
        }
      }
    }

    // Map downloaders from custom env vars - support any downloader name
    if (mapping.downloaders) {
      for (const [downloaderName, downloaderMapping] of Object.entries(
        mapping.downloaders,
      )) {
        const baseUrl = downloaderMapping.baseUrl
          ? process.env[downloaderMapping.baseUrl]
          : undefined;
        const apiKey = downloaderMapping.apiKey
          ? process.env[downloaderMapping.apiKey]
          : undefined;
        const name = downloaderMapping.name
          ? process.env[downloaderMapping.name]
          : undefined;

        if (baseUrl && apiKey) {
          downloaders[downloaderName] = {
            baseUrl: baseUrl,
            apiKey: apiKey,
            name: name || downloaderName,
          };
        }
      }
    }
  } else {
    // Old flat format: { "sonarr-hd": "SONARR_HD", "sabnzbd": "SABNZBD" }
    for (const [serviceName, envVarName] of Object.entries(
      mapping as Record<string, string>,
    )) {
      const envValue = process.env[envVarName];
      if (envValue) {
        try {
          const config = JSON.parse(envValue);
          if (config.url && config.apiKey) {
            if (
              serviceName.toLowerCase().includes("sabnzbd") ||
              serviceName.toLowerCase().includes("downloader")
            ) {
              downloaders[serviceName] = {
                baseUrl: config.url,
                apiKey: config.apiKey,
                name: config.name || serviceName,
              };
            } else {
              services[serviceName] = {
                baseUrl: config.url,
                apiKey: config.apiKey,
              };
            }
          }
        } catch (error) {
          console.error(
            `Failed to parse environment variable ${envVarName}:`,
            error,
          );
        }
      }
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

async function main() {
  const server = new ArrMcpServer();
  const config = await loadConfig();
  server.initialize(config);
  await server.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("💥 Failed to start ARR MCP Server:", error);
    process.exit(1);
  });
}
