export interface OperationResult<T> {
	ok: boolean;
	data?: T;
	error?: ServiceError | InternalError;
}

export interface ServiceError {
	service: string;
	status: number;
	code?: string;
	message: string;
	raw?: unknown;
}

export interface InternalError {
	kind: "internal";
	message: string;
	cause?: unknown;
}

export interface ServiceConfig {
	baseUrl: string;
	apiKey: string;
}

export interface SystemStatusData {
	service: string;
	name: string;
	version: string;
	startTime?: string;
	isHealthy: boolean;
}

export interface QueueOptions {
	page?: number;
	pageSize?: number;
	sortKey?: string;
	sortDirection?: "ascending" | "descending";
}

export interface QueueItem {
	id: number;
	title: string;
	status: string;
	progressPct?: number;
	mediaKind: "series" | "movie";
	protocol?: string;
	estimatedCompletionTime?: string;
	downloadId?: string;
	outputPath?: string;
	downloadClient?: string;
	trackedDownloadState?: string;
	trackedDownloadStatus?: string;
	statusMessages?: Array<{
		title?: string;
		message?: string;
		messages?: string[];
	}>;
	errorMessage?: string;
}

export interface QueueData {
	service: string;
	mediaKind: "series" | "movie";
	total: number;
	items: QueueItem[];
	truncated: boolean;
}

export interface GrabData {
	service: string;
	mediaKind: "series" | "movie";
	grabbed: number;
	ids: number[];
}

export interface RootFolder {
	id: number;
	path: string;
	freeSpaceBytes?: number;
	accessible?: boolean;
}

export interface RootFolderData {
	service: string;
	mediaKind: "series" | "movie";
	total: number;
	folders: RootFolder[];
	defaultId?: number;
}

export interface HistoryOptions {
	page?: number;
	pageSize?: number;
	since?: string;
}

export interface HistoryItem {
	id: number;
	title: string;
	quality: string;
	date: string;
	eventType: string;
	mediaKind: "series" | "movie";
}

export interface HistoryData {
	service: string;
	mediaKind: "series" | "movie";
	total: number;
	items: HistoryItem[];
	truncated: boolean;
}

export interface SearchOptions {
	limit?: number;
}

export interface SearchResult {
	id?: number;
	title: string;
	year?: number;
	overview?: string;
	mediaKind: "series" | "movie";
	foreignId?: number;
	imdbId?: string;
}

export interface SearchData {
	service: string;
	mediaKind: "series" | "movie";
	total: number;
	results: SearchResult[];
	truncated: boolean;
}

export interface AddRequest {
	title: string;
	foreignId: number;
	rootFolderPath?: string;
	qualityProfileId?: number;
	monitored?: boolean;
}

export interface AddData {
	service: string;
	mediaKind: "series" | "movie";
	added: boolean;
	id?: number;
	title: string;
	existing: boolean;
}

export interface ImportIssue {
	id: number;
	title: string;
	reason: string;
	ageMinutes: number;
}

export interface ImportIssueData {
	service: string;
	mediaKind: "series" | "movie";
	issues: ImportIssue[];
	summary: {
		total: number;
		stuckPending: number;
		failedImport: number;
	};
}

export interface QualityProfile {
	id: number;
	name: string;
	upgradeAllowed?: boolean;
	cutoff?: number;
}

export interface QualityProfileData {
	service: string;
	mediaKind: "series" | "movie";
	total: number;
	profiles: QualityProfile[];
	recommended?: number;
}

export interface QueueIssueCategory {
	type:
		| "mapping"
		| "quality_downgrade"
		| "network_error"
		| "disk_space"
		| "permissions"
		| "import_blocked_id_match"
		| "sample_detection_ambiguous"
		| "episode_pack_mismatch"
		| "unknown";
	severity: "critical" | "warning" | "info";
	autoFixable: boolean;
}

export interface QueueIssueAnalysis {
	id: number;
	title: string;
	status: string;
	protocol?: string;
	downloadClient?: string;
	trackedDownloadState?: string;
	trackedDownloadStatus?: string;
	statusMessages?: string[];
	errorMessage?: string;
	category: QueueIssueCategory;
	message: string;
	suggestedAction: string;
}

export interface QueueFixAction {
	id: number;
	action:
		| "manual_import"
		| "remove_from_queue"
		| "remove_from_client"
		| "retry_download"
		| "ignore";
	reason: string;
	attempted: boolean;
	success?: boolean;
	error?: string;
}

export interface QueueDiagnosticsData {
	service: string;
	mediaKind: "series" | "movie";
	totalQueueItems: number;
	issuesFound: number;
	issuesAnalyzed: QueueIssueAnalysis[];
	fixesAttempted: QueueFixAction[];
	summary: {
		fixed: number;
		failed: number;
		requiresManual: number;
	};
}

export interface ManualImportCandidatePreview {
	id?: number;
	path?: string;
	seriesId?: number;
	movieId?: number;
	seasonNumber?: number;
	episodeIds?: number[];
	rejectionReasons: string[];
	request?: unknown;
}

export interface ManualImportPreviewItem {
	id: number;
	title: string;
	status?: string;
	downloadId?: string;
	path?: string;
	candidates: ManualImportCandidatePreview[];
	selectedCandidate?: ManualImportCandidatePreview;
	safeToImport: boolean;
	reason: string;
}

export interface ManualImportPreviewData {
	service: string;
	mediaKind: "series" | "movie";
	requestedIds: number[];
	missingIds: number[];
	items: ManualImportPreviewItem[];
	summary: {
		total: number;
		safe: number;
		unsafe: number;
	};
}

export interface ManualImportExecutionData {
	service: string;
	mediaKind: "series" | "movie";
	requestedIds: number[];
	imported: number;
	failed: number;
	skipped: number;
	results: Array<{
		id: number;
		title: string;
		status: "imported" | "failed" | "skipped";
		message?: string;
	}>;
}

export type RemovalKind = "queue" | "library";

export interface RemovalTargetDetails {
	id: number;
	source: RemovalKind;
	title: string;
	mediaKind: "series" | "movie";
	status?: string;
	monitored?: boolean;
	hasFile?: boolean;
	path?: string;
	downloadId?: string;
	protocol?: string;
	statusMessages?: string[];
	errorMessage?: string;
	manualReviewRequired?: boolean;
}

export interface RemovalPreparationData {
	service: string;
	mediaKind: "series" | "movie";
	kind: RemovalKind;
	requestedIds: number[];
	missingIds: number[];
	targets: RemovalTargetDetails[];
	notes?: string[];
}

export interface RemovalExecutionOptions {
	deleteFiles?: boolean;
	addImportExclusion?: boolean;
	removeFromClient?: boolean;
	blocklist?: boolean;
	attemptManualImport?: boolean;
	queueTimeoutMs?: number;
}

export type RemovalResultStatus = "removed" | "skipped" | "failed";

export interface RemovalResultItem {
	id: number;
	title: string;
	source: RemovalKind;
	status: RemovalResultStatus;
	message?: string;
}

export interface RemovalResultData {
	service: string;
	mediaKind: "series" | "movie";
	kind: RemovalKind;
	removed: number;
	skipped: number;
	failed: number;
	missingIds: number[];
	details: RemovalResultItem[];
	notes?: string[];
}

export interface MultiServiceDiagnosticsData {
	totalServices: number;
	servicesScanned: string[];
	overallSummary: {
		totalQueueItems: number;
		totalIssuesFound: number;
		totalFixed: number;
		totalFailed: number;
		totalRequiresManual: number;
	};
	serviceResults: QueueDiagnosticsData[];
}

// Library membership + remediation primitives (used by the Plex reported-issues
// flow): find an item already in the library, delete its file, trigger a search
// so the arr service re-grabs a replacement.
export interface LibraryItemMatch {
	id: number;
	title: string;
	year?: number;
	hasFile: boolean;
	path?: string;
	episodeFileId?: number;
	movieFileId?: number;
}

export interface LibraryLookupData {
	service: string;
	mediaKind: "series" | "movie";
	matches: LibraryItemMatch[];
}

export interface FileDeleteData {
	service: string;
	mediaKind: "series" | "movie";
	fileId: number;
	deleted: boolean;
}

export interface SearchTriggerData {
	service: string;
	mediaKind: "series" | "movie";
	triggered: boolean;
	command?: string;
}

export interface EpisodeFileMatch {
	episodeId: number;
	episodeFileId?: number;
	seasonNumber?: number;
	episodeNumber?: number;
	title?: string;
	hasFile: boolean;
}

export interface EpisodeLookupData {
	service: string;
	matches: EpisodeFileMatch[];
}

export interface ServiceImplementation {
	readonly id: "sonarr" | "radarr";
	readonly serviceName: string;

	systemStatus(): Promise<OperationResult<SystemStatusData>>;
	queueList(options?: QueueOptions): Promise<OperationResult<QueueData>>;
	queueGrab(ids: number[]): Promise<OperationResult<GrabData>>;
	rootFolderList(): Promise<OperationResult<RootFolderData>>;
	historyDetail(
		options?: HistoryOptions,
	): Promise<OperationResult<HistoryData>>;
	search(
		query: string,
		options?: SearchOptions,
	): Promise<OperationResult<SearchData>>;
	addNew(payload: AddRequest): Promise<OperationResult<AddData>>;
	importIssues(): Promise<OperationResult<ImportIssueData>>;
	listQualityProfiles(): Promise<OperationResult<QualityProfileData>>;
	queueDiagnostics(
		autoFix?: boolean,
	): Promise<OperationResult<QueueDiagnosticsData>>;
	previewManualImport(
		ids: number[],
	): Promise<OperationResult<ManualImportPreviewData>>;
	executeManualImport(
		preview: ManualImportPreviewData,
	): Promise<OperationResult<ManualImportExecutionData>>;
	prepareRemoval(
		kind: RemovalKind,
		ids: number[],
	): Promise<OperationResult<RemovalPreparationData>>;
	executeRemoval(
		preparation: RemovalPreparationData,
		options: RemovalExecutionOptions,
	): Promise<OperationResult<RemovalResultData>>;
	lookupLibraryItem(
		title: string,
		year?: number,
	): Promise<OperationResult<LibraryLookupData>>;
	deleteFile(fileId: number): Promise<OperationResult<FileDeleteData>>;
	triggerSearch(itemId: number): Promise<OperationResult<SearchTriggerData>>;
	lookupEpisodeFile(
		seriesId: number,
		seasonNumber?: number,
		episodeNumber?: number,
	): Promise<OperationResult<EpisodeLookupData>>;
}
