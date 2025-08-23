import { z } from "zod";
import { fetchJson, buildUrl, handleError } from "../core.js";
import { debugOperation } from "../debug.js";
import { withMetrics } from "../metrics.js";
import type {
	ServiceConfig,
	OperationResult,
	SystemStatusData,
	QueueOptions,
	QueueData,
	GrabData,
	RootFolderData,
	HistoryOptions,
	HistoryData,
	SearchOptions,
	SearchData,
	AddRequest,
	AddData,
	ImportIssueData,
	QualityProfileData,
	QueueDiagnosticsData,
	QueueIssueAnalysis,
	QueueFixAction,
} from "./base.js";

// API Response Types
interface HistoryResponse {
	records: HistoryRecord[];
	page?: number;
	pageSize?: number;
	totalRecords?: number;
}

interface HistoryRecord {
	id: number;
	sourceTitle?: string;
	title: string;
	quality?: { quality?: { name?: string } };
	date: string;
	eventType: string;
}

interface SearchResponse {
	length?: number;
	slice: (start: number, end?: number) => SearchRecord[];
}

interface SearchRecord {
	tvdbId?: number;
	tmdbId?: number;
	title: string;
	year?: number;
	overview?: string;
	imdbId?: string;
}

interface QualityProfile {
	id: number;
	name: string;
	upgradeAllowed?: boolean;
	cutoff?: number;
}

interface AddResponse {
	id?: number;
	title: string;
	monitored?: boolean;
	path?: string;
}

interface WantedResponse {
	records: WantedRecord[];
}

interface WantedRecord {
	id: number;
	title: string;
	airDateUtc?: string;
}

interface StatusMessage {
	title?: string;
	message?: string;
	messages?: string[];
}

interface QueueRecord {
	id: number;
	title: string;
	status: string;
	statusMessages?: StatusMessage[];
	errorMessage?: string;
	downloadId?: string;
	outputPath?: string;
}

const StatusSchema = z.object({
	appName: z.string(),
	instanceName: z.string().optional(),
	version: z.string(),
	startTime: z.string().optional(),
});

const QueueStatusSchema = z.union([
	z.literal("queued"),
	z.literal("paused"),
	z.literal("downloading"),
	z.literal("completed"),
	z.literal("failed"),
	z.literal("warning"),
	z.literal("delay"),
	z.literal("downloadClientUnavailable"),
	z.literal("fallback"),
	z.string(), // fallback for unknown statuses
]);

const QueueItemSchema = z.object({
	id: z.number(),
	title: z.string(),
	status: QueueStatusSchema,
	size: z.number().optional(),
	sizeleft: z.number().optional(),
	protocol: z.string().optional(),
	estimatedCompletionTime: z.string().optional(),
	statusMessages: z
		.array(
			z.object({
				title: z.string().optional(),
				message: z.string().optional(),
				messages: z.array(z.string()).optional(),
			}),
		)
		.optional(),
	errorMessage: z.string().optional(),
});

const QueueSchema = z.object({
	totalRecords: z.number().optional(),
	records: z.array(QueueItemSchema),
});

const FolderSchema = z.object({
	id: z.number(),
	path: z.string(),
	freeSpace: z.number().optional(),
	accessible: z.boolean().optional(),
});

export abstract class BaseArrService {
	abstract readonly id: "sonarr" | "radarr";
	abstract readonly mediaKind: "series" | "movie";
	abstract readonly endpoints: {
		lookup: string;
		add: string;
		wanted: string;
	};

	readonly serviceName: string;
	private readonly baseUrl: string;
	private readonly apiKey: string;

	constructor(serviceName: string, config: ServiceConfig) {
		this.serviceName = serviceName;
		this.baseUrl = config.baseUrl;
		this.apiKey = config.apiKey;
	}

	private buildApiUrl(
		endpoint: string,
		params: Record<string, string | number> = {},
	): string {
		const allParams = { apikey: this.apiKey, ...params };
		return buildUrl(this.baseUrl, `/api/v3${endpoint}`, allParams);
	}

	async systemStatus(): Promise<OperationResult<SystemStatusData>> {
		const operation = withMetrics(
			this.serviceName,
			"systemStatus",
			async () => {
				debugOperation(this.serviceName, "systemStatus");
				const response = await fetchJson(this.buildApiUrl("/system/status"));
				const data = StatusSchema.parse(response);

				return {
					ok: true,
					data: {
						service: this.serviceName,
						name: data.instanceName || data.appName,
						version: data.version,
						isHealthy: true,
					},
				};
			},
		);

		try {
			return await operation();
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async queueList(
		options: QueueOptions = {},
	): Promise<OperationResult<QueueData>> {
		try {
			const params: Record<string, string | number> = {};
			if (options.page) params.page = options.page;
			if (options.pageSize) params.pageSize = options.pageSize;
			if (options.sortKey) params.sortKey = options.sortKey;
			if (options.sortDirection) params.sortDirection = options.sortDirection;

			const response = await fetchJson(this.buildApiUrl("/queue", params));
			const data = QueueSchema.parse(response);

			const items = data.records.map((item) => ({
				id: item.id,
				title: item.title,
				status: item.status,
				progressPct:
					item.size && item.sizeleft
						? Math.round(((item.size - item.sizeleft) / item.size) * 100)
						: undefined,
				mediaKind: this.mediaKind,
				protocol: item.protocol,
				estimatedCompletionTime: item.estimatedCompletionTime,
			}));

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					total: data.totalRecords || data.records.length,
					items,
					truncated: false,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async queueGrab(ids: number[]): Promise<OperationResult<GrabData>> {
		debugOperation(this.serviceName, "queueGrab", {
			ids: ids.slice(0, 5),
			count: ids.length,
		});
		try {
			if (ids.length === 0) {
				throw new Error("No IDs provided");
			}

			if (ids.length === 1) {
				await fetchJson(this.buildApiUrl(`/queue/grab/${ids[0]}`), {
					method: "POST",
				});
			} else {
				await fetchJson(this.buildApiUrl("/queue/grab/bulk"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ids }),
				});
			}

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					grabbed: ids.length,
					ids,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async rootFolderList(): Promise<OperationResult<RootFolderData>> {
		const operation = withMetrics(
			this.serviceName,
			"rootFolderList",
			async () => {
				debugOperation(this.serviceName, "rootFolderList");
				const response = await fetchJson(this.buildApiUrl("/rootfolder"));
				const folders = z.array(FolderSchema).parse(response);

				const folderData = folders.map((f) => ({
					id: f.id,
					path: f.path,
					freeSpaceBytes: f.freeSpace || 0,
				}));

				return {
					ok: true,
					data: {
						service: this.serviceName,
						mediaKind: this.mediaKind,
						total: folderData.length,
						folders: folderData,
						defaultId: folderData[0]?.id || 1,
					},
				};
			},
		);

		try {
			return await operation();
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async historyDetail(
		options: HistoryOptions = {},
	): Promise<OperationResult<HistoryData>> {
		try {
			const params: Record<string, string | number> = {};
			if (options.page) params.page = options.page;
			if (options.pageSize) params.pageSize = options.pageSize;
			if (options.since) params.since = options.since;

			const response: HistoryResponse = await fetchJson(
				this.buildApiUrl("/history", params),
			);
			const records = response.records || [];

			const items = records.slice(0, 20).map((item: HistoryRecord) => ({
				id: item.id,
				title: item.sourceTitle || item.title,
				quality: item.quality?.quality?.name || "Unknown",
				date: item.date,
				eventType: item.eventType,
				mediaKind: this.mediaKind,
			}));

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					total: response.totalRecords || records.length,
					items,
					truncated: records.length > 20,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async search(
		query: string,
		options: SearchOptions = {},
	): Promise<OperationResult<SearchData>> {
		debugOperation(this.serviceName, "search", {
			query: query.substring(0, 50),
			limit: options.limit,
		});
		try {
			const limit = options.limit || 10;
			const params = { term: query };
			const response: SearchResponse = await fetchJson(
				this.buildApiUrl(this.endpoints.lookup, params),
			);
			const results = Array.isArray(response) ? response : [];
			const limitedResults = results.slice(0, limit);

			const searchResults = limitedResults.map((item: SearchRecord) => ({
				id: this.id === "sonarr" ? item.tvdbId : item.tmdbId,
				title: item.title,
				year: item.year,
				overview: item.overview,
				mediaKind: this.mediaKind,
				foreignId: this.id === "sonarr" ? item.tvdbId : item.tmdbId,
				imdbId: item.imdbId,
			}));

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					total: results.length,
					results: searchResults,
					truncated: results.length > limit,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async addNew(request: AddRequest): Promise<OperationResult<AddData>> {
		const operation = withMetrics(this.serviceName, "addNew", async () => {
			debugOperation(this.serviceName, "addNew", {
				title: request.title,
				foreignId: request.foreignId,
			});

			// Get quality profile if not provided
			let qualityProfileId = request.qualityProfileId;
			if (!qualityProfileId) {
				const profiles: QualityProfile[] = await fetchJson(
					this.buildApiUrl("/qualityprofile"),
				);

				if (!profiles || profiles.length === 0) {
					throw new Error("No quality profiles available");
				}

				// Smart quality profile detection based on service name and available profiles
				const selectedProfileId = this.selectBestQualityProfile(profiles);
				qualityProfileId = selectedProfileId ?? undefined;

				if (!qualityProfileId) {
					throw new Error(
						`Unable to auto-select quality profile for ${this.serviceName}. Available profiles: ${profiles.map((p: QualityProfile) => `${p.name} (id: ${p.id})`).join(", ")}. Please specify qualityProfileId explicitly.`,
					);
				}
			}

			const addPayload = {
				title: request.title,
				[this.id === "sonarr" ? "tvdbId" : "tmdbId"]: request.foreignId,
				rootFolderPath: request.rootFolderPath,
				qualityProfileId,
				monitored: request.monitored ?? true,
				...(this.id === "sonarr"
					? {
							seasonFolder: true,
							addOptions: { searchForMissingEpisodes: false },
						}
					: { addOptions: { searchForMovie: false } }),
			};

			const response: AddResponse = await fetchJson(
				this.buildApiUrl(this.endpoints.add),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(addPayload),
				},
			);

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					added: true,
					id: response.id,
					title: response.title,
					existing: false,
				},
			};
		});

		try {
			return await operation();
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async importIssues(): Promise<OperationResult<ImportIssueData>> {
		debugOperation(this.serviceName, "importIssues");
		try {
			const response: WantedResponse = await fetchJson(
				this.buildApiUrl(this.endpoints.wanted),
			);
			const records = response.records || [];

			const issues = records.slice(0, 10).map((item: WantedRecord) => ({
				id: item.id,
				title: item.title,
				reason: `Missing ${this.mediaKind === "series" ? "episode" : "movie file"}`,
				ageMinutes: 0,
			}));

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					issues,
					summary: {
						total: records.length,
						stuckPending: issues.length,
						failedImport: 0,
					},
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async listQualityProfiles(): Promise<OperationResult<QualityProfileData>> {
		debugOperation(this.serviceName, "listQualityProfiles");
		try {
			const response: QualityProfile[] = await fetchJson(
				this.buildApiUrl("/qualityprofile"),
			);
			const profiles = Array.isArray(response) ? response : [];

			const profileData = profiles.map((profile: QualityProfile) => ({
				id: profile.id,
				name: profile.name,
				upgradeAllowed: profile.upgradeAllowed,
				cutoff: profile.cutoff,
			}));

			const recommendedId = this.selectBestQualityProfile(profiles);

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					total: profileData.length,
					profiles: profileData,
					recommended: recommendedId ?? undefined,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async queueDiagnostics(
		autoFix = true,
	): Promise<OperationResult<QueueDiagnosticsData>> {
		const operation = withMetrics(
			this.serviceName,
			"queueDiagnostics",
			async () => {
				debugOperation(this.serviceName, "queueDiagnostics");
				// Get current queue with detailed status
				const queueResponse = await fetchJson(this.buildApiUrl("/queue"));
				const queueData = QueueSchema.parse(queueResponse);

				const allItems = queueData.records || [];
				const issuesAnalyzed: QueueIssueAnalysis[] = [];
				const fixesAttempted: QueueFixAction[] = [];

				for (const item of allItems) {
					const analysis = this.analyzeQueueItem(item);

					// Include all real issues - exclude only "unknown" type with "info" severity
					const isRealIssue = !(
						analysis.category.type === "unknown" &&
						analysis.category.severity === "info"
					);

					if (isRealIssue) {
						issuesAnalyzed.push(analysis);

						// Attempt auto-fix if possible and enabled
						if (autoFix && analysis.category.autoFixable) {
							const fixAction = await this.attemptAutoFix(item, analysis);
							fixesAttempted.push(fixAction);
						}
					}
				}

				const summary = {
					fixed: fixesAttempted.filter((f) => f.success === true).length,
					failed: fixesAttempted.filter((f) => f.success === false).length,
					requiresManual: issuesAnalyzed.filter((i) => !i.category.autoFixable)
						.length,
				};

				return {
					ok: true,
					data: {
						service: this.serviceName,
						mediaKind: this.mediaKind,
						totalQueueItems: allItems.length,
						issuesFound: issuesAnalyzed.length,
						issuesAnalyzed,
						fixesAttempted,
						summary,
					},
				};
			},
		);

		try {
			return await operation();
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	private analyzeQueueItem(item: QueueRecord): QueueIssueAnalysis {
		const status = item.status?.toLowerCase() || "";
		const statusMessages = item.statusMessages || [];
		const errorMessage = item.errorMessage || "";
		const allMessages = [
			status,
			...statusMessages.map((m: StatusMessage) => m.title || m.message || ""),
			...statusMessages.flatMap((m: StatusMessage) => m.messages || []),
			errorMessage,
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();

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
		return {
			id: item.id,
			title: item.title,
			status: item.status,
			category: { type: "unknown", severity: "info", autoFixable: false },
			message: "No issues detected",
			suggestedAction: "No action needed",
		};
	}

	private async attemptAutoFix(
		item: QueueRecord,
		analysis: QueueIssueAnalysis,
	): Promise<QueueFixAction> {
		const baseAction: Omit<QueueFixAction, "attempted" | "success" | "error"> =
			{
				id: item.id,
				action: "ignore",
				reason: analysis.message,
			};

		try {
			switch (analysis.category.type) {
				case "mapping":
					// For TheXEM mapping issues, try manual import
					try {
						await this.triggerManualImport(item.id);
						return {
							...baseAction,
							action: "manual_import",
							attempted: true,
							success: true,
						};
					} catch (error) {
						return {
							...baseAction,
							action: "manual_import",
							attempted: true,
							success: false,
							error:
								error instanceof Error ? error.message : "Manual import failed",
						};
					}

				case "quality_downgrade":
					// For quality downgrades, remove from queue
					try {
						await this.removeFromQueue(item.id);
						return {
							...baseAction,
							action: "remove_from_queue",
							attempted: true,
							success: true,
						};
					} catch (error) {
						return {
							...baseAction,
							action: "remove_from_queue",
							attempted: true,
							success: false,
							error:
								error instanceof Error
									? error.message
									: "Remove from queue failed",
						};
					}

				case "network_error":
					// For network errors, try to refresh/retry
					try {
						await this.retryQueueItem(item.id);
						return {
							...baseAction,
							action: "retry_download",
							attempted: true,
							success: true,
						};
					} catch (error) {
						return {
							...baseAction,
							action: "retry_download",
							attempted: true,
							success: false,
							error: error instanceof Error ? error.message : "Retry failed",
						};
					}

				default:
					return {
						...baseAction,
						attempted: false,
					};
			}
		} catch (error) {
			return {
				...baseAction,
				attempted: true,
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Unknown error during fix attempt",
			};
		}
	}

	private async triggerManualImport(queueId: number): Promise<void> {
		// Trigger manual import for stuck items
		await fetchJson(this.buildApiUrl(`/queue/${queueId}/manual`), {
			method: "POST",
		});
	}

	private async removeFromQueue(queueId: number): Promise<void> {
		// Remove item from queue
		await fetchJson(this.buildApiUrl(`/queue/${queueId}`), {
			method: "DELETE",
			body: JSON.stringify({
				removeFromClient: true,
				blocklist: false,
			}),
			headers: { "Content-Type": "application/json" },
		});
	}

	private async retryQueueItem(queueId: number): Promise<void> {
		// Refresh/retry the queue item
		await fetchJson(this.buildApiUrl(`/queue/refresh/${queueId}`), {
			method: "POST",
		});
	}

	private selectBestQualityProfile(profiles: QualityProfile[]): number | null {
		// Sort profiles by preference based on service name patterns and common naming
		const serviceName = this.serviceName.toLowerCase();

		// Define quality profile preferences based on service naming patterns
		const qualityPreferences = [
			// 4K/UHD service patterns
			...(serviceName.includes("4k") ||
			serviceName.includes("uhd") ||
			serviceName.includes("2160")
				? [/4k|uhd|2160p?/i, /ultra.*hd|hd.*ultra/i]
				: []),

			// HD/1080p service patterns
			...(serviceName.includes("hd") || serviceName.includes("1080")
				? [/1080p?|hd(?!\s*4k)/i, /high.*def|def.*high/i]
				: []),

			// Anime-specific patterns
			...(serviceName.includes("anime") ? [/anime/i] : []),

			// General fallback patterns (prefer common resolutions)
			/1080p?/i,
			/720p?/i,
			/any|default|standard/i,
		];

		// Try to find a profile matching our preferences
		for (const pattern of qualityPreferences) {
			const matchingProfile = profiles.find((profile: QualityProfile) =>
				pattern.test(profile.name),
			);
			if (matchingProfile) {
				return matchingProfile.id;
			}
		}

		// If no smart match found, use the first profile but only if there's exactly one
		// This prevents accidentally selecting a random profile when multiple exist
		if (profiles.length === 1) {
			return profiles[0]?.id || null;
		}

		// Multiple profiles available but no smart match - require explicit selection
		return null;
	}
}
