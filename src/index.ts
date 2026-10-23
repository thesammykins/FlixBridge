#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	ProtocolErrorCode as ErrorCode,
	ProtocolError as McpError,
	Server,
	type Tool,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { sendApprovalRequest } from "./approval/bridge.js";
import { hashPlan } from "./approval/hash.js";
import { ApprovalStore } from "./approval/store.js";
import {
	immutablePreview,
	instanceBindings,
	removalPermit,
} from "./approval-plans.js";
import {
	approvalIdInput,
	approvalInput,
	approvalTools,
	monitoringInput,
} from "./approval-tools.js";
import { createInternalError, isTrustedError, serializeError } from "./core.js";
import { debugToolTiming } from "./debug.js";
import {
	classifyExecution,
	verifyRemediationAbsence,
} from "./execution-outcome.js";
import {
	executeLibraryAction,
	favouriteProtected,
	prepareLibraryAction,
} from "./library/actions.js";
import { loadDetail } from "./library/arr.js";
import {
	getWatchEvidence,
	libraryTools,
	loadLibrarySnapshot,
	mediaServers,
	mediaSystemStatus,
	runLibraryTool,
} from "./library/intelligence.js";
import { VersionCheckedServer } from "./mcp-version.js";
import { metricsCollector } from "./metrics.js";
import { withRemovalAuthority } from "./removal-authority.js";
import { ToolAdmission } from "./request-context.js";
import { getRule } from "./retention/rules.js";
import {
	cleanupCandidates,
	retentionTools,
	runRetentionTool,
} from "./retention/tools.js";
import { recommendationArguments } from "./retention-requests.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import type {
	ManualImportPreviewData,
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
import {
	executeRemediation,
	mintRemoveToken,
	planRemediation,
	type RemediateInput,
	resolveReports,
} from "./services/plex/remediation.js";
import {
	PlexReportsClient,
	plexConfigFromEnv,
} from "./services/plex/reports.js";
import { serviceRegistry } from "./services/registry.js";

function readServerVersion(): string {
	const packageJson: unknown = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	);
	return z.object({ version: z.string().min(1) }).parse(packageJson).version;
}

const SERVER_VERSION = readServerVersion();

const tools: Tool[] = [
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
					enum: ["queue", "library", "downloader_queue", "season", "files"],
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
				approvalId: { type: "string" },
				allowUnsupportedFavourites: { type: "boolean" },
				watchedPolicy: {
					type: "string",
					enum: ["all-selected", "any-selected"],
				},
				retentionRuleId: { type: "string" },
				retentionRuleVersion: {
					type: "integer",
					minimum: 1,
					maximum: Number.MAX_SAFE_INTEGER,
				},
				itemId: {
					type: "integer",
					minimum: 1,
					maximum: Number.MAX_SAFE_INTEGER,
				},
				seasonNumbers: {
					type: "array",
					minItems: 1,
					maxItems: 100,
					items: {
						type: "integer",
						minimum: 0,
						maximum: Number.MAX_SAFE_INTEGER,
					},
				},
				users: {
					type: "array",
					minItems: 1,
					maxItems: 100,
					items: {
						type: "object",
						properties: {
							server: { type: "string", minLength: 1, maxLength: 256 },
							userId: { type: "string", minLength: 1, maxLength: 256 },
						},
						required: ["server", "userId"],
						additionalProperties: false,
					},
				},
			},
			required: ["ids"],
		},
	},
	{
		name: "manual_import",
		description:
			"Preview and execute high-confidence ARR manual imports for queue items",
		inputSchema: {
			type: "object",
			properties: {
				service: { type: "string" },
				ids: { type: "array", items: { type: "number" } },
				dryRun: { type: "boolean" },
				confirmationToken: { type: "string" },
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
	{
		name: "reported_issues",
		description:
			"List Plex user-reported issues (Report Issue feed), resolved to titles and matched against arr services. Returns resolution state (unresolved / clarification_requested / fixed) from comment history so callers can skip already-fixed reports.",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "number", maximum: 100 },
				after: { type: "string" },
			},
			required: [],
		},
	},
	{
		name: "remediate_reported_issue",
		description:
			"Resolve a single Plex reported issue: comment_only (ask for clarification), re_search (trigger fresh search), add_or_upgrade (add with standard profile + search, or upgrade search if present), or remove_and_regrab (delete broken file + re-grab; requires dryRun first for a confirmation token). Comments back on the report explaining what was done.",
		inputSchema: {
			type: "object",
			properties: {
				reportId: { type: "string" },
				action: {
					type: "string",
					enum: [
						"comment_only",
						"re_search",
						"add_or_upgrade",
						"remove_and_regrab",
					],
				},
				service: { type: "string" },
				comment: { type: "string" },
				dryRun: { type: "boolean" },
				confirmationToken: { type: "string" },
				approvalId: { type: "string", format: "uuid" },
			},
			required: ["reportId", "action"],
		},
	},
	{
		name: "update_quality_profile",
		description:
			"Change a library item's quality profile (e.g. align an item with the library standard). Takes the service, the arr item id, and the target qualityProfileId (see quality_profiles for ids and usage).",
		inputSchema: {
			type: "object",
			properties: {
				service: { type: "string" },
				itemId: { type: "number" },
				qualityProfileId: { type: "number" },
			},
			required: ["service", "itemId", "qualityProfileId"],
		},
	},
	{
		name: "library_statistics",
		description:
			"Read Sonarr API v5 library counts, disk usage and quality/tag breakdowns",
		inputSchema: {
			type: "object",
			properties: { service: { type: "string" } },
			required: ["service"],
		},
	},
];

tools.push(...libraryTools, ...approvalTools, ...retentionTools);

// Envelope guarantee only: service-specific data remains deliberately unconstrained.
const outputSchema: NonNullable<Tool["outputSchema"]> = {
	type: "object",
	required: ["ok"],
	additionalProperties: false,
	properties: {
		ok: { type: "boolean" },
		data: {},
		error: {
			type: "object",
			required: ["message"],
			additionalProperties: false,
			properties: {
				message: { type: "string" },
				service: { type: "string" },
				status: { type: "number" },
				kind: { type: "string" },
				code: { type: "string" },
			},
		},
	},
};
const writeTools = new Set([
	"queue_grab",
	"remove_content",
	"manual_import",
	"add_new",
	"queue_diagnostics",
	"all_services_diagnostics",
	"remediate_reported_issue",
	"update_quality_profile",
	"request_approval",
	"cancel_approval",
	"update_monitoring",
	"retention_rules",
	"retention_evaluate",
]);
const OutputEnvelope = z
	.object({
		ok: z.boolean(),
		data: z.unknown().optional(),
		error: z
			.object({
				message: z.string(),
				service: z.string().optional(),
				status: z.number().optional(),
				kind: z.string().optional(),
				code: z.string().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();
for (const tool of tools) {
	tool.outputSchema = outputSchema;
	if (
		[...libraryTools, ...retentionTools, ...approvalTools].some(
			(extended) => extended === tool,
		)
	) {
		tool.inputSchema.additionalProperties = false;
		tool.annotations ??= {
			readOnlyHint: tool.name === "approval_status",
			destructiveHint: ["update_monitoring", "cancel_approval"].includes(
				tool.name,
			),
			idempotentHint: false,
			openWorldHint: !["approval_status", "cancel_approval"].includes(
				tool.name,
			),
		};
		continue;
	}
	tool.inputSchema.additionalProperties = false;
	for (const [name, property] of Object.entries(
		tool.inputSchema.properties ?? {},
	)) {
		const field = property as Record<string, unknown>;
		if (field.type === "number")
			Object.assign(field, {
				type: "integer",
				minimum: name === "queueTimeoutMs" ? 1000 : 1,
				maximum:
					typeof field.maximum === "number"
						? field.maximum
						: name === "queueTimeoutMs"
							? 60000
							: ["limit", "pageSize"].includes(name)
								? 1000
								: Number.MAX_SAFE_INTEGER,
			});
		if (field.type === "string")
			Object.assign(field, { minLength: 1, maxLength: 4096 });
		if (name === "ids")
			Object.assign(field, {
				minItems: 1,
				maxItems: 1000,
				items: {
					type:
						tool.name === "remove_content" ? ["integer", "string"] : "integer",
					minimum: 1,
					maximum: Number.MAX_SAFE_INTEGER,
					minLength: 1,
					maxLength: 256,
				},
			});
		if (name === "services")
			Object.assign(field, {
				maxItems: 100,
				items: { type: "string", minLength: 1, maxLength: 256 },
			});
	}
	const readOnlyHint = !writeTools.has(tool.name);
	tool.annotations = {
		readOnlyHint,
		openWorldHint: !["list_services", "server_metrics"].includes(tool.name),
		...(!readOnlyHint && {
			destructiveHint: tool.name !== "add_new",
			idempotentHint: false,
		}),
	};
}

export const InputSchema = z.object({
	service: z.string().min(1).max(4096).optional(),
	title: z.string().min(1).max(4096).optional(),
	page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
	pageSize: z.number().int().positive().max(1000).optional(),
	ids: z
		.array(
			z.union([
				z.string().min(1).max(256),
				z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
			]),
		)
		.min(1)
		.max(1000)
		.optional(),
	since: z.string().min(1).max(4096).optional(),
	after: z.string().min(1).max(4096).optional(),
	limit: z.number().int().positive().max(1000).optional(),
	query: z.string().min(1).max(4096).optional(),
	foreignId: z
		.number()
		.int()
		.positive()
		.max(Number.MAX_SAFE_INTEGER)
		.optional(),
	rootFolderPath: z.string().min(1).max(4096).optional(),
	qualityProfileId: z
		.number()
		.int()
		.positive()
		.max(Number.MAX_SAFE_INTEGER)
		.optional(),
	monitored: z.boolean().optional(),
	autoFix: z.boolean().optional(),
	services: z.array(z.string().min(1).max(256)).max(100).optional(),
	includeDownloader: z.boolean().optional(),
	downloader: z.string().min(1).max(4096).optional(),
	detailed: z.boolean().optional(),
	target: z
		.enum(["queue", "library", "downloader_queue", "season", "files"])
		.optional(),
	seasonNumbers: z
		.array(z.number().int().nonnegative().safe())
		.min(1)
		.max(100)
		.optional(),
	users: z
		.array(
			z
				.object({
					server: z.string().min(1).max(256),
					userId: z.string().min(1).max(256),
				})
				.strict(),
		)
		.min(1)
		.max(100)
		.optional(),
	approvalId: z.string().uuid().optional(),
	allowUnsupportedFavourites: z.boolean().optional(),
	watchedPolicy: z.enum(["all-selected", "any-selected"]).optional(),
	retentionRuleId: z
		.string()
		.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
		.optional(),
	retentionRuleVersion: z.number().int().positive().safe().optional(),
	episodeIds: z
		.array(z.number().int().positive().safe())
		.min(1)
		.max(1000)
		.optional(),
	dryRun: z.boolean().optional(),
	deleteFiles: z.boolean().optional(),
	addImportExclusion: z.boolean().optional(),
	removeFromClient: z.boolean().optional(),
	blocklist: z.boolean().optional(),
	removeFromDownloader: z.boolean().optional(),
	allowManualRemoval: z.boolean().optional(),
	manualImport: z.boolean().optional(),
	confirmationToken: z.string().min(1).max(4096).optional(),
	queueTimeoutMs: z.number().int().min(1000).max(60000).optional(),
	reportId: z.string().min(1).max(4096).optional(),
	itemId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
	action: z
		.enum(["comment_only", "re_search", "add_or_upgrade", "remove_and_regrab"])
		.optional(),
	comment: z.string().min(1).max(4096).optional(),
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
			scope: "manual_import";
			serviceName: string;
			ids: string[];
			preview: ManualImportPreviewData;
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

export class ArrMcpServer {
	private admission = new ToolAdmission();
	private buildServer(era: "legacy" | "modern") {
		const ServerClass = era === "modern" ? VersionCheckedServer : Server;
		const server = new ServerClass(
			{
				name: "arr-mcp",
				version: SERVER_VERSION,
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);
		this.registerHandlers(server);
		return server;
	}
	private config?: {
		services: Record<string, ServiceConfig>;
		downloaders?: Record<string, SabnzbdConfig>;
	};
	private pendingConfirmations: Map<string, ConfirmationRecord> = new Map();

	private registerHandlers(server: Server) {
		server.setRequestHandler("tools/list", async () => ({
			tools,
		}));

		server.setRequestHandler("tools/call", async (request, ctx) => {
			const { name, arguments: args } = request.params;
			const tool = tools.find((tool) => tool.name === name);
			if (!tool) throw new McpError(ErrorCode.InvalidParams, "Unknown tool");
			let result: unknown;
			try {
				result = await this.admission.run(ctx.mcpReq.signal, () =>
					this.callTool(name, args ?? {}),
				);
			} catch (error) {
				if (
					error instanceof McpError &&
					error.code === ErrorCode.InvalidParams
				) {
					return this.toolResult({
						ok: false,
						error: createInternalError(error.message),
					});
				}
				if (error instanceof z.ZodError)
					return this.toolResult({
						ok: false,
						error: createInternalError(
							"Invalid arguments: check the tool's advertised fields and bounds",
						),
					});
				if (isTrustedError(error))
					return this.toolResult({ ok: false, error: serializeError(error) });
				throw new McpError(ErrorCode.InternalError, "Internal error");
			}
			try {
				return this.toolResult(result);
			} catch {
				throw new McpError(ErrorCode.InternalError, "Internal error");
			}
		});
	}

	async callTool(
		name: string,
		args: Record<string, unknown> = {},
	): Promise<unknown> {
		const descriptor = tools.find((tool) => tool.name === name);
		if (!descriptor)
			throw new McpError(ErrorCode.InvalidParams, "Unknown tool");
		for (const field of descriptor.inputSchema.required ?? [])
			if (args[field] === undefined)
				throw new McpError(
					ErrorCode.InvalidParams,
					`Missing required field: ${field}`,
				);
		if (libraryTools.some((tool) => tool.name === name))
			return runLibraryTool(name, args);
		if (retentionTools.some((tool) => tool.name === name))
			return {
				ok: true,
				data: await runRetentionTool(name, args, {
					loadLibrarySnapshot,
					getWatchEvidence,
				}),
			};
		if (name === "request_approval") {
			const request = approvalInput.parse(args);
			const tool = tools.find((t) => t.name === request.tool);
			if (!tool) throw createInternalError("Unknown approval tool");
			const input: z.infer<typeof InputSchema> =
				request.tool === "update_monitoring"
					? monitoringInput.parse(request.arguments)
					: this.parseToolInput(tool, request.arguments);
			if (
				request.tool === "remediate_reported_issue" &&
				input.action !== "remove_and_regrab"
			)
				throw createInternalError(
					"Only destructive remediation uses approval requests",
				);
			const prepared = await this.prepareApproval(request.tool, input);
			const store = new ApprovalStore();
			const record = await store.create(prepared.manifest);
			let notification: unknown = {
				sent: false,
				reason: "No approval webhook configured",
			};
			if (record.newRequest && process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL) {
				try {
					notification = await sendApprovalRequest(store, record.id);
				} catch {
					notification = {
						sent: false,
						reason: "Approval notification failed; request remains pending",
					};
				}
			}
			return { ok: true, data: { ...record, notification } };
		}
		if (name === "approval_status" || name === "cancel_approval") {
			const { requestId } = approvalIdInput.parse(args);
			const store = new ApprovalStore();
			return {
				ok: true,
				data:
					name === "cancel_approval"
						? await store.cancel(requestId)
						: await store.get(requestId),
			};
		}
		if (name === "update_monitoring")
			return this.executeTool(name, monitoringInput.parse(args));
		const tool = tools.find((tool) => tool.name === name);
		if (!tool) throw createInternalError("Unknown tool");
		return this.executeTool(name, this.parseToolInput(tool, args));
	}

	private async wholeTitleEvidence(input: z.infer<typeof InputSchema>) {
		if (!input.service) throw createInternalError("Explicit service required");
		const ids = this.normalizeNumericIds(
			this.normalizeIdStrings(input.ids ?? []),
		);
		const selected = [];
		for (const id of ids) selected.push(await loadDetail(input.service, id));
		if (
			selected.length !== ids.length ||
			selected.some(
				(item) =>
					!item.complete ||
					item.service !== input.service ||
					!ids.includes(item.id),
			)
		)
			throw createInternalError(
				"Complete exact file manifest required for whole-title removal",
			);
		if (input.deleteFiles && !input.users?.length)
			throw createInternalError(
				"Explicit users and servers required to protect playback during whole-title removal",
			);
		const evidence = [];
		for (const item of selected) {
			const watch = input.users?.length
				? await getWatchEvidence(item, input.users)
				: null;
			if (
				input.deleteFiles &&
				(!watch?.complete ||
					watch.activePlayback !== false ||
					favouriteProtected(watch, input) ||
					input.users?.some(
						(user) =>
							watch.viewers.filter(
								(viewer) =>
									viewer.server === user.server &&
									viewer.userId === user.userId,
							).length !== 1,
					))
			)
				throw createInternalError(
					"Playback/favourite protection blocks whole-title deletion",
				);
			evidence.push({ item, watch });
		}
		return evidence;
	}

	private async prepareApproval(
		name: string,
		input: z.infer<typeof InputSchema>,
	) {
		let ruleContext: unknown = null;
		if (input.retentionRuleId || input.retentionRuleVersion) {
			if (
				name !== "remove_content" ||
				!input.retentionRuleId ||
				!input.retentionRuleVersion
			)
				throw createInternalError(
					"Rule-bound removal requires an exact rule and version",
				);
			const revision = await getRule(input.retentionRuleId);
			if (!revision.enabled || revision.version !== input.retentionRuleVersion)
				throw createInternalError(
					"Retention rule changed or is disabled; request fresh approval",
				);
			const evaluation = await cleanupCandidates(
				{ rule: revision.rule, evaluationTime: new Date().toISOString() },
				{ loadLibrarySnapshot, getWatchEvidence },
			);
			const matches = evaluation.recommendations.filter((candidate) =>
				Object.entries(recommendationArguments(candidate, revision)).every(
					([key, value]) =>
						JSON.stringify(input[key as keyof typeof input]) ===
						JSON.stringify(value),
				),
			);
			if (matches.length !== 1)
				throw createInternalError(
					"Rule eligibility, bounds or proposed action changed; no removal authority",
				);
			ruleContext = {
				id: revision.id,
				version: revision.version,
				rule: revision.rule,
			};
		}
		const action =
			name === "update_monitoring" ||
			(name === "remove_content" &&
				["season", "files"].includes(input.target ?? ""))
				? await prepareLibraryAction(input, {
						loadLibrarySnapshot,
						getWatchEvidence,
					})
				: undefined;
		const previewResult = z
			.object({
				ok: z.boolean(),
				data: z.unknown().optional(),
				error: z.unknown().optional(),
			})
			.parse(
				action
					? { ok: true, data: action }
					: await this.executeTool(name, { ...input, dryRun: true }, true),
			);
		if (!previewResult.ok || previewResult.data === undefined)
			throw previewResult.error
				? serializeError(previewResult.error)
				: createInternalError(
						"Fresh exact-target preview failed; no approval can be requested",
					);
		const preview = z.record(z.string(), z.unknown()).parse(previewResult.data);
		let libraryEvidence: unknown = null;
		if (name === "remove_content" && input.target === "library") {
			libraryEvidence = await this.wholeTitleEvidence(input);
		}
		return {
			manifest: immutablePreview({
				tool: name,
				arguments: immutablePreview({
					...input,
					dryRun: undefined,
					approvalId: undefined,
					confirmationToken: undefined,
				}),
				preview,
				libraryEvidence,
				ruleContext,
				instances: await instanceBindings(
					input.users?.map((user) => user.server) ?? [],
					name === "remediate_reported_issue",
				),
			}),
			token:
				typeof preview.confirmationToken === "string"
					? preview.confirmationToken
					: undefined,
			preview,
			action,
		};
	}

	private async executeApproved(
		name: string,
		input: z.infer<typeof InputSchema>,
	): Promise<unknown> {
		if (!input.approvalId)
			throw createInternalError("Authenticated human approvalId is required");
		const prepared = await this.prepareApproval(name, input);
		const store = new ApprovalStore();
		const claim = await store.claim(input.approvalId, prepared.manifest);
		try {
			const permit = await removalPermit(
				claim.id,
				claim.planHash,
				name,
				input,
				prepared.preview,
			);
			if (name === "remove_content" && input.target === "library") {
				const manifest = z
					.object({ libraryEvidence: z.unknown(), instances: z.unknown() })
					.parse(claim.plan);
				const approvedRows = z
					.array(
						z.object({
							item: z
								.object({
									id: z.number().int().positive(),
									service: z.string(),
								})
								.passthrough(),
							watch: z.unknown(),
						}),
					)
					.parse(manifest.libraryEvidence);
				permit.beforeRemoval = async (url) => {
					const approved = approvedRows.find(
						(row) => String(row.item.id) === url.pathname.split("/").at(-1),
					);
					if (!approved)
						throw createInternalError(
							"Whole-title DELETE outside the claimed evidence",
						);
					const bindings = await instanceBindings(
						input.users?.map((user) => user.server) ?? [],
					);
					if (hashPlan(bindings) !== hashPlan(manifest.instances))
						throw createInternalError(
							"Instance or viewer bindings changed before whole-title deletion",
						);
					const fresh = await this.wholeTitleEvidence({
						...input,
						ids: [approved.item.id],
					});
					if (
						fresh.length !== 1 ||
						hashPlan(immutablePreview(fresh[0])) !== hashPlan(approved)
					)
						throw createInternalError(
							"Exact file, episode or watch evidence changed before whole-title deletion; approval consumed without deleting this title",
						);
				};
			}
			let result: unknown = await withRemovalAuthority(permit, () =>
				prepared.action
					? executeLibraryAction(input, prepared.action, {
							loadLibrarySnapshot,
							getWatchEvidence,
						})
					: this.executeTool(
							name,
							{ ...input, confirmationToken: prepared.token },
							true,
						),
			);
			if (name === "remediate_reported_issue") {
				const remediation = z
					.object({
						ok: z.boolean(),
						data: z.record(z.string(), z.unknown()).optional(),
					})
					.parse(result);
				if (remediation.ok) {
					const deletionVerified = await verifyRemediationAbsence(
						prepared.preview,
					);
					result = {
						ok: deletionVerified,
						data: {
							...remediation.data,
							deletionVerified,
							verified: false,
							executionState: deletionVerified ? "pending" : "uncertain",
							uncertain: !deletionVerified,
						},
						...(!deletionVerified && {
							error: createInternalError(
								"Remediation was submitted but deletion absence could not be verified; reconcile without replay",
							),
						}),
					};
				}
			}
			const outcome = z
				.object({ ok: z.boolean(), data: z.unknown().optional() })
				.parse(result);
			const { state, verified } = classifyExecution(name, result);
			if (name === "remove_content" && !verified && outcome.ok) {
				outcome.ok = false;
				result = {
					...outcome,
					error: createInternalError(
						"Approved removal did not fully verify; inspect per-target results without replay",
					),
				};
			}
			await store.finish(
				claim.id,
				state,
				JSON.parse(
					JSON.stringify({
						ok: outcome.ok,
						verified,
						data: outcome.data ?? null,
					}),
				),
			);
			return result;
		} catch {
			await store.finish(claim.id, "uncertain");
			return {
				ok: false,
				error: createInternalError(
					"Approved operation may have changed state; execution is consumed. Reconcile before requesting another approval",
				),
			};
		}
	}

	private parseToolInput(
		tool: Tool,
		args: Record<string, unknown> = {},
	): z.infer<typeof InputSchema> {
		for (const field of tool.inputSchema.required ?? []) {
			if (args[field] === undefined)
				throw new McpError(
					ErrorCode.InvalidParams,
					`Missing required field: ${field}`,
				);
		}
		const fields = Object.keys(tool.inputSchema.properties ?? {});
		if (Object.keys(args).some((field) => !fields.includes(field)))
			throw new McpError(
				ErrorCode.InvalidParams,
				"Unknown argument: use only the tool's advertised fields",
			);
		const parsed = InputSchema.safeParse(args);
		if (!parsed.success)
			throw new McpError(
				ErrorCode.InvalidParams,
				`Invalid field: ${parsed.error.issues.map((issue) => issue.path[0]).join(", ")}`,
			);
		const input = parsed.data;
		if (
			["season", "files"].includes(input.target ?? "") &&
			[
				input.blocklist,
				input.removeFromClient,
				input.removeFromDownloader,
				input.addImportExclusion,
				input.manualImport,
			].some((value) => value === true)
		)
			throw new McpError(
				ErrorCode.InvalidParams,
				"Legacy downloader, import, exclusion and blocklist side effects are not supported for season/file cleanup",
			);
		if (tool.name === "reported_issues" && (input.limit ?? 25) > 100)
			throw new McpError(
				ErrorCode.InvalidParams,
				"Report page limit must be at most 100",
			);
		if (
			input.ids &&
			tool.name !== "remove_content" &&
			input.ids.some((id) => typeof id !== "number")
		)
			throw new McpError(
				ErrorCode.InvalidParams,
				"ids must contain positive integers",
			);
		if (
			tool.name === "remove_content" &&
			input.ids &&
			input.target !== "downloader_queue" &&
			!(input.downloader && !input.service)
		)
			this.normalizeNumericIds(this.normalizeIdStrings(input.ids));
		return input;
	}

	private toolResult(result: unknown) {
		const structuredContent = OutputEnvelope.parse(
			JSON.parse(
				JSON.stringify(result, (key, value: unknown) => {
					if (
						["raw", "cause", "apiKey", "password", "accessToken"].includes(key)
					)
						return undefined;
					if (key === "error" && value !== undefined && value !== null)
						return typeof value === "string"
							? "Operation failed"
							: serializeError(value);
					return value;
				}),
			),
		) as Record<string, unknown>;
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(structuredContent, null, 2),
				},
			],
			structuredContent,
			...(structuredContent.ok === false && { isError: true }),
		};
	}

	private async executeTool(
		name: string,
		input: z.infer<typeof InputSchema>,
		approved = false,
	): Promise<unknown> {
		if (
			(name === "remove_content" && input.dryRun === false) ||
			(name === "remediate_reported_issue" &&
				input.action === "remove_and_regrab" &&
				input.dryRun !== true)
		) {
			if (!input.approvalId)
				throw createInternalError(
					"Authenticated human approvalId is required; a preview token is not consent",
				);
			if (!approved) return this.executeApproved(name, input);
		}
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
							type: serviceRegistry.get(name)?.id ?? "unknown",
							...(serviceRegistry.get(name)?.id === "sonarr" && {
								apiPolicy: this.config?.services[name]?.apiVersion ?? "legacy",
							}),
						})),
						downloaders: downloaders.map((name) => ({
							name,
							type: "sabnzbd",
						})),
						mediaServers: mediaServers(),
						summary: {
							totalServices: services.length,
							totalDownloaders: downloaders.length,
						},
					},
				};
			});
		} else if (name === "all_services_diagnostics") {
			result = await debugToolTiming(name, "multi", () =>
				this.runAllServicesDiagnostics(input.autoFix ?? false),
			);
		} else if (name === "download_status") {
			result = await debugToolTiming(name, "multi", () =>
				this.runDownloadStatus(input),
			);
		} else if (
			name === "system_status" &&
			mediaServers().some((server) => server.name === input.service)
		) {
			result = await mediaSystemStatus(input.service ?? "");
		} else if (
			name === "system_status" &&
			!serviceRegistry.has(input.service ?? "") &&
			serviceRegistry.hasDownloader(input.service ?? "")
		) {
			result = await serviceRegistry
				.getDownloader(input.service ?? "")
				?.serverStats();
		} else if (
			name === "update_monitoring" ||
			(name === "remove_content" &&
				["season", "files"].includes(input.target ?? ""))
		) {
			const prepared = await prepareLibraryAction(input, {
				loadLibrarySnapshot,
				getWatchEvidence,
			});
			if (input.dryRun !== false) return { ok: true, data: prepared };
			if (!approved) return this.executeApproved(name, input);
			return executeLibraryAction(input, prepared, {
				loadLibrarySnapshot,
				getWatchEvidence,
			});
		} else if (name === "remove_content") {
			result = await this.handleRemoveContent(input);
		} else if (name === "reported_issues") {
			try {
				result = await this.handleReportedIssues(input.limit, input.after);
			} catch (error) {
				if (error instanceof McpError) throw error;
				result = { ok: false, error: serializeError(error) };
			}
		} else if (name === "remediate_reported_issue") {
			result = await this.handleRemediateReportedIssue({
				reportId: input.reportId,
				action: input.action,
				service: input.service,
				comment: input.comment,
				dryRun: input.dryRun,
				confirmationToken: input.confirmationToken,
			});
		} else if (name === "update_quality_profile") {
			result = await this.handleUpdateQualityProfile(input);
		} else if (name === "server_metrics") {
			result = this.serverMetrics(input);
		} else {
			const service = serviceRegistry.get(input.service || "");
			if (!service) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"Unknown service. Use list_services to discover configured services.",
				);
			}

			result = await debugToolTiming(
				name,
				input.service || "unknown",
				async () => {
					switch (name) {
						case "library_statistics":
							return service.libraryStatistics
								? await service.libraryStatistics()
								: {
										ok: false,
										error: createInternalError(
											"Library statistics is not supported by this service",
										),
									};
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
						case "manual_import":
							return await this.handleManualImport(input);
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
							return await service.queueDiagnostics(input.autoFix ?? false);
						default:
							throw new McpError(
								ErrorCode.MethodNotFound,
								`Unknown tool: ${name}`,
							);
					}
				},
			);
		}

		return result;
	}

	private serverMetrics(input: z.infer<typeof InputSchema>) {
		if (input.service) {
			const serviceMetrics = metricsCollector.getServiceMetrics(input.service);
			if (!serviceMetrics) {
				throw new McpError(
					ErrorCode.InvalidParams,
					"No metrics found for requested service",
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
					recentOperations: metricsCollector.getRecentOperations(10),
					exportedMetrics: metricsCollector.exportMetrics(),
				}),
			},
		};
	}

	private async runAllServicesDiagnostics(autoFix = false) {
		const allServices = serviceRegistry.getAll();
		const serviceResults = [];
		const errors: Array<{
			service: string;
			error: ReturnType<typeof serializeError>;
		}> = [];

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
				} else
					errors.push({
						service: service.serviceName,
						error: serializeError(
							diagnostics.ok ? undefined : diagnostics.error,
						),
					});
			} catch (error) {
				errors.push({
					service: service.serviceName,
					error: serializeError(error),
				});
			}
		}

		return {
			ok: errors.length === 0,
			data: {
				incomplete: errors.length > 0,
				errors,
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
		const errors: Array<{
			service: string;
			error: ReturnType<typeof serializeError>;
		}> = [];
		let totalQueued = 0;
		let totalDownloading = 0;
		let totalCompletedPendingImport = 0;

		// Get arr service data
		for (const serviceName of targetServices) {
			const service = serviceRegistry.get(serviceName);
			if (!service) {
				errors.push({
					service: serviceName,
					error: serializeError({
						kind: "internal",
						message: "Unknown requested service",
					}),
				});
				continue;
			}

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
						observed: queueData.items.length,
						truncated: queueData.truncated,
						downloading,
						pending,
					});
					if (queueData.truncated)
						errors.push({
							service: serviceName,
							error: serializeError(
								createInternalError(
									"Queue snapshot is partial; downloading and pending counts describe observed items only",
								),
							),
						});

					totalQueued += queueData.total;
					totalDownloading += downloading;
					totalCompletedPendingImport += pending;
				} else
					errors.push({
						service: serviceName,
						error: serializeError(
							queueResult.ok ? undefined : queueResult.error,
						),
					});
			} catch (error) {
				errors.push({ service: serviceName, error: serializeError(error) });
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
					} else {
						for (const result of [statusResult, queueResult]) {
							if (!result.ok || !result.data)
								errors.push({
									service: downloaderName,
									error: serializeError(result.ok ? undefined : result.error),
								});
						}
					}
				} catch (error) {
					errors.push({
						service: downloaderName,
						error: serializeError(error),
					});
				}
			} else {
				errors.push({
					service: downloaderName,
					error: serializeError({
						kind: "internal",
						message: "Unknown requested downloader",
					}),
				});
			}
		}

		return {
			ok: errors.length === 0,
			data: {
				incomplete: errors.length > 0,
				errors,
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

	private async handleManualImport(
		input: z.infer<typeof InputSchema>,
	): Promise<OperationResult<unknown>> {
		const serviceName = input.service;
		if (!serviceName) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"service is required for manual_import",
			);
		}
		if (!input.ids || input.ids.length === 0) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"ids is required for manual_import",
			);
		}
		const service = serviceRegistry.get(serviceName);
		if (!service) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Unknown service. Use list_services to discover configured services.",
			);
		}

		const idStrings = this.normalizeIdStrings(input.ids);
		const ids = this.normalizeNumericIds(idStrings);
		const dryRun = input.dryRun !== false;

		if (dryRun) {
			const preview = await service.previewManualImport(ids);
			if (!preview.ok || !preview.data) return preview;
			this.cleanupExpiredConfirmations();
			const token = randomUUID();
			this.pendingConfirmations.set(token, {
				scope: "manual_import",
				serviceName,
				ids: idStrings,
				preview: preview.data,
				createdAt: Date.now(),
			});
			return {
				ok: true,
				data: {
					mode: "dry_run",
					service: serviceName,
					preview: preview.data,
					confirmationToken: token,
					nextAction:
						"Call manual_import with dryRun:false and this confirmationToken to import only safe candidates.",
				},
			};
		}

		const token = input.confirmationToken;
		if (!token) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"confirmationToken is required to execute manual_import",
			);
		}
		const record = this.pendingConfirmations.get(token);
		if (record?.scope !== "manual_import") {
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
		if (
			record.serviceName !== serviceName ||
			!this.idsMatch(record.ids, idStrings)
		) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Service or IDs differ from dry run. Please repeat dry run.",
			);
		}
		this.pendingConfirmations.delete(token);
		const execution = await service.executeManualImport(record.preview);
		if (!execution.ok || !execution.data) return execution;
		return {
			ok: true,
			data: {
				mode: "execute",
				service: serviceName,
				result: execution.data,
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
				"Unknown service. Use list_services to discover configured services.",
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
		if (record?.scope !== "service") {
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

		if (
			record.removeFromDownloader !== removeFromDownloader ||
			record.downloaderName !== downloaderName ||
			record.downloaderDeleteData !== downloaderDeleteData
		) {
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
						message: `Downloader ${record.downloaderName} no longer available; ARR removal already executed`,
					},
				};
			}

			const removedIds = new Set(
				execution.data.details
					.filter((item) => item.status === "removed")
					.map((item) => item.id),
			);
			const downloadIds = record.downloaderDownloadIds.filter((id) => {
				const targets = record.preparation.targets.filter(
					(item) => item.downloadId === id,
				);
				return (
					targets.length > 0 && targets.every((item) => removedIds.has(item.id))
				);
			});

			if (downloadIds.length > 0) {
				const removal = await downloader.removeQueueItems(
					downloadIds,
					record.downloaderDeleteData,
				);
				if (!removal.ok || !removal.data) {
					return {
						ok: false,
						error: serializeError(removal.ok ? undefined : removal.error),
						data: { result: execution.data, downloaderResult: removal.data },
					};
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
			ok:
				execution.data.failed === 0 &&
				!downloaderResult?.details.some((item) => item.status === "failed"),
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
				"Unknown downloader. Use list_services to discover configured downloaders.",
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
		if (record?.scope !== "downloader") {
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
				ids.map((value) => String(value)).filter((value) => value.length > 0),
			),
		).sort((a, b) => a.localeCompare(b));
	}

	private normalizeNumericIds(idStrings: string[]): number[] {
		const numeric = idStrings.map((value) =>
			/^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN,
		);
		if (numeric.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
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
				console.error(`✅ Registered service: ${name}`);
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
					console.error(`✅ Registered downloader: ${name}`);
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
		console.error(
			`🚀 ARR MCP Server initialized with ${registeredServices.length} services: ${registeredServices.join(", ")}`,
		);
		if (registeredDownloaders.length > 0) {
			console.error(
				`📥 Registered ${registeredDownloaders.length} downloaders: ${registeredDownloaders.join(", ")}`,
			);
		}
	}

	async run() {
		const handle = serveStdio(({ era }) => this.buildServer(era), {
			legacy: "serve",
			onerror: () => console.error("MCP transport error"),
		});
		const close = () => {
			void handle.close();
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	}

	// Retain replay ownership per configured account without exposing credentials.
	#plexClients = new Map<string, PlexReportsClient>();

	private plexClient(): PlexReportsClient {
		const plex = plexConfigFromEnv();
		if (!plex) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Plex not configured: set PLEX_BASE_URL and PLEX_TOKEN.",
			);
		}
		const identity = JSON.stringify([plex.baseUrl, plex.token]);
		let client = this.#plexClients.get(identity);
		if (!client) {
			client = new PlexReportsClient(plex);
			this.#plexClients.set(identity, client);
		}
		return client;
	}

	private async handleReportedIssues(limit?: number, after?: string) {
		const client = this.plexClient();
		const result = await client.listReportsPage({ limit: limit ?? 25, after });
		if (!result.ok || !result.data) return result;

		const services = serviceRegistry.getAll();
		const reports = await resolveReports(client, result.data.reports, services);
		return {
			ok: true,
			data: {
				total: reports.length,
				provider: "plex",
				hasMore: result.data.hasMore,
				nextCursor: result.data.nextCursor,
				complete: result.data.complete,
				reports: reports.map((r) => ({
					id: r.id,
					message: r.message,
					date: r.date,
					user: r.user,
					item: r.item,
					matches: r.matches,
					comments: r.comments,
					commentsComplete: r.commentsComplete,
					commentCoverage: r.commentCoverage,
					resolved: r.resolved,
					resolutionState: r.resolutionState,
				})),
			},
		};
	}

	private async handleRemediateReportedIssue(input: RemediateInput) {
		const client = this.plexClient();
		if (!input.reportId || !input.action) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"reportId and action are required",
			);
		}

		const listResult = await client.listReports(100);
		if (!listResult.ok || !listResult.data) return listResult;
		const report = listResult.data.find((r) => r.id === input.reportId);
		if (!report) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Requested report not found.",
			);
		}

		const services = serviceRegistry.getAll();

		if (input.dryRun) {
			const plan = await planRemediation(
				client,
				report,
				input.action,
				input.service,
				services,
			);
			if (!plan.ok || !plan.data) return plan;
			const confirmationToken =
				input.action === "remove_and_regrab"
					? mintRemoveToken(input.reportId, plan.data)
					: undefined;
			return {
				ok: true,
				data: {
					dryRun: true,
					preview: plan.data,
					...(confirmationToken ? { confirmationToken } : {}),
				},
			};
		}

		return await executeRemediation(client, report, input, services);
	}

	private async handleUpdateQualityProfile(input: {
		service?: string;
		itemId?: number;
		qualityProfileId?: number;
	}) {
		if (
			!input.service ||
			input.itemId === undefined ||
			input.qualityProfileId === undefined
		) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"service, itemId and qualityProfileId are required",
			);
		}
		const service = serviceRegistry.get(input.service);
		if (!service) {
			throw new McpError(
				ErrorCode.InvalidParams,
				"Requested service not found. Use list_services to discover configured services.",
			);
		}
		return await service.updateQualityProfile(
			input.itemId,
			input.qualityProfileId,
		);
	}
}

async function main() {
	const server = new ArrMcpServer();
	const config = await loadRuntimeConfig();
	server.initialize(config);
	await server.run();
}

// Always execute main() - this is an MCP server meant to be run directly
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
	main().catch((error) => {
		console.error("💥 Failed to start ARR MCP Server:", error);
		process.exit(1);
	});
