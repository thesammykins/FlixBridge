import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
	buildUrl,
	createInternalError,
	fetchJson,
	handleError,
} from "../core.js";
import { debugOperation } from "../debug.js";
import { withMetrics } from "../metrics.js";
import { requestSignal } from "../request-context.js";
import type {
	AddData,
	AddRequest,
	EpisodeFileMatch,
	EpisodeLookupData,
	FileDeleteData,
	GrabData,
	HistoryData,
	HistoryOptions,
	ImportIssueData,
	LibraryItemMatch,
	LibraryLookupData,
	LibraryStatisticsData,
	ManualImportCandidatePreview,
	ManualImportExecutionData,
	ManualImportPreviewData,
	ManualImportPreviewItem,
	OperationResult,
	QualityProfileData,
	QualityProfileUpdateData,
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
	SearchTriggerData,
	ServiceConfig,
	ServiceError,
	SystemStatusData,
} from "./base.js";

// API Response Types
// GET /qualityprofile — fields consumed by profile selection and tool output.
const QualityProfileBoundarySchema = z.object({
	id: z.number(),
	name: z.string(),
	upgradeAllowed: z.boolean().optional(),
	cutoff: z.number().optional(),
});
const QualityProfileBoundaryArraySchema = z.array(QualityProfileBoundarySchema);

// Library list response (Sonarr /series, Radarr /movie) — validated at the
// boundary; only the fields we consume are modeled.
const LibraryItemSchema = z.object({
	id: z.number(),
	title: z.string().optional(),
	year: z.number().optional(),
	path: z.string().optional(),
	hasFile: z.boolean().optional(),
	qualityProfileId: z.number().optional(),
	statistics: z
		.object({ episodeFileCount: z.number().optional() })
		.nullable()
		.optional(),
	movieFile: z.object({ id: z.number().optional() }).nullable().optional(),
});

const LibraryItemArraySchema = z.array(LibraryItemSchema);

// GET /rootfolder — only the path field is consumed.
const RootFolderSchema = z.object({ path: z.string() });
const RootFolderArraySchema = z.array(RootFolderSchema);

const SearchArraySchema = z.array(
	z.object({
		tvdbId: z.number().optional(),
		tmdbId: z.number().optional(),
		title: z.string(),
		year: z.number().optional(),
		overview: z.string().nullish(),
		imdbId: z.string().nullish(),
	}),
);
const HistorySchema = z.object({
	records: z
		.array(
			z.object({
				id: z.number().int().positive().safe(),
				sourceTitle: z.string().nullish(),
				title: z.string().nullish(),
				quality: z
					.object({
						quality: z.object({ name: z.string().optional() }).nullish(),
					})
					.nullish(),
				date: z.string(),
				eventType: z.string(),
			}),
		)
		.refine(
			(records) =>
				new Set(records.map((record) => record.id)).size === records.length,
		),
	totalRecords: z.number().int().nonnegative().safe().optional(),
});
const ManualImportSchema = z.array(
	z
		.object({
			id: z.number().optional(),
			path: z.string().optional(),
			series: z.object({ id: z.number().optional() }).nullish(),
			movie: z.object({ id: z.number().optional() }).nullish(),
			seasonNumber: z.number().nullish(),
			episodes: z.array(z.object({ id: z.number().optional() })).nullish(),
			rejections: z
				.array(
					z.object({
						reason: z.string().optional(),
						message: z.string().nullish(),
						type: z.string().optional(),
					}),
				)
				.nullish(),
		})
		.passthrough(),
);

// A library item that must round-trip unchanged (updateQualityProfile PUTs the
// full object back). Validate that it's an object with an id without stripping
// unknown fields: z.record keeps everything, passthrough preserves shape.
const LooseItemSchema = z
	.record(z.string(), z.unknown())
	.refine((v) => v && typeof v.id === "number", {
		message: "item must be an object with a numeric id",
	});

// Sonarr GET /episode — fields consumed by episode-file remediation.
// Live Sonarr (4.0.x) list responses carry the flat episodeFileId and no
// nested episodeFile object; both are modeled so older/newer shapes resolve.
const EpisodeSchema = z.object({
	id: z.number(),
	episodeFileId: z.number().optional(),
	episodeFile: z.object({ id: z.number().optional() }).nullable().optional(),
	seasonNumber: z.number().optional(),
	episodeNumber: z.number().optional(),
	title: z.string().optional(),
	hasFile: z.boolean().optional(),
});
const EpisodeArraySchema = z.array(EpisodeSchema);

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
	seriesId?: number | null;
	episodeId?: number | null;
	episodeIds?: number[];
	seasonNumbers?: number[];
	episodesWithFilesCount?: number;
	isFullSeason?: boolean;

	id: number;
	title: string;
	status: string;
	size?: number;
	sizeleft?: number;
	statusMessages?: StatusMessage[];
	errorMessage?: string | null;
	estimatedCompletionTime?: string | null;
	downloadId?: string | null;
	outputPath?: string | null;
	protocol?: string | null;
	downloadClient?: string | null;
	downloadClientName?: string | null;
	trackedDownloadState?: string | null;
	trackedDownloadStatus?: string | null;
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
	movie?: { id?: number };
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
	rejections?: Array<{
		reason?: string;
		message?: string | null;
		type?: string;
	}>;
}

interface ManualImportAttemptResult {
	attempted: boolean;
	success: boolean;
	message?: string;
}

interface ManualImportCommandRequest {
	name: "ManualImport";
	files: ManualImportReprocessRequest[];
	importMode: "auto" | "move" | "copy";
}

interface ManualImportReprocessRequest {
	id?: number;
	path?: string;
	seriesId?: number;
	movieId?: number;
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

const NullableStringSchema = z.string().nullable().optional();
const QueueImportScopeSchema = z.object({
	downloadClient: NullableStringSchema,
	downloadClientName: NullableStringSchema,
	trackedDownloadState: NullableStringSchema,
	trackedDownloadStatus: NullableStringSchema,
	seriesId: z.number().int().positive().nullish(),
	movieId: z.number().int().positive().nullish(),
	episodeId: z.number().int().positive().nullish(),
	episodeIds: z.array(z.number().int().positive()).nullish(),
	seasonNumber: z.number().int().nonnegative().nullish(),
});
type ImportTarget = RemovalTargetDetails & {
	importScope?: z.infer<typeof QueueImportScopeSchema>;
};
type BoundImportPreviewItem = ManualImportPreviewItem & {
	fingerprint?: string;
};
type ImportSubmission = {
	pending: boolean;
	commandId?: number;
	message: string;
};
type ImportExecutionItem = ManualImportExecutionData["results"][number] &
	Partial<ImportSubmission>;
const optionalString = (value: string | null | undefined): string | undefined =>
	value ?? undefined;

const QueueItemSchema = QueueImportScopeSchema.extend({
	id: z.number(),
	title: z.string(),
	status: QueueStatusSchema,
	size: z.number().optional(),
	sizeleft: z.number().optional(),
	protocol: NullableStringSchema,
	estimatedCompletionTime: NullableStringSchema,
	downloadId: NullableStringSchema,
	outputPath: NullableStringSchema,
	downloadClient: NullableStringSchema,
	downloadClientName: NullableStringSchema,
	trackedDownloadState: NullableStringSchema,
	trackedDownloadStatus: NullableStringSchema,
	statusMessages: z
		.array(
			z.object({
				title: z.string().optional(),
				message: z.string().optional(),
				messages: z.array(z.string()).optional(),
			}),
		)
		.optional(),
	errorMessage: NullableStringSchema,
	seriesId: z.number().int().positive().nullable().optional(),
	episodeId: z.number().int().positive().nullable().optional(),
	seasonNumber: z.number().int().nonnegative().nullable().optional(),
	episodeHasFile: z.boolean().optional(),
	episodeIds: z.array(z.number().int().positive()).optional(),
	seasonNumbers: z.array(z.number().int().nonnegative()).optional(),
	episodesWithFilesCount: z.number().int().nonnegative().optional(),
	isFullSeason: z.boolean().optional(),
});

const V5QueueItemSchema = QueueItemSchema.extend({
	sizeLeft: z.number().nonnegative(),
	episodeIds: z.array(z.number().int().positive()),
	seasonNumbers: z.array(z.number().int().nonnegative()),
	episodesWithFilesCount: z.number().int().nonnegative(),
	isFullSeason: z.boolean(),
}).transform((item) => ({
	...item,
	sizeleft: item.sizeLeft,
	episodeId: item.episodeIds.length === 1 ? item.episodeIds[0] : undefined,
	seasonNumber:
		item.seasonNumbers.length === 1 ? item.seasonNumbers[0] : undefined,
}));

const QueueSchema = z.object({
	totalRecords: z.number().int().nonnegative().optional(),
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
	tvdbId: z.number().optional(),
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
	tmdbId: z.number().optional(),
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
	// ponytail: process-local replay guard; durable command ledger for multi-process/restart recovery.
	private readonly submittedImports = new Map<string, ImportSubmission>();
	private readonly apiKey: string;

	constructor(serviceName: string, config: ServiceConfig) {
		this.serviceName = serviceName;
		this.baseUrl = config.baseUrl;
		this.apiKey = config.apiKey;
	}

	protected parseQueue(response: unknown) {
		return (
			this.apiFamily() === 5
				? QueueSchema.extend({ records: z.array(V5QueueItemSchema) })
				: QueueSchema
		)
			.refine(
				(queue) =>
					new Set(queue.records.map((record) => record.id)).size ===
					queue.records.length,
				{ message: "Ambiguous queue identities" },
			)
			.parse(response);
	}

	protected strictContracts(): boolean {
		return false;
	}

	protected apiFamily(): 3 | 5 {
		return 3;
	}

	protected buildDiscoveryUrl(): string {
		const prefix = new URL(this.baseUrl).pathname.replace(/\/$/, "");
		return buildUrl(this.baseUrl, `${prefix}/api`);
	}

	protected buildApiUrl(
		endpoint: string,
		params: Record<string, string | number> = {},
	): string {
		const url = new URL(
			`${this.buildDiscoveryUrl()}/v${this.apiFamily()}${endpoint}`,
		);
		for (const [key, value] of Object.entries(params))
			url.searchParams.set(key, String(value));
		if (
			this.apiFamily() === 5 &&
			(endpoint === "/history" || endpoint === "/history/since")
		) {
			url.searchParams.append("includeSubresources", "series");
			url.searchParams.append("includeSubresources", "episode");
		}
		if (this.apiFamily() === 5 && endpoint === "/episode")
			url.searchParams.append("includeSubresources", "episodeFile");
		if (this.apiFamily() === 5 && endpoint === "/queue") {
			url.searchParams.append("includeSubresources", "series");
			url.searchParams.append("includeSubresources", "episodes");
		}
		return url.toString();
	}

	protected fetchJson<T>(
		url: string,
		options: import("../core.js").HttpOptions = {},
	): Promise<T> {
		const headers = new Headers(options.headers);
		headers.set("X-Api-Key", this.apiKey);
		return fetchJson<T>(url, {
			...options,
			headers: Object.fromEntries(headers),
		});
	}

	async libraryStatistics(): Promise<OperationResult<LibraryStatisticsData>> {
		return handleError(
			createInternalError(
				"Library statistics requires Sonarr API v5; no legacy library scan is performed",
			),
			this.serviceName,
		);
	}

	async systemStatus(): Promise<OperationResult<SystemStatusData>> {
		const operation = withMetrics(
			this.serviceName,
			"systemStatus",
			async () => {
				debugOperation(this.serviceName, "systemStatus");
				const response = await this.fetchJson(
					this.buildApiUrl("/system/status"),
				);
				const data = StatusSchema.parse(response);
				if (
					this.strictContracts() &&
					(data.appName !== "Sonarr" || !data.version)
				)
					throw createInternalError("Sonarr system status failed validation");

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

			const response = await this.fetchJson(this.buildApiUrl("/queue", params));
			const data = this.parseQueue(response);

			const items = data.records.map((item) => ({
				id: item.id,
				title: item.title,
				status: item.status,
				progressPct:
					item.size && item.sizeleft !== undefined
						? Math.round(((item.size - item.sizeleft) / item.size) * 100)
						: undefined,
				mediaKind: this.mediaKind,
				seriesId: item.seriesId ?? undefined,
				episodeId: item.episodeId ?? undefined,
				seasonNumber: item.seasonNumber ?? undefined,
				episodeIds:
					item.episodeIds ?? (item.episodeId ? [item.episodeId] : undefined),
				seasonNumbers:
					item.seasonNumbers ??
					(item.seasonNumber != null ? [item.seasonNumber] : undefined),
				episodesWithFilesCount: item.episodesWithFilesCount,
				isFullSeason: item.isFullSeason,
				protocol: optionalString(item.protocol),
				estimatedCompletionTime: optionalString(item.estimatedCompletionTime),
				downloadId: optionalString(item.downloadId),
				outputPath: optionalString(item.outputPath),
				downloadClient: optionalString(
					item.downloadClient ?? item.downloadClientName,
				),
				trackedDownloadState: optionalString(item.trackedDownloadState),
				trackedDownloadStatus: optionalString(item.trackedDownloadStatus),
				statusMessages: item.statusMessages,
				errorMessage: optionalString(item.errorMessage),
			}));

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					total: data.totalRecords ?? data.records.length,
					items,
					truncated:
						data.totalRecords === undefined ||
						data.totalRecords !== data.records.length ||
						(options.page ?? 1) !== 1,
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
				await this.fetchJson(this.buildApiUrl(`/queue/grab/${ids[0]}`), {
					method: "POST",
				});
			} else {
				await this.fetchJson(this.buildApiUrl("/queue/grab/bulk"), {
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
				const response = await this.fetchJson(this.buildApiUrl("/rootfolder"));
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
			const since = this.apiFamily() === 5 && options.since;
			if (!since && options.page) params.page = options.page;
			if (!since && options.pageSize) params.pageSize = options.pageSize;
			if (options.since) params[since ? "date" : "since"] = options.since;

			const raw = await this.fetchJson(
				this.buildApiUrl(since ? "/history/since" : "/history", params),
			);
			const response = since
				? { records: HistorySchema.shape.records.parse(raw), totalRecords: 0 }
				: HistorySchema.parse(raw);
			if (since) response.totalRecords = response.records.length;
			const start = ((options.page ?? 1) - 1) * (options.pageSize ?? 20);
			const records = since
				? response.records.slice(start, start + (options.pageSize ?? 20))
				: response.records;

			const items = records.map((item) => ({
				id: item.id,
				title: item.sourceTitle || item.title || "Unknown",
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
					total: response.totalRecords ?? records.length,
					items,
					truncated:
						response.totalRecords === undefined ||
						response.totalRecords !== items.length ||
						(options.page ?? 1) !== 1,
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
			const results = SearchArraySchema.parse(
				await this.fetchJson(this.buildApiUrl(this.endpoints.lookup, params)),
			);
			const limitedResults = results.slice(0, limit);

			const searchResults = limitedResults.map((item) => ({
				id: this.id === "sonarr" ? item.tvdbId : item.tmdbId,
				title: item.title,
				year: item.year,
				overview: item.overview ?? undefined,
				mediaKind: this.mediaKind,
				foreignId: this.id === "sonarr" ? item.tvdbId : item.tmdbId,
				imdbId: item.imdbId ?? undefined,
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

	protected async prepareAddPayload(
		_request: AddRequest,
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return payload;
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
				const profiles: QualityProfile[] = await this.fetchJson(
					this.buildApiUrl("/qualityprofile"),
				);

				if (!profiles || profiles.length === 0) {
					throw createInternalError("No quality profiles available");
				}

				// Smart quality profile detection based on service name and available profiles
				const selected = await this.selectBestQualityProfile(profiles);
				qualityProfileId = selected.recommended ?? undefined;

				if (!qualityProfileId) {
					throw createInternalError(
						`Unable to auto-select quality profile for ${this.serviceName}. Available profiles: ${profiles.map((p: QualityProfile) => `${p.name} (id: ${p.id})`).join(", ")}. Please specify qualityProfileId explicitly.`,
					);
				}
			}

			// Radarr rejects adds without a root folder; Sonarr requires one too.
			// Discover the first configured root folder when the caller didn't
			// supply one so adds work without forcing callers to know paths.
			let rootFolderPath = request.rootFolderPath;
			if (!rootFolderPath) {
				const response: unknown = await this.fetchJson(
					this.buildApiUrl("/rootfolder"),
				);
				const parsed = RootFolderArraySchema.safeParse(response);
				const rootFolders = parsed.success ? parsed.data : [];
				const first = rootFolders.find((r) => r.path.length > 0);
				if (!first) {
					throw createInternalError(
						`No root folder configured on ${this.serviceName}; specify rootFolderPath explicitly.`,
					);
				}
				rootFolderPath = first.path;
			}

			const addPayload = {
				title: request.title,
				[this.id === "sonarr" ? "tvdbId" : "tmdbId"]: request.foreignId,
				rootFolderPath,
				qualityProfileId,
				monitored: request.monitored ?? true,
				...(this.id === "sonarr"
					? {
							seasonFolder: true,
							addOptions: { searchForMissingEpisodes: false },
						}
					: { addOptions: { searchForMovie: false } }),
			};

			const response: AddResponse = await this.fetchJson(
				this.buildApiUrl(this.endpoints.add),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(
						await this.prepareAddPayload(request, addPayload),
					),
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
			const response: WantedResponse = await this.fetchJson(
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
			const response: unknown = await this.fetchJson(
				this.buildApiUrl("/qualityprofile"),
			);
			const parsed = QualityProfileBoundaryArraySchema.safeParse(response);
			if (!parsed.success) {
				throw createInternalError(
					`Quality profile response failed validation on ${this.serviceName}: ${parsed.error.issues
						.map((i) => `${i.path.join(".")}: ${i.message}`)
						.join("; ")}`,
				);
			}
			const profiles = parsed.data;

			const profileData = profiles.map((profile) => ({
				id: profile.id,
				name: profile.name,
				upgradeAllowed: profile.upgradeAllowed,
				cutoff: profile.cutoff,
			}));

			const selected = await this.selectBestQualityProfile(profiles);
			const recommendedId = selected.recommended;

			// Usage counts: how many library items use each profile. This is the
			// metadata harnesses need to see *why* a profile is recommended —
			// never assume a default; the library's majority is the standard.
			const usage: Array<{
				id: number;
				name: string;
				count: number;
				pct: number;
			}> = [];
			let totalLibraryItems = 0;
			for (const [id, count] of selected.usage) {
				totalLibraryItems += count;
			}
			for (const [id, count] of selected.usage) {
				const profile = profileData.find((p) => p.id === id);
				usage.push({
					id,
					name: profile?.name ?? `profile ${id}`,
					count,
					pct:
						totalLibraryItems > 0
							? Math.round((count / totalLibraryItems) * 100)
							: 0,
				});
			}
			usage.sort((a, b) => b.count - a.count);

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					total: profileData.length,
					profiles: profileData,
					recommended: recommendedId ?? undefined,
					recommendedName:
						recommendedId !== null && recommendedId !== undefined
							? profileData.find((p) => p.id === recommendedId)?.name
							: undefined,
					usage,
					totalLibraryItems,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	// Find a library item by title (and optionally year). Sonarr: GET /series
	// (list of monitored series); Radarr: GET /movie. Titles are compared
	// case-insensitively; when a year is given a mismatched year demotes the
	// match instead of rejecting it so callers can distinguish exact from fuzzy.
	async lookupLibraryItem(
		title: string,
		year?: number,
	): Promise<OperationResult<LibraryLookupData>> {
		debugOperation(this.serviceName, "lookupLibraryItem", { title, year });
		try {
			const listEndpoint = this.id === "sonarr" ? "/series" : "/movie";
			const response: unknown = await this.fetchJson(
				this.buildApiUrl(listEndpoint),
			);
			const parsed = LibraryItemArraySchema.safeParse(response);
			if (!parsed.success)
				throw createInternalError("Library response failed validation");
			const items = parsed.data;
			const needle = title.trim().toLowerCase();

			const matches: LibraryItemMatch[] = items
				.map((item) => {
					const itemTitle = item.title ?? "";
					const hasFile =
						this.id === "sonarr"
							? Boolean(item.statistics?.episodeFileCount)
							: Boolean(item.hasFile);
					return {
						id: item.id,
						title: itemTitle,
						year: item.year,
						hasFile,
						path: item.path,
						...(this.id === "radarr"
							? { movieFileId: item.movieFile?.id }
							: {}),
					} as LibraryItemMatch;
				})
				.filter(
					(item) =>
						item.id > 0 &&
						(item.title.trim().toLowerCase() === needle ||
							item.title.trim().toLowerCase().includes(needle)),
				)
				.sort((a, b) => {
					// Exact title+year match first; exact title next; then fuzzy.
					const score = (m: LibraryItemMatch) =>
						(m.title.trim().toLowerCase() === needle ? 2 : 0) +
						(year !== undefined && m.year === year ? 1 : 0);
					return score(b) - score(a);
				});

			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					matches,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	// Delete a single media file by file id. Sonarr: DELETE /episodefile/{id};
	// Radarr: DELETE /moviefile/{id}.
	async deleteFile(fileId: number): Promise<OperationResult<FileDeleteData>> {
		debugOperation(this.serviceName, "deleteFile", { fileId });
		try {
			const endpoint =
				this.id === "sonarr"
					? `/episodefile/${fileId}`
					: `/moviefile/${fileId}`;
			await this.fetchJson(this.buildApiUrl(endpoint), { method: "DELETE" });
			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					fileId,
					deleted: true,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	// Trigger an arr search for a library item so it re-grabs a replacement.
	// Sonarr: SeriesSearch by series id; Radarr: MoviesSearch by movie id.
	async triggerSearch(
		itemId: number,
	): Promise<OperationResult<SearchTriggerData>> {
		debugOperation(this.serviceName, "triggerSearch", { itemId });
		try {
			const command =
				this.id === "sonarr"
					? { name: "SeriesSearch", seriesId: itemId }
					: { name: "MoviesSearch", movieIds: [itemId] };
			await this.fetchJson(this.buildApiUrl("/command"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(command),
			});
			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					triggered: true,
					command: command.name,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	// Change a library item's quality profile. Radarr/Sonarr PUT is a
	// full-object replace, so fetch the item, swap the profile id, PUT back.
	async updateQualityProfile(
		itemId: number,
		qualityProfileId: number,
	): Promise<OperationResult<QualityProfileUpdateData>> {
		debugOperation(this.serviceName, "updateQualityProfile", {
			itemId,
			qualityProfileId,
		});
		try {
			const endpoint =
				this.id === "sonarr" ? `/series/${itemId}` : `/movie/${itemId}`;
			const response: unknown = await this.fetchJson(
				this.buildApiUrl(endpoint),
			);
			// The PUT is a full-object replace, so the item must round-trip
			// unchanged. Validate shape (object with an id) without stripping
			// unknown fields the upstream API requires back.
			const parsed = LooseItemSchema.safeParse(response);
			if (!parsed.success || parsed.data.id !== itemId) {
				throw createInternalError(
					`Item ${itemId} not found on ${this.serviceName}`,
				);
			}
			const item = parsed.data as Record<string, unknown>;
			item.qualityProfileId = qualityProfileId;
			await this.fetchJson(this.buildApiUrl(endpoint), {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(item),
			});
			const readback = z
				.object({
					id: z.literal(itemId),
					qualityProfileId: z.literal(qualityProfileId),
				})
				.safeParse(await this.fetchJson(this.buildApiUrl(endpoint)));
			if (!readback.success)
				throw createInternalError(
					"Quality profile update could not be verified",
				);
			return {
				ok: true,
				data: {
					service: this.serviceName,
					mediaKind: this.mediaKind,
					itemId,
					qualityProfileId,
					updated: true,
				},
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	// Locate the episode(s) of a series matching a season/episode number so the
	// caller can delete a specific broken episode file and re-search it.
	// Sonarr-only: GET /episode?seriesId=... Radarr returns no matches.
	async lookupEpisodeFile(
		seriesId: number,
		seasonNumber?: number,
		episodeNumber?: number,
	): Promise<OperationResult<EpisodeLookupData>> {
		debugOperation(this.serviceName, "lookupEpisodeFile", {
			seriesId,
			seasonNumber,
			episodeNumber,
		});
		if (this.id !== "sonarr") {
			return { ok: true, data: { service: this.serviceName, matches: [] } };
		}
		try {
			if (
				!Number.isInteger(seriesId) ||
				seriesId <= 0 ||
				!Number.isInteger(seasonNumber) ||
				(seasonNumber ?? -1) < 0 ||
				!Number.isInteger(episodeNumber) ||
				(episodeNumber ?? 0) <= 0
			) {
				throw createInternalError(
					"Explicit valid series, season and episode coordinates required",
				);
			}
			const response: unknown = await this.fetchJson(
				this.buildApiUrl("/episode", { seriesId }),
			);
			const parsed = EpisodeArraySchema.safeParse(response);
			if (!parsed.success)
				throw createInternalError("Invalid episode response");
			const items = parsed.data;
			const matches: EpisodeFileMatch[] = items
				.map((item) => ({
					episodeId: item.id,
					episodeFileId: item.episodeFileId ?? item.episodeFile?.id,
					seasonNumber: item.seasonNumber,
					episodeNumber: item.episodeNumber,
					title: item.title,
					hasFile: Boolean(item.hasFile),
				}))
				.filter(
					(item) =>
						item.episodeId > 0 &&
						(seasonNumber === undefined ||
							item.seasonNumber === seasonNumber) &&
						(episodeNumber === undefined ||
							item.episodeNumber === episodeNumber),
				);
			if (matches.length > 1)
				throw createInternalError("Ambiguous episode file selection");
			return {
				ok: true,
				data: { service: this.serviceName, matches },
			};
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	async queueDiagnostics(
		autoFix = false,
	): Promise<OperationResult<QueueDiagnosticsData>> {
		const operation = withMetrics(
			this.serviceName,
			"queueDiagnostics",
			async () => {
				debugOperation(this.serviceName, "queueDiagnostics");
				// Get current queue with detailed status
				const queueResponse = await this.fetchJson(
					this.buildApiUrl("/queue", { pageSize: 250 }),
				);
				const queueData = this.parseQueue(queueResponse);
				if (
					queueData.totalRecords === undefined ||
					queueData.totalRecords !== queueData.records.length
				)
					throw createInternalError(
						"Queue snapshot incomplete; diagnostics cannot safely act or report full totals",
					);

				const allItems: QueueRecord[] = queueData.records.map((record) => {
					if (
						record.id === undefined ||
						record.title === undefined ||
						record.status === undefined
					) {
						throw new Error("Queue response item missing required fields");
					}

					return {
						...record,
						id: record.id,
						title: record.title,
						status: record.status,
					};
				});
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
				new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0)),
			);

			if (normalizedIds.length === 0) {
				return {
					ok: false,
					error: createInternalError(
						"No valid ids supplied for removal preparation",
					),
				};
			}

			if (kind === "queue") {
				const response = await this.fetchJson(
					this.buildApiUrl("/queue", { pageSize: 250 }),
				);
				const data = this.parseQueue(response);
				if (
					data.totalRecords === undefined ||
					data.totalRecords !== data.records.length
				) {
					throw createInternalError(
						"Queue snapshot incomplete; cannot prepare removal",
					);
				}
				const recordMap = new Map<number, z.infer<typeof QueueItemSchema>>(
					data.records.map((record) => [record.id, record]),
				);

				const targets: ImportTarget[] = [];
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
					const analysis = this.analyzeQueueItem(record);
					const manualReviewRequired =
						!analysis.category.autoFixable &&
						analysis.category.severity !== "info";

					targets.push({
						id: record.id,
						source: "queue",
						title: record.title,
						mediaKind: this.mediaKind,
						status: record.status,
						seriesId: record.seriesId ?? undefined,
						episodeIds:
							record.episodeIds ??
							(record.episodeId ? [record.episodeId] : undefined),
						seasonNumbers:
							record.seasonNumbers ??
							(record.seasonNumber != null ? [record.seasonNumber] : undefined),
						downloadId: optionalString(record.downloadId),
						path: optionalString(record.outputPath),
						protocol: optionalString(record.protocol),
						statusMessages: flattenedMessages,
						errorMessage: optionalString(record.errorMessage),
						manualReviewRequired,
						importScope: QueueImportScopeSchema.parse(record),
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

			const targets: (RemovalTargetDetails & {
				libraryScope:
					| z.infer<typeof SeriesSchema>
					| z.infer<typeof MovieSchema>;
			})[] = [];
			const missing: number[] = [];

			for (const id of normalizedIds) {
				try {
					if (this.id === "sonarr") {
						const response = await this.fetchJson(
							this.buildApiUrl(`/series/${id}`),
						);
						const series = SeriesSchema.parse(response);
						if (series.id !== id)
							throw createInternalError(
								"Library response target identity mismatch",
							);
						targets.push({
							id: series.id,
							source: "library",
							title: series.title,
							mediaKind: this.mediaKind,
							monitored: series.monitored,
							hasFile: (series.statistics?.episodeFileCount || 0) > 0,
							path: series.path,
							libraryScope: series,
						});
					} else {
						const response = await this.fetchJson(
							this.buildApiUrl(`/movie/${id}`),
						);
						const movie = MovieSchema.parse(response);
						if (movie.id !== id)
							throw createInternalError(
								"Library response target identity mismatch",
							);
						targets.push({
							id: movie.id,
							source: "library",
							title: movie.title,
							mediaKind: this.mediaKind,
							monitored: movie.monitored,
							hasFile: movie.hasFile ?? Boolean(movie.movieFile),
							path: movie.path,
							libraryScope: movie,
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
				const refreshed = await this.prepareRemoval(target.source, [target.id]);
				if (
					refreshed.ok &&
					target.source === "queue" &&
					options.attemptManualImport === false &&
					refreshed.data?.missingIds.includes(target.id)
				) {
					// A shared download may have cleared a later approved queue ID.
					removed += 1;
					details.push({
						id: target.id,
						title: target.title,
						source: target.source,
						status: "removed",
						message: "Item already absent from a complete queue snapshot",
					});
					continue;
				}
				if (
					!refreshed.ok ||
					JSON.stringify(refreshed.data?.targets[0]) !== JSON.stringify(target)
				) {
					failed += 1;
					details.push({
						id: target.id,
						title: target.title,
						source: target.source,
						status: "failed",
						message:
							"Removal target changed or could not be refreshed; repeat preview and confirmation",
					});
					continue;
				}

				if (
					target.source === "queue" &&
					options.attemptManualImport !== false
				) {
					const manualResult = await this.tryManualImport(target);
					if (manualResult.success) {
						manualImportNote =
							manualResult.message ?? "Manual import completed";
						manualImportSuccesses += 1;
					} else if (manualResult.message) {
						manualImportNote = manualResult.message;
						if (manualResult.attempted) {
							manualImportFailures.push(manualResult.message);
						}
					}
					if (!manualResult.success) {
						failed += 1;
						details.push({
							id: target.id,
							title: target.title,
							source: target.source,
							status: "failed",
							message: `${manualImportNote ?? "Import not verified"}; download retained. Explicit approved discard requires attemptManualImport: false`,
						});
						continue;
					}
					// Successful import already verified queue clearance; no deletion needed.
					removed += 1;
					details.push({
						id: target.id,
						title: target.title,
						source: target.source,
						status: "removed",
						message: manualImportNote,
					});
					continue;
				}

				try {
					if (target.source === "queue") {
						await this.removeFromQueue(target.id, {
							removeFromClient: options.removeFromClient ?? true,
							blocklist: options.blocklist ?? false,
							queueTimeoutMs: options.queueTimeoutMs,
						});
						if (!(await this.waitForQueueItemToClear(target.id)))
							throw createInternalError(
								"Queue removal could not be verified from a complete snapshot",
							);
					} else {
						await this.removeLibraryItem(target.id, {
							deleteFiles: options.deleteFiles ?? false,
							addImportExclusion: options.addImportExclusion ?? false,
						});
						if (!(await this.isLibraryItemAbsent(target.id)))
							throw createInternalError(
								"Library removal could not be verified from a successful snapshot",
							);
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
					if (
						this.isNotFoundError(error) &&
						(target.source === "queue"
							? await this.waitForQueueItemToClear(target.id)
							: await this.isLibraryItemAbsent(target.id))
					) {
						// A DELETE 404 still needs an independent absence readback.
						removed += 1;
						details.push({
							id: target.id,
							title: target.title,
							source: target.source,
							status: "removed",
							message: manualImportNote
								? `${manualImportNote}; item already absent`
								: "item already absent",
						});
						continue;
					}
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
			seriesId: item.seriesId ?? undefined,
			episodeId: item.episodeId ?? undefined,
			episodeIds:
				item.episodeIds ?? (item.episodeId ? [item.episodeId] : undefined),
			seasonNumbers: item.seasonNumbers,
			episodesWithFilesCount: item.episodesWithFilesCount,
			isFullSeason: item.isFullSeason,
			protocol: optionalString(item.protocol),
			downloadClient: optionalString(
				item.downloadClient ?? item.downloadClientName,
			),
			trackedDownloadState: optionalString(item.trackedDownloadState),
			trackedDownloadStatus: optionalString(item.trackedDownloadStatus),
			statusMessages: flattenedStatusMessages,
			errorMessage: optionalString(item.errorMessage),
		};
		const allMessages = [status, ...flattenedStatusMessages, errorMessage]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();

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

		// ID-matched releases that ARR refuses to auto-import need human review.
		if (
			allMessages.includes("matched by id") ||
			(allMessages.includes("manual import required") &&
				allMessages.includes("matching")) ||
			allMessages.includes("automatic import is not possible")
		) {
			return {
				...baseAnalysis,
				category: {
					type: "import_blocked_id_match",
					severity: "warning",
					autoFixable: false,
				},
				message: "Import blocked because release was matched by ID",
				suggestedAction:
					"Review manual import and verify the intended media match before importing",
			};
		}

		// Sample detection warnings are unsafe to auto-import without inspecting files.
		if (
			allMessages.includes("unable to determine if file is a sample") ||
			allMessages.includes("sample")
		) {
			return {
				...baseAnalysis,
				category: {
					type: "sample_detection_ambiguous",
					severity: "warning",
					autoFixable: false,
				},
				message: "Import blocked by ambiguous sample detection",
				suggestedAction:
					"Inspect release contents manually before importing or discarding",
			};
		}

		// Episode-pack/folder mismatches require manual episode mapping review.
		if (
			allMessages.includes("episodes expected") ||
			allMessages.includes("expected in this release") ||
			allMessages.includes("unexpected considering the folder name") ||
			allMessages.includes("was not found in the grabbed release")
		) {
			return {
				...baseAnalysis,
				category: {
					type: "episode_pack_mismatch",
					severity: "warning",
					autoFixable: false,
				},
				message: "Episode pack contents do not match expected episodes",
				suggestedAction:
					"Manually verify the file list, folder naming, and episode mapping",
			};
		}

		if (allMessages.includes("manual investigation required")) {
			return {
				...baseAnalysis,
				category: { type: "unknown", severity: "warning", autoFixable: false },
				message: "Manual investigation required",
				suggestedAction: "Review before importing or discarding",
			};
		}

		// TheXEM mapping issues
		if (allMessages.includes("thexem") && allMessages.includes("mapping")) {
			return {
				...baseAnalysis,
				category: { type: "mapping", severity: "warning", autoFixable: true },
				message: "TheXEM mapping issue detected",
				suggestedAction: "Trigger manual import to bypass mapping requirements",
			};
		}

		// Quality downgrade / not-an-upgrade issues. Arr commonly reports these
		// as completed import-pending warnings rather than hard failures.
		if (
			allMessages.includes("not a custom format upgrade") ||
			allMessages.includes("do not improve on existing") ||
			allMessages.includes("not an upgrade") ||
			(allMessages.includes("existing quality") &&
				allMessages.includes("new quality"))
		) {
			return {
				...baseAnalysis,
				category: {
					type: "quality_downgrade",
					severity: "warning",
					autoFixable: false,
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
						downloadId: optionalString(item.downloadId),
						path: optionalString(item.outputPath),
						protocol: optionalString(item.protocol),
					});
					return {
						...baseAction,
						action: "manual_import",
						attempted: manualResult.attempted,
						success: manualResult.success,
						error: manualResult.success ? undefined : manualResult.message,
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
							downloadId: optionalString(item.downloadId),
							path: optionalString(item.outputPath),
							protocol: optionalString(item.protocol),
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
		const timeoutMs = Math.max(
			1000,
			Math.min(options.queueTimeoutMs ?? 5000, 60000),
		);

		const params: Record<string, string> =
			this.id === "sonarr"
				? {
						removeFromClient: String(removeFromClient),
						blocklist: String(blocklist),
						skipRedownload: "false",
						changeCategory: "false",
					}
				: {};
		await this.fetchJson(this.buildApiUrl(`/queue/${queueId}`, params), {
			method: "DELETE",
			...(this.id === "radarr"
				? {
						body: JSON.stringify({ removeFromClient, blocklist }),
						headers: { "Content-Type": "application/json" },
					}
				: {}),
			timeoutMs,
		});
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
			await this.fetchJson(this.buildApiUrl(`/series/${itemId}`, params), {
				method: "DELETE",
			});
		} else {
			params.addImportExclusion = options.addImportExclusion ? "true" : "false";
			await this.fetchJson(this.buildApiUrl(`/movie/${itemId}`, params), {
				method: "DELETE",
			});
		}
	}

	private async isLibraryItemAbsent(id: number): Promise<boolean> {
		try {
			// ARR library list endpoints return the whole library, not a paged queue.
			const items = LibraryItemArraySchema.parse(
				await this.fetchJson(
					this.buildApiUrl(this.id === "sonarr" ? "/series" : "/movie"),
				),
			);
			return !items.some((item) => item.id === id);
		} catch {
			return false;
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
		return handleError(error, this.serviceName).error.message;
	}

	async previewManualImport(
		ids: number[],
	): Promise<OperationResult<ManualImportPreviewData>> {
		const operation = withMetrics(
			this.serviceName,
			"previewManualImport",
			async () => {
				const preparation = await this.prepareRemoval("queue", ids);
				if (!preparation.ok || !preparation.data) {
					return preparation as unknown as OperationResult<ManualImportPreviewData>;
				}

				const items: BoundImportPreviewItem[] = [];
				for (const target of preparation.data.targets) {
					const candidates = await this.getManualImportCandidates(target);
					const previews = candidates.map((candidate) =>
						this.buildManualImportCandidatePreview(candidate, target),
					);
					const viable = previews.filter((candidate) =>
						this.isSafeManualImportCandidate(candidate, target),
					);
					const selectedCandidate = viable.length === 1 ? viable[0] : undefined;
					const reason =
						previews.length === 0
							? "No manual import candidates returned"
							: viable.length === 0
								? "No unrejected candidate with complete media mapping"
								: viable.length > 1
									? "Multiple viable candidates returned; manual review required"
									: "Exactly one unrejected candidate with complete media mapping";
					items.push({
						id: target.id,
						title: target.title,
						status: target.status,
						downloadId: target.downloadId,
						path: target.path,
						candidates: previews,
						fingerprint: createHash("sha256")
							.update(JSON.stringify([target, previews]))
							.digest("hex"),
						selectedCandidate,
						safeToImport: Boolean(selectedCandidate),
						reason,
					});
				}

				const safe = items.filter((item) => item.safeToImport).length;
				return {
					ok: true,
					data: {
						service: this.serviceName,
						mediaKind: this.mediaKind,
						requestedIds: ids,
						missingIds: preparation.data.missingIds,
						items,
						summary: {
							total: items.length,
							safe,
							unsafe: items.length - safe,
						},
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

	async executeManualImport(
		preview: ManualImportPreviewData,
	): Promise<OperationResult<ManualImportExecutionData>> {
		const operation = withMetrics(
			this.serviceName,
			"executeManualImport",
			async () => {
				const results: ImportExecutionItem[] = [];
				if (
					preview.service !== this.serviceName ||
					preview.mediaKind !== this.mediaKind
				)
					throw createInternalError(
						"Manual import preview belongs to another service",
					);
				for (const item of preview.items) {
					if (!item.safeToImport || !item.selectedCandidate?.request) {
						results.push({
							id: item.id,
							title: item.title,
							status: "skipped",
							message: item.reason,
						});
						continue;
					}
					try {
						const prior = item.downloadId
							? this.submittedImports.get(item.downloadId)
							: undefined;
						if (prior) {
							results.push({
								id: item.id,
								title: item.title,
								status: "failed",
								...prior,
							});
							continue;
						}
						const refreshed = await this.previewManualImport([item.id]);
						const freshItem = refreshed.data?.items[0];
						if (
							!refreshed.ok ||
							!freshItem?.safeToImport ||
							!freshItem.selectedCandidate ||
							!item.downloadId ||
							!(item as BoundImportPreviewItem).fingerprint ||
							JSON.stringify(item) !== JSON.stringify(freshItem)
						)
							throw createInternalError(
								"Manual import preview is stale or ambiguous; repeat preview before any submission",
							);
						const selected = freshItem.selectedCandidate;
						const beforeFiles = await this.readImportFileIds(selected);
						const submission: ImportSubmission = {
							pending: true,
							message:
								"Pending: submission outcome unknown; retain download, inspect command status and do not resubmit",
						};
						if (this.submittedImports.has(item.downloadId))
							throw createInternalError(
								"Import already submitted; inspect pending work before replay",
							);
						this.submittedImports.set(item.downloadId, submission);
						const command = z.object({ id: z.number().int().positive() }).parse(
							await this.fetchJson(this.buildApiUrl("/command"), {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify(
									this.buildManualImportCommand([
										selected.request as ManualImportReprocessRequest,
									]),
								),
							}),
						);
						submission.commandId = command.id;
						const completion = z
							.object({ id: z.literal(command.id), status: z.string() })
							.parse(
								await this.fetchJson(
									this.buildApiUrl(`/command/${command.id}`),
								),
							);
						if (completion.status !== "completed") {
							submission.pending = !["failed", "aborted", "cancelled"].includes(
								completion.status,
							);
							submission.message = submission.pending
								? "Pending: manual import accepted but not completed; retain download, inspect command status and do not resubmit"
								: "Manual import command failed; retain download and review before any retry";
							results.push({
								id: item.id,
								title: item.title,
								status: "failed",
								...submission,
							});
							continue;
						}
						submission.pending = false;
						submission.message =
							"Import already submitted; inspect command, queue and library files instead of replaying";
						const cleared = await this.waitForQueueItemToClear(item.id);
						const afterFiles = await this.readImportFileIds(selected);
						const verified =
							cleared &&
							afterFiles.every(
								(id, index) => id > 0 && id !== beforeFiles[index],
							);
						results.push({
							id: item.id,
							title: item.title,
							status: verified ? "imported" : "failed",
							message: verified
								? "Manual import completed, queue cleared and new library file identity verified"
								: "Manual import end state unverified; retain download and inspect command, queue and library files before retrying",
						});
					} catch (error) {
						results.push({
							id: item.id,
							title: item.title,
							status: "failed",
							...(item.downloadId && this.submittedImports.has(item.downloadId)
								? this.submittedImports.get(item.downloadId)
								: { message: this.describeError(error) }),
						});
					}
				}

				return {
					ok: true,
					data: {
						service: this.serviceName,
						mediaKind: this.mediaKind,
						requestedIds: preview.requestedIds,
						imported: results.filter((item) => item.status === "imported")
							.length,
						failed: results.filter((item) => item.status === "failed").length,
						pending: results.filter((item) => item.pending).length,
						skipped: results.filter((item) => item.status === "skipped").length,
						results,
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

	private async readImportFileIds(
		candidate: ManualImportCandidatePreview,
	): Promise<number[]> {
		if (this.id === "radarr") {
			const item = z
				.object({
					id: z.literal(candidate.movieId),
					hasFile: z.boolean(),
					movieFile: z.object({ id: z.number().int().positive() }).nullish(),
				})
				.parse(
					await this.fetchJson(this.buildApiUrl(`/movie/${candidate.movieId}`)),
				);
			if (item.hasFile && !item.movieFile)
				throw createInternalError("Movie file identity unavailable");
			return [item.hasFile ? (item.movieFile?.id ?? 0) : 0];
		}
		const files: number[] = [];
		for (const id of candidate.episodeIds ?? []) {
			const episode = z
				.object({
					id: z.literal(id),
					seriesId: z.literal(candidate.seriesId),
					seasonNumber: z.literal(candidate.seasonNumber),
					hasFile: z.boolean(),
					episodeFileId: z.number().int().nonnegative(),
				})
				.parse(await this.fetchJson(this.buildApiUrl(`/episode/${id}`)));
			if (episode.hasFile && episode.episodeFileId === 0)
				throw createInternalError("Episode file identity unavailable");
			files.push(episode.hasFile ? episode.episodeFileId : 0);
		}
		return files;
	}

	private async waitForQueueItemToClear(queueId: number): Promise<boolean> {
		const delaysMs = [0, 1000, 2000, 4000];
		for (const delayMs of delaysMs) {
			const signal = requestSignal.getStore();
			signal?.throwIfAborted();
			if (delayMs > 0) {
				await delay(delayMs, undefined, { signal });
			}
			const queue = await this.queueList({ pageSize: 1000 });
			if (!queue.ok || !queue.data) {
				continue;
			}
			if (
				!queue.data.truncated &&
				!queue.data.items.some((item) => item.id === queueId)
			) {
				return true;
			}
		}
		return false;
	}

	private async getManualImportCandidates(
		target: RemovalTargetDetails,
	): Promise<ManualImportResource[]> {
		if (!target.downloadId) return [];
		const params: Record<string, string> = { filterExistingFiles: "false" };
		params[this.apiFamily() === 5 ? "downloadIds" : "downloadId"] =
			target.downloadId;
		if (target.path) params.folder = target.path;
		const candidates = await this.fetchJson(
			this.buildApiUrl("/manualimport", params),
		);
		const parsed = ManualImportSchema.safeParse(candidates);
		if (!parsed.success)
			throw createInternalError(
				"Manual import candidate response failed validation",
			);
		return parsed.data.map((candidate) => ({
			...candidate,
			series: candidate.series ?? undefined,
			movie: candidate.movie ?? undefined,
			seasonNumber: candidate.seasonNumber ?? undefined,
			episodes: candidate.episodes ?? undefined,
			rejections: candidate.rejections ?? undefined,
		}));
	}

	private buildManualImportCandidatePreview(
		candidate: ManualImportResource,
		target: RemovalTargetDetails,
	): ManualImportCandidatePreview {
		const request = this.buildManualImportRequest(candidate, target);
		return {
			id: candidate.id,
			path: candidate.path,
			seriesId: candidate.series?.id,
			movieId: candidate.movie?.id,
			seasonNumber: candidate.seasonNumber,
			episodeIds: (candidate.episodes || []).map((episode) => episode.id ?? 0),
			rejectionReasons: (candidate.rejections || []).map(
				(rejection) =>
					(this.apiFamily() === 5 ? rejection.message : rejection.reason) ||
					"Unspecified rejection",
			),
			rejections: candidate.rejections,
			request,
		};
	}

	private isSafeManualImportCandidate(
		candidate: ManualImportCandidatePreview,
		target: ImportTarget,
	): boolean {
		if (target.manualReviewRequired || candidate.rejectionReasons.length > 0)
			return false;
		const positiveId = (id: number | undefined) =>
			Number.isInteger(id) && (id ?? 0) > 0;
		if (
			!positiveId(candidate.id) ||
			!candidate.path ||
			!target.path ||
			!target.downloadId ||
			!target.importScope
		)
			return false;
		const paths =
			win32.isAbsolute(target.path) && !posix.isAbsolute(target.path)
				? win32
				: posix;
		if (
			!paths.isAbsolute(target.path) ||
			!paths.isAbsolute(candidate.path) ||
			candidate.path
				.split(/[\\/]/)
				.some((part) => part === ".." || part === ".")
		)
			return false;
		const relative = paths.relative(target.path, candidate.path);
		if (
			relative === ".." ||
			relative.startsWith(`..${paths.sep}`) ||
			paths.isAbsolute(relative)
		)
			return false;
		const request = candidate.request as ManualImportReprocessRequest;
		if (request.downloadId !== target.downloadId) return false;
		const scope = target.importScope;
		if (this.mediaKind === "series") {
			const expected =
				scope.episodeIds ?? (scope.episodeId ? [scope.episodeId] : []);
			const actual = candidate.episodeIds ?? [];
			return (
				positiveId(candidate.seriesId) &&
				candidate.seriesId === scope.seriesId &&
				Number.isInteger(candidate.seasonNumber) &&
				(candidate.seasonNumber ?? -1) >= 0 &&
				candidate.seasonNumber === scope.seasonNumber &&
				expected.length > 0 &&
				actual.length === expected.length &&
				new Set(actual).size === actual.length &&
				actual.every((id) => positiveId(id) && expected.includes(id))
			);
		}
		return positiveId(candidate.movieId) && candidate.movieId === scope.movieId;
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
		if (target.manualReviewRequired)
			return {
				attempted: false,
				success: false,
				message: "Manual review required; automatic import blocked",
			};
		if (!target.downloadId) {
			return {
				attempted: false,
				success: false,
				message: "Manual import skipped: missing download id",
			};
		}

		try {
			const preview = await this.previewManualImport([target.id]);
			if (!preview.ok || !preview.data || preview.data.summary.safe !== 1)
				return {
					attempted: true,
					success: false,
					message: "Manual import requires exactly one safe scoped candidate",
				};
			const result = await this.executeManualImport(preview.data);
			return {
				attempted: true,
				success: result.ok && result.data?.imported === 1,
				message: result.data?.results[0]?.message ?? "Manual import failed",
			};
		} catch (error) {
			return {
				attempted: true,
				success: false,
				message: this.describeError(error),
			};
		}
	}

	private buildManualImportCommand(
		files: ManualImportReprocessRequest[],
	): ManualImportCommandRequest {
		return {
			name: "ManualImport",
			files,
			importMode: "auto",
		};
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
			path: candidate.path,
			seriesId: candidate.series?.id,
			movieId: candidate.movie?.id,
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
		return request;
	}

	private async retryQueueItem(queueId: number): Promise<void> {
		// Refresh/retry the queue item
		await this.fetchJson(this.buildApiUrl(`/queue/refresh/${queueId}`), {
			method: "POST",
		});
	}

	// Pick the quality profile for a service. The library's own usage is the
	// ground truth: the profile most existing items use is the "standard
	// profile" (e.g. "HD Bluray + WEB" over a name-matching "HD-720p"). Fall
	// back to name-pattern matching only when the library is empty.
	private async selectBestQualityProfile(
		profiles: QualityProfile[],
	): Promise<{ recommended: number | null; usage: Map<number, number> }> {
		try {
			const listEndpoint = this.id === "sonarr" ? "/series" : "/movie";
			const response: unknown = await this.fetchJson(
				this.buildApiUrl(listEndpoint),
			);
			const parsed = LibraryItemArraySchema.safeParse(response);
			if (!parsed.success)
				throw createInternalError("Library response failed validation");
			const items = parsed.data;
			if (items.length > 0) {
				const counts = new Map<number, number>();
				for (const item of items) {
					if (item.qualityProfileId !== undefined) {
						counts.set(
							item.qualityProfileId,
							(counts.get(item.qualityProfileId) ?? 0) + 1,
						);
					}
				}
				let bestId: number | null = null;
				let bestCount = 0;
				for (const [id, count] of counts) {
					if (count > bestCount) {
						bestId = id;
						bestCount = count;
					}
				}
				if (bestId !== null) return { recommended: bestId, usage: counts };
			}
		} catch (error) {
			if (this.strictContracts()) throw error;
			// Legacy policy retains its historical name heuristic.
		}

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
				return { recommended: matchingProfile.id, usage: new Map() };
			}
		}

		// If no smart match found, use the first profile but only if there's exactly one
		// This prevents accidentally selecting a random profile when multiple exist
		if (profiles.length === 1) {
			return { recommended: profiles[0]?.id || null, usage: new Map() };
		}

		// Multiple profiles available but no smart match - require explicit selection
		return { recommended: null, usage: new Map() };
	}
}
