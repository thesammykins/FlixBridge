import { z } from "zod";
import {
	buildUrl,
	createInternalError,
	fetchJson,
	handleError,
} from "../core.js";
import { debugOperation } from "../debug.js";
import { withMetrics } from "../metrics.js";
import type {
	AddData,
	AddRequest,
	GrabData,
	HistoryData,
	HistoryOptions,
	ImportIssueData,
	OperationResult,
	QualityProfileData,
	QueueData,
	QueueDiagnosticsData,
	QueueFixAction,
	QueueIssueAnalysis,
	QueueOptions,
	RemovalExecutionOptions,
	RemovalKind,
	RemovalPreparationData,
	RemovalResultData,
	RemovalResultItem,
	RemovalTargetDetails,
	RootFolderData,
	SearchData,
	SearchOptions,
	ServiceConfig,
	ServiceError,
	SystemStatusData,
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
	protocol?: string;
	downloadClient?: string;
	downloadClientName?: string;
	trackedDownloadState?: string;
	trackedDownloadStatus?: string;
}

interface ManualImportEpisode {
	id?: number;
}

interface ManualImportResource {
	id?: number;
	path?: string;
	relativePath?: string;
	folderName?: string;
	name?: string;
	series?: { id?: number };
	seasonNumber?: number;
	episodes?: ManualImportEpisode[];
	quality?: unknown;
	languages?: unknown[];
	releaseGroup?: string;
	downloadId?: string;
	customFormats?: unknown[];
	customFormatScore?: number;
	indexerFlags?: number;
	releaseType?: unknown;
	rejections?: Array<{ reason?: string }>;
}

interface ManualImportAttemptResult {
	attempted: boolean;
	success: boolean;
	message?: string;
}

interface ManualImportReprocessRequest {
	id?: number;
	path?: string;
	seriesId?: number;
	seasonNumber?: number;
	episodeIds?: number[];
	episodes?: ManualImportEpisode[];
	quality?: unknown;
	languages?: unknown[];
	releaseGroup?: string;
	downloadId?: string;
	customFormats?: unknown[];
	customFormatScore?: number;
	indexerFlags?: number;
	releaseType?: unknown;
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
	downloadId: z.string().optional(),
	outputPath: z.string().optional(),
	downloadClient: z.string().optional(),
	downloadClientName: z.string().optional(),
	trackedDownloadState: z.string().optional(),
	trackedDownloadStatus: z.string().optional(),
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

const SeriesSchema = z.object({
	id: z.number(),
	title: z.string(),
	monitored: z.boolean().optional(),
	path: z.string().optional(),
	statistics: z
		.object({
			episodeCount: z.number().optional(),
			episodeFileCount: z.number().optional(),
		})
		.optional(),
});

const MovieSchema = z.object({
	id: z.number(),
	title: z.string(),
	monitored: z.boolean().optional(),
	path: z.string().optional(),
	hasFile: z.boolean().optional(),
	sizeOnDisk: z.number().optional(),
	movieFile: z
		.object({
			id: z.number(),
			size: z.number().optional(),
			relativePath: z.string().optional(),
		})
		.optional(),
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
				downloadId: item.downloadId,
				outputPath: item.outputPath,
				downloadClient: item.downloadClient ?? item.downloadClientName,
				trackedDownloadState: item.trackedDownloadState,
				trackedDownloadStatus: item.trackedDownloadStatus,
				statusMessages: item.statusMessages,
				errorMessage: item.errorMessage,
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
				const queueResponse = await fetchJson(
					this.buildApiUrl("/queue", { pageSize: 250 }),
				);
				const queueData = QueueSchema.parse(queueResponse);

				const allItems = (queueData.records || []) as QueueRecord[];
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

	async prepareRemoval(
		kind: RemovalKind,
		ids: number[],
	): Promise<OperationResult<RemovalPreparationData>> {
		debugOperation(this.serviceName, "prepareRemoval", {
			kind,
			req: ids.length,
		});
		try {
			const normalizedIds = Array.from(
				new Set(
					ids
						.filter((id) => Number.isFinite(id))
						.map((id) => Math.trunc(Number(id))),
				),
			).filter((id) => id > 0);

			if (normalizedIds.length === 0) {
				return {
					ok: false,
					error: createInternalError(
						"No valid ids supplied for removal preparation",
					),
				};
			}

			if (kind === "queue") {
				const response = await fetchJson(
					this.buildApiUrl("/queue", { pageSize: 250 }),
				);
				const data = QueueSchema.parse(response);
				const recordMap = new Map<number, z.infer<typeof QueueItemSchema>>(
					data.records.map((record) => [record.id, record]),
				);

				const targets: RemovalTargetDetails[] = [];
				const missing: number[] = [];
				const notes: string[] = [];

				for (const id of normalizedIds) {
					const record = recordMap.get(id);
					if (!record) {
						missing.push(id);
						continue;
					}

					const flattenedMessages = [
						record.status,
						record.errorMessage,
						...(record.statusMessages?.flatMap((message) => [
							message.title,
							message.message,
							...(message.messages ?? []),
						]) ?? []),
					].filter((message): message is string => Boolean(message));
					const manualReviewRequired = flattenedMessages
						.map((message) => message.toLowerCase())
						.some((message) =>
							message.includes("manual investigation required"),
						);

					targets.push({
						id: record.id,
						source: "queue",
						title: record.title,
						mediaKind: this.mediaKind,
						status: record.status,
						downloadId: record.downloadId,
						path: record.outputPath,
						protocol: record.protocol,
						statusMessages: flattenedMessages,
						errorMessage: record.errorMessage,
						manualReviewRequired,
					});
				}

				targets.sort((a, b) => a.id - b.id);
				missing.sort((a, b) => a - b);

				if (missing.length > 0) {
					notes.push(
						`Queue ids not found on ${this.serviceName}: ${missing.join(", ")}`,
					);
				}

				return {
					ok: true,
					data: {
						service: this.serviceName,
						mediaKind: this.mediaKind,
						kind,
						requestedIds: normalizedIds,
						missingIds: missing,
						targets,
						notes: notes.length > 0 ? notes : undefined,
					},
				};
			}

			const targets: RemovalTargetDetails[] = [];
			const missing: number[] = [];

			for (const id of normalizedIds) {
				try {
					if (this.id === "sonarr") {
						const response = await fetchJson(this.buildApiUrl(`/series/${id}`));
						const series = SeriesSchema.parse(response);
						targets.push({
							id: series.id,
							source: "library",
							title: series.title,
							mediaKind: this.mediaKind,
							monitored: series.monitored,
							hasFile: (series.statistics?.episodeFileCount || 0) > 0,
							path: series.path,
						});
					} else {
						const response = await fetchJson(this.buildApiUrl(`/movie/${id}`));
						const movie = MovieSchema.parse(response);
						targets.push({
							id: movie.id,
							source: "library",
							title: movie.title,
							mediaKind: this.mediaKind,
							monitored: movie.monitored,
							hasFile: movie.hasFile ?? Boolean(movie.movieFile),
							path: movie.path,
						});
					}
				} catch (error) {
					if (this.isNotFoundError(error)) {
						missing.push(id);
						continue;
					}
					return handleError(error, this.serviceName);
				}
			}

			targets.sort((a, b) => a.id - b.id);
			missing.sort((a, b) => a - b);

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					kind,
					requestedIds: normalizedIds,
					missingIds: missing,
					targets,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async executeRemoval(
		preparation: RemovalPreparationData,
		options: RemovalExecutionOptions,
	): Promise<OperationResult<RemovalResultData>> {
		debugOperation(this.serviceName, "executeRemoval", {
			kind: preparation.kind,
			attempts: preparation.targets.length,
		});
		try {
			const details: RemovalResultItem[] = [];
			let removed = 0;
			let failed = 0;
			let manualImportSuccesses = 0;
			const manualImportFailures: string[] = [];

			for (const target of preparation.targets) {
				let manualImportNote: string | undefined;
				let manualImportAttempted = false;
				let manualImportSucceeded = false;

				if (
					target.source === "queue" &&
					options.attemptManualImport !== false
				) {
					const manualResult = await this.tryManualImport(target);
					manualImportAttempted = manualResult.attempted;
					if (manualResult.success) {
						manualImportSucceeded = true;
						manualImportNote =
							manualResult.message ?? "Manual import completed";
						manualImportSuccesses += 1;
					} else if (manualResult.message) {
						manualImportNote = manualResult.message;
						if (manualResult.attempted) {
							manualImportFailures.push(manualResult.message);
						}
					}
				}

				try {
					if (target.source === "queue") {
						try {
							await this.removeFromQueue(target.id, {
								removeFromClient: options.removeFromClient ?? true,
								blocklist: options.blocklist ?? false,
								queueTimeoutMs: options.queueTimeoutMs,
							});
						} catch (error) {
							if (!(manualImportSucceeded && this.isNotFoundError(error))) {
								throw error;
							}
						}
					} else {
						await this.removeLibraryItem(target.id, {
							deleteFiles: options.deleteFiles ?? false,
							addImportExclusion: options.addImportExclusion ?? false,
						});
					}

					removed += 1;
					details.push({
						id: target.id,
						title: target.title,
						source: target.source,
						status: "removed",
						message: manualImportNote,
					});
				} catch (error) {
					failed += 1;
					const failureMessage = manualImportNote
						? `${manualImportNote}; ${this.describeError(error)}`
						: this.describeError(error);
					details.push({
						id: target.id,
						title: target.title,
						source: target.source,
						status: "failed",
						message: failureMessage,
					});
				}
			}

			const skipped = preparation.missingIds.length;

			const notes: string[] = [];
			if (preparation.notes && preparation.notes.length > 0) {
				notes.push(...preparation.notes);
			}
			if (failed > 0) {
				notes.push(
					`Failed to remove ${failed} item(s) from ${this.serviceName}. Check details for reasons.`,
				);
			}
			if (skipped > 0) {
				notes.push(
					`${skipped} item(s) were skipped because they were not present during preparation.`,
				);
			}
			if (manualImportSuccesses > 0) {
				notes.push(
					`Manual import completed for ${manualImportSuccesses} queue item(s) before removal.`,
				);
			}
			if (manualImportFailures.length > 0) {
				notes.push(
					`Manual import could not be completed for ${manualImportFailures.length} queue item(s): ${manualImportFailures
						.map((message) => message.replace(/;.+$/, ""))
						.join(" | ")}`,
				);
			}

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					kind: preparation.kind,
					removed,
					failed,
					skipped,
					missingIds: preparation.missingIds,
					details,
					notes: notes.length > 0 ? notes : undefined,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	private analyzeQueueItem(item: QueueRecord): QueueIssueAnalysis {
		const status = item.status?.toLowerCase() || "";
		const statusMessages = item.statusMessages || [];
		const errorMessage = item.errorMessage || "";
		const flattenedStatusMessages = statusMessages
			.flatMap((m: StatusMessage) => [
				m.title,
				m.message,
				...(m.messages || []),
			])
			.filter((message): message is string => Boolean(message));
		const baseAnalysis = {
			id: item.id,
			title: item.title,
			status: item.status,
			protocol: item.protocol,
			downloadClient: item.downloadClient ?? item.downloadClientName,
			trackedDownloadState: item.trackedDownloadState,
			trackedDownloadStatus: item.trackedDownloadStatus,
			statusMessages: flattenedStatusMessages,
			errorMessage: item.errorMessage,
		};
		const allMessages = [status, ...flattenedStatusMessages, errorMessage]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();

		// TheXEM mapping issues
		if (allMessages.includes("thexem") && allMessages.includes("mapping")) {
			return {
				...baseAnalysis,
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
				...baseAnalysis,
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
				...baseAnalysis,
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
				...baseAnalysis,
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
				...baseAnalysis,
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
				...baseAnalysis,
				category: { type: "unknown", severity: "warning", autoFixable: false },
				message: "Item appears stuck with unrecognized issue",
				suggestedAction: "Manual investigation required",
			};
		}

		// No issues detected
		return {
			...baseAnalysis,
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
				case "mapping": {
					const manualResult = await this.tryManualImport({
						id: item.id,
						source: "queue",
						title: item.title,
						mediaKind: this.mediaKind,
						status: item.status,
						downloadId: item.downloadId,
						path: item.outputPath,
						protocol: item.protocol,
					});
					return {
						...baseAction,
						action: "manual_import",
						attempted: manualResult.attempted,
						success: manualResult.success,
						error: manualResult.success ? undefined : manualResult.message,
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

				default: {
					if (this.shouldAttemptManualImport(analysis, item)) {
						const manualResult = await this.tryManualImport({
							id: item.id,
							source: "queue",
							title: item.title,
							mediaKind: this.mediaKind,
							status: item.status,
							downloadId: item.downloadId,
							path: item.outputPath,
							protocol: item.protocol,
						});
						return {
							...baseAction,
							action: "manual_import",
							attempted: manualResult.attempted,
							success: manualResult.success,
							error: manualResult.success ? undefined : manualResult.message,
						};
					}
					return {
						...baseAction,
						attempted: false,
					};
				}
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

	private async removeFromQueue(
		queueId: number,
		options: {
			removeFromClient?: boolean;
			blocklist?: boolean;
			queueTimeoutMs?: number;
		} = {},
	): Promise<void> {
		const removeFromClient = options.removeFromClient ?? true;
		const blocklist = options.blocklist ?? false;
		let attempt = 0;
		let timeoutMs = Math.max(
			1000,
			Math.min(options.queueTimeoutMs ?? 5000, 60000),
		);

		for (;;) {
			try {
				await fetchJson(this.buildApiUrl(`/queue/${queueId}`), {
					method: "DELETE",
					body: JSON.stringify({
						removeFromClient,
						blocklist,
					}),
					headers: { "Content-Type": "application/json" },
					timeoutMs,
				});
				return;
			} catch (error) {
				if (this.isTimeoutServiceError(error) && attempt === 0) {
					attempt += 1;
					timeoutMs = Math.min(timeoutMs * 2, 20000);
					continue;
				}
				throw error;
			}
		}
	}

	private async removeLibraryItem(
		itemId: number,
		options: { deleteFiles: boolean; addImportExclusion: boolean },
	): Promise<void> {
		const params: Record<string, string> = {
			deleteFiles: options.deleteFiles ? "true" : "false",
		};

		if (this.id === "sonarr") {
			params.addImportListExclusion = options.addImportExclusion
				? "true"
				: "false";
			await fetchJson(this.buildApiUrl(`/series/${itemId}`, params), {
				method: "DELETE",
			});
		} else {
			params.addImportExclusion = options.addImportExclusion ? "true" : "false";
			await fetchJson(this.buildApiUrl(`/movie/${itemId}`, params), {
				method: "DELETE",
			});
		}
	}

	private isNotFoundError(error: unknown): boolean {
		return (
			error !== null &&
			typeof error === "object" &&
			"status" in error &&
			typeof (error as ServiceError).status === "number" &&
			(error as ServiceError).status === 404
		);
	}

	private describeError(error: unknown): string {
		if (error && typeof error === "object") {
			if (
				"message" in error &&
				typeof (error as { message: unknown }).message === "string"
			) {
				const msg = (error as { message: string }).message;
				if (
					"status" in error &&
					typeof (error as ServiceError).status === "number"
				) {
					return `${(error as ServiceError).status} ${msg}`;
				}
				return msg;
			}
			if (
				"status" in error &&
				typeof (error as ServiceError).status === "number"
			) {
				return `${(error as ServiceError).status} error`;
			}
		}

		if (error instanceof Error) {
			return error.message;
		}

		return "Unknown error";
	}

	private shouldAttemptManualImport(
		analysis: QueueIssueAnalysis,
		item: QueueRecord,
	): boolean {
		const segments: string[] = [analysis.message, analysis.suggestedAction];
		if (item.errorMessage) {
			segments.push(item.errorMessage);
		}
		for (const statusMessage of item.statusMessages ?? []) {
			if (statusMessage.message) segments.push(statusMessage.message);
			if (statusMessage.title) segments.push(statusMessage.title);
			if (statusMessage.messages) segments.push(...statusMessage.messages);
		}
		const combined = segments
			.filter((segment): segment is string => Boolean(segment))
			.join(" ")
			.toLowerCase();
		return (
			combined.includes("manual import") ||
			combined.includes("automatic import is not possible") ||
			combined.includes("manual investigation required")
		);
	}

	private async tryManualImport(
		target: RemovalTargetDetails,
	): Promise<ManualImportAttemptResult> {
		if (!target.downloadId) {
			return {
				attempted: false,
				success: false,
				message: "Manual import skipped: missing download id",
			};
		}

		const params: Record<string, string> = { filterExistingFiles: "false" };
		params.downloadId = target.downloadId;
		if (target.path) {
			params.folder = target.path;
		}

		let candidates: ManualImportResource[];
		try {
			candidates = await fetchJson(this.buildApiUrl("/manualimport", params));
		} catch (error) {
			return {
				attempted: true,
				success: false,
				message: this.describeError(error),
			};
		}

		if (!Array.isArray(candidates) || candidates.length === 0) {
			return {
				attempted: true,
				success: false,
				message: "Manual import unavailable: no candidates returned",
			};
		}

		const viableCandidate = candidates.find((candidate) => {
			return (
				candidate.series?.id &&
				!(candidate.rejections && candidate.rejections.length > 0)
			);
		});

		if (!viableCandidate) {
			const rejectionReasons = candidates
				.flatMap((candidate) => candidate.rejections ?? [])
				.map((rejection) => rejection.reason)
				.filter((reason): reason is string => Boolean(reason));
			return {
				attempted: true,
				success: false,
				message:
					rejectionReasons.length > 0
						? `Manual import rejected: ${rejectionReasons.join("; ")}`
						: "Manual import rejected by Sonarr",
			};
		}

		const manualImportRequest = this.buildManualImportRequest(
			viableCandidate,
			target,
		);

		if (!manualImportRequest.seriesId) {
			return {
				attempted: true,
				success: false,
				message: "Manual import skipped: candidate missing series information",
			};
		}

		try {
			await fetchJson(this.buildApiUrl("/manualimport"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify([manualImportRequest]),
			});
			return {
				attempted: true,
				success: true,
				message: "Manual import triggered",
			};
		} catch (error) {
			return {
				attempted: true,
				success: false,
				message: this.describeError(error),
			};
		}
	}

	private buildManualImportRequest(
		candidate: ManualImportResource,
		target: RemovalTargetDetails,
	): ManualImportReprocessRequest {
		const episodeIds = (candidate.episodes || [])
			.map((episode) => episode.id)
			.filter((id): id is number => typeof id === "number");
		const request: ManualImportReprocessRequest = {
			id: candidate.id,
			path: candidate.path || candidate.relativePath || target.path,
			seriesId: candidate.series?.id,
			seasonNumber: candidate.seasonNumber,
			episodeIds: episodeIds.length > 0 ? episodeIds : undefined,
			episodes:
				candidate.episodes && candidate.episodes.length > 0
					? candidate.episodes
					: undefined,
			quality: candidate.quality,
			languages: candidate.languages,
			releaseGroup: candidate.releaseGroup,
			downloadId: candidate.downloadId ?? target.downloadId,
			customFormats: candidate.customFormats,
			customFormatScore: candidate.customFormatScore,
			indexerFlags: candidate.indexerFlags,
			releaseType: candidate.releaseType,
		};
		if (!request.path && target.path) {
			request.path = target.path;
		}
		return request;
	}

	private async retryQueueItem(queueId: number): Promise<void> {
		// Refresh/retry the queue item
		await fetchJson(this.buildApiUrl(`/queue/refresh/${queueId}`), {
			method: "POST",
		});
	}

	private isTimeoutServiceError(error: unknown): boolean {
		return (
			error !== null &&
			typeof error === "object" &&
			"status" in error &&
			typeof (error as ServiceError).status === "number" &&
			(error as ServiceError).status === 0 &&
			"message" in error &&
			typeof (error as { message?: unknown }).message === "string" &&
			/(timeout|timed out)/i.test((error as { message: string }).message)
		);
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
