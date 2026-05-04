#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadConfigFromEnvOnly } from "./config.js";
import { debugToolTiming } from "./debug.js";
import { metricsCollector } from "./metrics.js";
import type {
	OperationResult,
	RemovalExecutionOptions,
	RemovalPreparationData,
	ServiceConfig,
} from "./services/base.js";
import type {
	SabnzbdConfig,
	SabnzbdRemovalPreview,
	SabnzbdRemovalResult,
} from "./services/downloaders/sabnzbd.js";
import { serviceRegistry } from "./services/registry.js";

const tools = [
	{
		name: "list_services",
		description:
			"List all configured services and downloaders. Call this first to see available services.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
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
		name: "remove_content",
		description: "Preview and remove queue or library items with confirmation",
		inputSchema: {
			type: "object",
			properties: {
				service: { type: "string" },
				downloader: { type: "string" },
				target: {
					type: "string",
					enum: ["queue", "library", "downloader_queue"],
				},
				ids: {
					type: "array",
					items: { type: ["number", "string"] },
				},
				dryRun: { type: "boolean" },
				deleteFiles: { type: "boolean" },
				addImportExclusion: { type: "boolean" },
				removeFromClient: { type: "boolean" },
				blocklist: { type: "boolean" },
				removeFromDownloader: { type: "boolean" },
				allowManualRemoval: { type: "boolean" },
				manualImport: { type: "boolean" },
				confirmationToken: { type: "string" },
				queueTimeoutMs: { type: "number" },
			},
			required: ["ids"],
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
	ids: z.array(z.union([z.string(), z.number()])).optional(),
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
	target: z.enum(["queue", "library", "downloader_queue"]).optional(),
	dryRun: z.boolean().optional(),
	deleteFiles: z.boolean().optional(),
	addImportExclusion: z.boolean().optional(),
	removeFromClient: z.boolean().optional(),
	blocklist: z.boolean().optional(),
	removeFromDownloader: z.boolean().optional(),
	allowManualRemoval: z.boolean().optional(),
	manualImport: z.boolean().optional(),
	confirmationToken: z.string().optional(),
	queueTimeoutMs: z.number().optional(),
});

type RemovalTargetKind = "queue" | "library" | "downloader_queue";

interface ServiceRemovalOptions {
	deleteFiles: boolean;
	addImportExclusion: boolean;
	removeFromClient: boolean;
	blocklist: boolean;
	attemptManualImport: boolean;
	allowManualRemoval: boolean;
	queueTimeoutMs?: number;
}

type ConfirmationRecord =
	| {
			scope: "service";
			serviceName: string;
			target: "queue" | "library";
			ids: string[];
			options: ServiceRemovalOptions;
			preparation: RemovalPreparationData;
			removeFromDownloader: boolean;
			downloaderName?: string;
			downloaderDeleteData: boolean;
			downloaderDownloadIds: string[];
			downloaderPreview?: SabnzbdRemovalPreview;
			createdAt: number;
	  }
	| {
			scope: "downloader";
			downloaderName: string;
			ids: string[];
			deleteData: boolean;
			preview: SabnzbdRemovalPreview;
			createdAt: number;
	  };

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

class ArrMcpServer {
	private server = new Server({
		name: "arr-mcp",
		version: "0.3.2",
	});
	private config?: {
		services: Record<string, ServiceConfig>;
		downloaders?: Record<string, SabnzbdConfig>;
	};
	private pendingConfirmations: Map<string, ConfirmationRecord> = new Map();

	constructor() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools,
		}));

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;
			const input = InputSchema.parse(args);

			let result: unknown;

			// Handle multi-service tools
			if (name === "list_services") {
				result = await debugToolTiming(name, "info", async () => {
					const services = serviceRegistry.getAllNames();
					const downloaders = serviceRegistry.getAllDownloaderNames();
					return {
						ok: true,
						data: {
							services: services.map((name) => ({
								name,
								type:
									serviceRegistry
										.get(name)
										?.constructor.name?.replace("Service", "")
										.toLowerCase() || "unknown",
							})),
							downloaders: downloaders.map((name) => ({
								name,
								type: "sabnzbd",
							})),
							summary: {
								totalServices: services.length,
								totalDownloaders: downloaders.length,
							},
						},
					};
				});
			} else if (name === "all_services_diagnostics") {
				result = await debugToolTiming(name, "multi", () =>
					this.runAllServicesDiagnostics(input.autoFix ?? true),
				);
			} else if (name === "download_status") {
				result = await debugToolTiming(name, "multi", () =>
					this.runDownloadStatus(input),
				);
			} else if (name === "remove_content") {
				result = await this.handleRemoveContent(input);
			} else {
				const service = serviceRegistry.get(input.service || "");
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
								return await service.queueGrab(
									this.normalizeNumericIds(this.normalizeIdStrings(input.ids)),
								);
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
							case "server_metrics": {
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
								}
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

	private async runAllServicesDiagnostics(autoFix = true) {
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

	private async handleRemoveContent(
		input: z.infer<typeof InputSchema>,
	): Promise<OperationResult<unknown>> {
		if (!input.ids || input.ids.length === 0) {
			throw new McpError(ErrorCode.InvalidParams, "Missing ids array");
		}

		const target = (input.target ??
			(input.downloader && !input.service
				? "downloader_queue"
				: "queue")) as RemovalTargetKind;
		const idStrings = this.normalizeIdStrings(input.ids);

		if (idStrings.length === 0) {
			throw new McpError(ErrorCode.InvalidParams, "No valid ids provided");
		}

		const dryRun = input.dryRun !== false;
		const scopeLabel = input.service ?? input.downloader ?? target;

		return await debugToolTiming("remove_content", scopeLabel, async () => {
			if (target === "downloader_queue") {
				return await this.handleDownloaderRemoval({ dryRun, idStrings, input });
			}

			const serviceName = input.service;
			if (!serviceName) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Service name required when removing queue or library items",
				);
			}

			const numericIds = this.normalizeNumericIds(idStrings);
			return await this.handleServiceRemoval({
				dryRun,
				idStrings,
				numericIds,
				serviceName,
				target: target === "library" ? "library" : "queue",
				input,
			});
		});
	}

	private async handleServiceRemoval(params: {
		dryRun: boolean;
		idStrings: string[];
		numericIds: number[];
		serviceName: string;
		target: "queue" | "library";
		input: z.infer<typeof InputSchema>;
	}): Promise<OperationResult<unknown>> {
		const { dryRun, idStrings, numericIds, serviceName, target, input } =
			params;
		const service = serviceRegistry.get(serviceName);
		if (!service) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Unknown service: ${serviceName}. Available services: ${serviceRegistry
					.getAllNames()
					.join(", ")}`,
			);
		}

		const options = this.normalizeServiceRemovalOptions(input);
		const removeFromDownloader =
			target === "queue" && input.removeFromDownloader === true;
		const downloaderName = removeFromDownloader ? input.downloader : undefined;
		const downloaderDeleteData =
			target === "queue" ? Boolean(input.deleteFiles) : false;

		if (removeFromDownloader && !downloaderName) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Downloader name required when removeFromDownloader is true",
			);
		}

		if (dryRun) {
			const preparation = await service.prepareRemoval(target, numericIds);
			if (!preparation.ok || !preparation.data) {
				return preparation;
			}

			const queueTargets = preparation.data.targets.filter(
				(item) => item.source === "queue",
			);
			const downloaderCandidates = queueTargets.filter(
				(item) =>
					typeof item.downloadId === "string" && item.downloadId.length > 0,
			);
			const usenetCandidates = downloaderCandidates.filter((item) => {
				if (!item.protocol) return true;
				const protocol = item.protocol.toLowerCase();
				return protocol === "usenet";
			});
			const filteredOut = downloaderCandidates.filter(
				(item) => !usenetCandidates.includes(item),
			);
			const downloadIds = usenetCandidates.map(
				(item) => item.downloadId as string,
			);
			const manualReviewTargets = queueTargets.filter(
				(item) => item.manualReviewRequired,
			);

			let downloaderPreview: SabnzbdRemovalPreview | undefined;
			const notes = new Set<string>();
			if (preparation.data.notes) {
				for (const note of preparation.data.notes) {
					notes.add(note);
				}
			}

			if (
				manualReviewTargets.length > 0 &&
				options.allowManualRemoval !== true
			) {
				notes.add(
					`Sonarr flagged ${manualReviewTargets.length} queue item(s) for manual investigation. Removal will be blocked unless allowManualRemoval:true is provided.`,
				);
			}

			if (removeFromDownloader && filteredOut.length > 0) {
				const unsupportedProtocols = Array.from(
					new Set(
						filteredOut
							.map((item) => item.protocol?.toLowerCase())
							.filter((value): value is string => Boolean(value)),
					),
				).sort();
				const protocolLabel =
					unsupportedProtocols.length > 0
						? unsupportedProtocols.join(", ")
						: "unknown";
				notes.add(
					`${filteredOut.length} queue item(s) use unsupported protocol(s) (${protocolLabel}); downloader removal will be skipped for those items.`,
				);
			}
			if (removeFromDownloader && downloaderCandidates.length === 0) {
				notes.add(
					"No downloader ids were associated with the requested queue items; downloader removal will be skipped unless ids are present.",
				);
			}

			if (removeFromDownloader && downloaderName) {
				const downloader = serviceRegistry.getDownloader(downloaderName);
				if (!downloader) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `Downloader ${downloaderName} is no longer registered`,
						},
					};
				}

				if (downloadIds.length > 0) {
					const downloaderPreviewResult =
						await downloader.prepareRemoval(downloadIds);
					if (!downloaderPreviewResult.ok || !downloaderPreviewResult.data) {
						return downloaderPreviewResult as OperationResult<unknown>;
					}
					downloaderPreview = downloaderPreviewResult.data;
					if (downloaderPreview.missingIds.length > 0) {
						notes.add(
							`Downloader queue is already missing ${downloaderPreview.missingIds.length} item(s). They will be reported as skipped.`,
						);
					}
				} else {
					notes.add(
						"No downloader ids matched supported protocols; downloader removal will be skipped for this request.",
					);
				}
			}

			this.cleanupExpiredConfirmations();
			const token = randomUUID();
			this.pendingConfirmations.set(token, {
				scope: "service",
				serviceName,
				target,
				ids: idStrings,
				options,
				preparation: preparation.data,
				removeFromDownloader,
				downloaderName,
				downloaderDeleteData,
				downloaderDownloadIds: downloadIds,
				downloaderPreview,
				createdAt: Date.now(),
			});

			if (downloaderPreview && downloaderPreview.items.length > 0) {
				notes.add(
					`Downloader queue matches ${downloaderPreview.items.length} item(s) that will be removed if confirmed.`,
				);
			}

			return {
				ok: true,
				data: {
					mode: "dry_run",
					service: serviceName,
					target,
					options,
					notes: notes.size > 0 ? Array.from(notes) : undefined,
					removeFromDownloader,
					downloader: downloaderName,
					downloadIds,
					preview: preparation.data,
					downloaderPreview,
					confirmationToken: token,
					nextAction:
						"Call remove_content with dryRun:false and the provided confirmationToken to execute the removal.",
				},
			};
		}

		const token = input.confirmationToken;
		if (!token) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"confirmationToken is required to execute removal",
			);
		}

		const record = this.pendingConfirmations.get(token);
		if (!record || record.scope !== "service") {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Invalid or unknown confirmation token. Run a dry run first.",
			);
		}

		if (this.isConfirmationExpired(record)) {
			this.pendingConfirmations.delete(token);
			throw new McpError(
				ErrorCode.InvalidParams,
				"Confirmation token expired. Please run a new dry run.",
			);
		}

		if (record.serviceName !== serviceName || record.target !== target) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Service or target differs from dry run. Please repeat dry run.",
			);
		}

		if (!this.idsMatch(record.ids, idStrings)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"IDs differ from dry run. Please run a new dry run.",
			);
		}

		if (!this.optionsEqual(record.options, options)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Options changed since dry run. Please repeat dry run to confirm.",
			);
		}

		if (record.removeFromDownloader !== removeFromDownloader) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Downloader removal option changed since dry run.",
			);
		}

		const manualReviewTargets = record.preparation.targets.filter(
			(item) => item.source === "queue" && item.manualReviewRequired,
		);
		if (
			manualReviewTargets.length > 0 &&
			record.options.allowManualRemoval !== true
		) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Sonarr flagged ${manualReviewTargets.length} queue item(s) for manual investigation (${manualReviewTargets
					.map((item) => item.id)
					.join(
						", ",
					)}). Rerun remove_content with allowManualRemoval:true to proceed.`,
			);
		}

		this.pendingConfirmations.delete(token);

		const executionOptions: RemovalExecutionOptions = {
			deleteFiles: record.options.deleteFiles,
			addImportExclusion: record.options.addImportExclusion,
			removeFromClient: record.options.removeFromClient,
			blocklist: record.options.blocklist,
			attemptManualImport: record.options.attemptManualImport,
			queueTimeoutMs: record.options.queueTimeoutMs,
		};

		const execution = await service.executeRemoval(
			record.preparation,
			executionOptions,
		);
		if (!execution.ok || !execution.data) {
			return execution;
		}

		let downloaderResult: SabnzbdRemovalResult | undefined;
		const notes = new Set<string>();

		if (execution.data.notes) {
			for (const note of execution.data.notes) {
				notes.add(note);
			}
		}
		if (manualReviewTargets.length > 0 && record.options.allowManualRemoval) {
			notes.add(
				`Manual investigation override accepted for ${manualReviewTargets.length} queue item(s).`,
			);
		}
		if (record.options.queueTimeoutMs) {
			notes.add(
				`Queue removal timeout was set to ${record.options.queueTimeoutMs}ms for this execution.`,
			);
		}
		if (
			record.removeFromDownloader &&
			record.downloaderDownloadIds.length === 0
		) {
			notes.add(
				"Downloader removal was requested but no supported downloader ids were recorded during dry run; downloader cleanup is skipped.",
			);
		}

		if (record.removeFromDownloader && record.downloaderName) {
			const downloader = serviceRegistry.getDownloader(record.downloaderName);
			if (!downloader) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: `Downloader ${record.downloaderName} no longer available`,
					},
				};
			}

			const downloadIds = record.downloaderDownloadIds;

			if (downloadIds.length > 0) {
				const removal = await downloader.removeQueueItems(
					downloadIds,
					record.downloaderDeleteData,
				);
				if (!removal.ok || !removal.data) {
					return removal;
				}
				downloaderResult = removal.data;
				if (downloaderResult.missingIds.length > 0) {
					notes.add(
						`Downloader queue missing ${downloaderResult.missingIds.length} item(s); they were treated as already removed.`,
					);
				}
				if (
					downloaderResult.details.some((detail) => detail.status === "failed")
				) {
					notes.add(
						"At least one downloader removal failed. Review downloaderResult.details for specifics.",
					);
				}
			} else if (
				record.downloaderPreview &&
				record.downloaderPreview.items.length === 0
			) {
				notes.add(
					"No downloader ids were available during execution, so downloader removal was skipped.",
				);
			}
		}

		if (
			record.downloaderPreview &&
			record.downloaderPreview.missingIds.length > 0
		) {
			notes.add(
				`Downloader preview indicated ${record.downloaderPreview.missingIds.length} item(s) were already absent before execution.`,
			);
		}

		return {
			ok: true,
			data: {
				mode: "execute",
				service: serviceName,
				target,
				result: execution.data,
				removeFromDownloader: record.removeFromDownloader,
				downloader: record.downloaderName,
				downloaderResult,
				downloaderPreview: record.downloaderPreview,
				notes: notes.size > 0 ? Array.from(notes) : undefined,
			},
		};
	}

	private async handleDownloaderRemoval(params: {
		dryRun: boolean;
		idStrings: string[];
		input: z.infer<typeof InputSchema>;
	}): Promise<OperationResult<unknown>> {
		const { dryRun, idStrings, input } = params;
		const downloaderName = input.downloader;
		if (!downloaderName) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Downloader name required for downloader_queue target",
			);
		}

		const downloader = serviceRegistry.getDownloader(downloaderName);
		if (!downloader) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Unknown downloader: ${downloaderName}. Available downloaders: ${serviceRegistry
					.getAllDownloaderNames()
					.join(", ")}`,
			);
		}

		if (dryRun) {
			const preview = await downloader.prepareRemoval(idStrings);
			if (!preview.ok || !preview.data) {
				return preview;
			}

			this.cleanupExpiredConfirmations();
			const token = randomUUID();
			this.pendingConfirmations.set(token, {
				scope: "downloader",
				downloaderName,
				ids: idStrings,
				deleteData: Boolean(input.deleteFiles),
				preview: preview.data,
				createdAt: Date.now(),
			});

			return {
				ok: true,
				data: {
					mode: "dry_run",
					scope: "downloader",
					downloader: downloaderName,
					deleteData: Boolean(input.deleteFiles),
					preview: preview.data,
					confirmationToken: token,
				},
			};
		}

		const token = input.confirmationToken;
		if (!token) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"confirmationToken is required to execute removal",
			);
		}

		const record = this.pendingConfirmations.get(token);
		if (!record || record.scope !== "downloader") {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Invalid or unknown confirmation token. Run a dry run first.",
			);
		}

		if (this.isConfirmationExpired(record)) {
			this.pendingConfirmations.delete(token);
			throw new McpError(
				ErrorCode.InvalidParams,
				"Confirmation token expired. Please run a new dry run.",
			);
		}

		if (record.downloaderName !== downloaderName) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Downloader changed since dry run. Please repeat dry run.",
			);
		}

		if (!this.idsMatch(record.ids, idStrings)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"IDs differ from dry run. Please run a new dry run.",
			);
		}

		if (Boolean(input.deleteFiles) !== record.deleteData) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Delete-data flag changed since dry run. Please rerun dry run.",
			);
		}

		this.pendingConfirmations.delete(token);

		const removal = await downloader.removeQueueItems(
			record.ids,
			record.deleteData,
		);
		if (!removal.ok || !removal.data) {
			return removal;
		}

		return {
			ok: true,
			data: {
				mode: "execute",
				scope: "downloader",
				downloader: downloaderName,
				deleteData: record.deleteData,
				result: removal.data,
			},
		};
	}

	private normalizeIdStrings(ids: Array<string | number>): string[] {
		return Array.from(
			new Set(
				ids
					.map((value) => String(value ?? "").trim())
					.filter((value) => value.length > 0),
			),
		).sort((a, b) => a.localeCompare(b));
	}

	private normalizeNumericIds(idStrings: string[]): number[] {
		const numeric = idStrings.map((value) => Math.trunc(Number(value)));
		if (numeric.some((value) => !Number.isFinite(value) || value <= 0)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"IDs must be positive integers for arr services",
			);
		}

		return Array.from(new Set(numeric)).sort((a, b) => a - b);
	}

	private normalizeServiceRemovalOptions(
		input: z.infer<typeof InputSchema>,
	): ServiceRemovalOptions {
		let queueTimeoutMs: number | undefined;
		if (
			typeof input.queueTimeoutMs === "number" &&
			Number.isFinite(input.queueTimeoutMs)
		) {
			const clamped = Math.trunc(input.queueTimeoutMs);
			if (clamped > 0) {
				queueTimeoutMs = Math.max(1000, Math.min(clamped, 60000));
			}
		}

		return {
			deleteFiles: input.deleteFiles === true,
			addImportExclusion: input.addImportExclusion === true,
			removeFromClient: input.removeFromClient ?? true,
			blocklist: input.blocklist === true,
			attemptManualImport: input.manualImport !== false,
			allowManualRemoval: input.allowManualRemoval === true,
			queueTimeoutMs,
		};
	}

	private optionsEqual(
		a: ServiceRemovalOptions,
		b: ServiceRemovalOptions,
	): boolean {
		return (
			a.deleteFiles === b.deleteFiles &&
			a.addImportExclusion === b.addImportExclusion &&
			a.removeFromClient === b.removeFromClient &&
			a.blocklist === b.blocklist &&
			a.attemptManualImport === b.attemptManualImport &&
			a.allowManualRemoval === b.allowManualRemoval &&
			(a.queueTimeoutMs ?? null) === (b.queueTimeoutMs ?? null)
		);
	}

	private idsMatch(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) {
			if (a[i] !== b[i]) {
				return false;
			}
		}
		return true;
	}

	private cleanupExpiredConfirmations(): void {
		const now = Date.now();
		for (const [token, record] of this.pendingConfirmations.entries()) {
			if (now - record.createdAt > CONFIRMATION_TTL_MS) {
				this.pendingConfirmations.delete(token);
			}
		}
	}

	private isConfirmationExpired(record: ConfirmationRecord): boolean {
		return Date.now() - record.createdAt > CONFIRMATION_TTL_MS;
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

async function main() {
	const server = new ArrMcpServer();
	const config = await loadConfigFromEnvOnly();
	server.initialize(config);
	await server.run();
}

// Always execute main() - this is an MCP server meant to be run directly
main().catch((error) => {
	console.error("💥 Failed to start ARR MCP Server:", error);
	process.exit(1);
});
