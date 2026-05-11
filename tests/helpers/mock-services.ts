/**
 * Mock service implementations for testing
 * These override methods to return fixture data without making HTTP calls
 */

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
	QueueOptions,
	RootFolderData,
	SearchData,
	SearchOptions,
	ServiceConfig,
	SystemStatusData,
} from "../../src/services/base.js";
import { BaseArrService } from "../../src/services/shared.js";
import * as radarrFixtures from "../fixtures/radarr-responses.js";
import * as sonarrFixtures from "../fixtures/sonarr-responses.js";

interface MockResponse {
	[endpoint: string]: unknown;
}

export class MockSonarrService extends BaseArrService {
	readonly id = "sonarr" as const;
	readonly mediaKind = "series" as const;
	readonly endpoints = {
		lookup: "/series/lookup",
		add: "/series",
		wanted: "/wanted/missing",
	};

	private mockResponses: MockResponse = {
		"/system/status": sonarrFixtures.sonarrSystemStatus,
		"/queue": sonarrFixtures.sonarrQueueResponse,
		"/rootfolder": sonarrFixtures.sonarrRootFolders,
		"/series/lookup": sonarrFixtures.sonarrSeriesLookup,
		"/qualityprofile": sonarrFixtures.sonarrQualityProfiles,
		"/history": sonarrFixtures.sonarrHistoryResponse,
		"/manualimport": sonarrFixtures.sonarrManualImportCandidates,
		"/wanted/missing": { records: [] },
	};

	constructor(serviceName: string, config?: ServiceConfig) {
		super(
			serviceName,
			config || {
				baseUrl: "http://mock-sonarr:8989",
				apiKey: "mock-api-key",
			},
		);
	}

	/**
	 * Override to inject custom mock responses for specific tests
	 */
	setMockResponse(endpoint: string, response: unknown): void {
		this.mockResponses[endpoint] = response;
	}

	/**
	 * Override to clear all mock responses
	 */
	clearMockResponses(): void {
		this.mockResponses = {};
	}

	/**
	 * Override to get mock response for endpoint
	 */
	getMockResponse(endpoint: string): unknown {
		return this.mockResponses[endpoint];
	}

	/**
	 * Simulate stuck queue items
	 */
	setStuckQueueItems(): void {
		this.setMockResponse("/queue", sonarrFixtures.sonarrQueueStuckItems);
	}

	/**
	 * Simulate manual import rejection
	 */
	setManualImportRejected(): void {
		this.setMockResponse(
			"/manualimport",
			sonarrFixtures.sonarrManualImportRejected,
		);
	}

	// Override methods to use mock responses instead of HTTP calls
	async systemStatus(): Promise<OperationResult<SystemStatusData>> {
		const data = this.mockResponses[
			"/system/status"
		] as typeof sonarrFixtures.sonarrSystemStatus;
		return {
			ok: true,
			data: {
				service: this.serviceName,
				name: data.instanceName || data.appName,
				version: data.version,
				isHealthy: true,
			},
		};
	}

	async queueList(
		options: QueueOptions = {},
	): Promise<OperationResult<QueueData>> {
		const response = this.mockResponses[
			"/queue"
		] as typeof sonarrFixtures.sonarrQueueResponse;

		const items = response.records.map((item) => ({
			id: item.id,
			title: item.title,
			status: item.status,
			progressPct:
				item.size && item.sizeleft
					? Math.round(((item.size - item.sizeleft) / item.size) * 100)
					: undefined,
			mediaKind: this.mediaKind,
			protocol: item.protocol ?? undefined,
			estimatedCompletionTime: item.estimatedCompletionTime ?? undefined,
			downloadId: item.downloadId ?? undefined,
			outputPath: item.outputPath ?? undefined,
			downloadClient:
				item.downloadClient ??
				(item as { downloadClientName?: string | null }).downloadClientName ??
				undefined,
			trackedDownloadState: item.trackedDownloadState ?? undefined,
			trackedDownloadStatus: item.trackedDownloadStatus ?? undefined,
			statusMessages: item.statusMessages,
			errorMessage: item.errorMessage ?? undefined,
		}));

		return {
			ok: true,
			data: {
				service: this.serviceName,
				mediaKind: this.mediaKind,
				total: response.totalRecords || response.records.length,
				items,
				truncated: false,
			},
		};
	}

	async queueGrab(ids: number[]): Promise<OperationResult<GrabData>> {
		if (ids.length === 0) {
			return {
				ok: false,
				error: {
					service: this.serviceName,
					message: "No IDs provided",
				},
			};
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
	}

	async rootFolderList(): Promise<OperationResult<RootFolderData>> {
		const folders = this.mockResponses[
			"/rootfolder"
		] as typeof sonarrFixtures.sonarrRootFolders;

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
	}

	async queueDiagnostics(
		autoFix = true,
	): Promise<OperationResult<QueueDiagnosticsData>> {
		const queueResponse = this.mockResponses[
			"/queue"
		] as typeof sonarrFixtures.sonarrQueueResponse;
		const allItems = queueResponse.records || [];

		// Simple mock implementation - just detect issues
		const issuesAnalyzed = allItems
			.filter(
				(item) => item.status === "warning" || item.statusMessages?.length > 0,
			)
			.map((item) => {
				const messages = (item.statusMessages || [])
					.flatMap((m) => [m.title, ...(m.messages || [])])
					.filter(Boolean)
					.join(" ")
					.toLowerCase();

				if (messages.includes("thexem")) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "mapping" as const,
							severity: "warning" as const,
							autoFixable: true,
						},
						message: "TheXEM mapping issue detected",
						suggestedAction: "Trigger manual import",
					};
				}

				if (
					messages.includes("not a custom format upgrade") ||
					messages.includes("do not improve")
				) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "quality_downgrade" as const,
							severity: "warning" as const,
							autoFixable: true,
						},
						message: "Download is not an upgrade",
						suggestedAction: "Remove from queue",
					};
				}

				if (messages.includes("timeout") || messages.includes("network")) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "network_error" as const,
							severity: "warning" as const,
							autoFixable: true,
						},
						message: "Network connectivity issue",
						suggestedAction: "Retry download",
					};
				}

				if (messages.includes("disk") && messages.includes("space")) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "disk_space" as const,
							severity: "critical" as const,
							autoFixable: false,
						},
						message: "Insufficient disk space",
						suggestedAction: "Free up disk space manually",
					};
				}

				return {
					id: item.id,
					title: item.title,
					status: item.status,
					category: {
						type: "unknown" as const,
						severity: "warning" as const,
						autoFixable: false,
					},
					message: "Item appears stuck",
					suggestedAction: "Manual investigation required",
				};
			});

		const fixesAttempted = autoFix
			? issuesAnalyzed
					.filter((i) => i.category.autoFixable)
					.map((issue) => ({
						id: issue.id,
						action:
							issue.category.type === "mapping"
								? ("manual_import" as const)
								: issue.category.type === "quality_downgrade"
									? ("remove_from_queue" as const)
									: issue.category.type === "network_error"
										? ("retry_download" as const)
										: ("ignore" as const),
						reason: issue.message,
						attempted: true,
						success: true,
					}))
			: [];

		return {
			ok: true,
			data: {
				service: this.serviceName,
				mediaKind: this.mediaKind,
				totalQueueItems: allItems.length,
				issuesFound: issuesAnalyzed.length,
				issuesAnalyzed,
				fixesAttempted,
				summary: {
					fixed: fixesAttempted.filter((f) => f.success).length,
					failed: fixesAttempted.filter((f) => !f.success).length,
					requiresManual: issuesAnalyzed.filter((i) => !i.category.autoFixable)
						.length,
				},
			},
		};
	}
}

export class MockRadarrService extends BaseArrService {
	readonly id = "radarr" as const;
	readonly mediaKind = "movie" as const;
	readonly endpoints = {
		lookup: "/movie/lookup",
		add: "/movie",
		wanted: "/wanted/missing",
	};

	private mockResponses: MockResponse = {
		"/system/status": radarrFixtures.radarrSystemStatus,
		"/queue": radarrFixtures.radarrQueueResponse,
		"/rootfolder": radarrFixtures.radarrRootFolders,
		"/movie/lookup": radarrFixtures.radarrMovieLookup,
		"/qualityprofile": radarrFixtures.radarrQualityProfiles,
		"/history": radarrFixtures.radarrHistoryResponse,
		"/manualimport": radarrFixtures.radarrManualImportCandidates,
		"/wanted/missing": { records: [] },
	};

	constructor(serviceName: string, config?: ServiceConfig) {
		super(
			serviceName,
			config || {
				baseUrl: "http://mock-radarr:7878",
				apiKey: "mock-api-key",
			},
		);
	}

	/**
	 * Override to inject custom mock responses for specific tests
	 */
	setMockResponse(endpoint: string, response: unknown): void {
		this.mockResponses[endpoint] = response;
	}

	/**
	 * Override to clear all mock responses
	 */
	clearMockResponses(): void {
		this.mockResponses = {};
	}

	/**
	 * Override to get mock response for endpoint
	 */
	getMockResponse(endpoint: string): unknown {
		return this.mockResponses[endpoint];
	}

	/**
	 * Simulate stuck queue items
	 */
	setStuckQueueItems(): void {
		this.setMockResponse("/queue", radarrFixtures.radarrQueueStuckItems);
	}

	/**
	 * Simulate manual import rejection
	 */
	setManualImportRejected(): void {
		this.setMockResponse(
			"/manualimport",
			radarrFixtures.radarrManualImportRejected,
		);
	}

	// Override methods to use mock responses instead of HTTP calls
	async systemStatus(): Promise<OperationResult<SystemStatusData>> {
		const data = this.mockResponses[
			"/system/status"
		] as typeof radarrFixtures.radarrSystemStatus;
		return {
			ok: true,
			data: {
				service: this.serviceName,
				name: data.instanceName || data.appName,
				version: data.version,
				isHealthy: true,
			},
		};
	}

	async queueList(
		options: QueueOptions = {},
	): Promise<OperationResult<QueueData>> {
		const response = this.mockResponses[
			"/queue"
		] as typeof radarrFixtures.radarrQueueResponse;

		const items = response.records.map((item) => ({
			id: item.id,
			title: item.title,
			status: item.status,
			progressPct:
				item.size && item.sizeleft
					? Math.round(((item.size - item.sizeleft) / item.size) * 100)
					: undefined,
			mediaKind: this.mediaKind,
			protocol: item.protocol ?? undefined,
			estimatedCompletionTime: item.estimatedCompletionTime ?? undefined,
			downloadId: item.downloadId ?? undefined,
			outputPath: item.outputPath ?? undefined,
			downloadClient:
				item.downloadClient ??
				(item as { downloadClientName?: string | null }).downloadClientName ??
				undefined,
			trackedDownloadState: item.trackedDownloadState ?? undefined,
			trackedDownloadStatus: item.trackedDownloadStatus ?? undefined,
			statusMessages: item.statusMessages,
			errorMessage: item.errorMessage ?? undefined,
		}));

		return {
			ok: true,
			data: {
				service: this.serviceName,
				mediaKind: this.mediaKind,
				total: response.totalRecords || response.records.length,
				items,
				truncated: false,
			},
		};
	}

	async queueGrab(ids: number[]): Promise<OperationResult<GrabData>> {
		if (ids.length === 0) {
			return {
				ok: false,
				error: {
					service: this.serviceName,
					message: "No IDs provided",
				},
			};
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
	}

	async rootFolderList(): Promise<OperationResult<RootFolderData>> {
		const folders = this.mockResponses[
			"/rootfolder"
		] as typeof radarrFixtures.radarrRootFolders;

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
	}

	async queueDiagnostics(
		autoFix = true,
	): Promise<OperationResult<QueueDiagnosticsData>> {
		const queueResponse = this.mockResponses[
			"/queue"
		] as typeof radarrFixtures.radarrQueueResponse;
		const allItems = queueResponse.records || [];

		// Simple mock implementation - just detect issues
		const issuesAnalyzed = allItems
			.filter(
				(item) => item.status === "warning" || item.statusMessages?.length > 0,
			)
			.map((item) => {
				const messages = (item.statusMessages || [])
					.flatMap((m) => [m.title, ...(m.messages || [])])
					.filter(Boolean)
					.join(" ")
					.toLowerCase();

				if (messages.includes("thexem")) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "mapping" as const,
							severity: "warning" as const,
							autoFixable: true,
						},
						message: "TheXEM mapping issue detected",
						suggestedAction: "Trigger manual import",
					};
				}

				if (
					messages.includes("not a custom format upgrade") ||
					messages.includes("do not improve")
				) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "quality_downgrade" as const,
							severity: "warning" as const,
							autoFixable: true,
						},
						message: "Download is not an upgrade",
						suggestedAction: "Remove from queue",
					};
				}

				if (messages.includes("timeout") || messages.includes("network")) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "network_error" as const,
							severity: "warning" as const,
							autoFixable: true,
						},
						message: "Network connectivity issue",
						suggestedAction: "Retry download",
					};
				}

				if (messages.includes("disk") && messages.includes("space")) {
					return {
						id: item.id,
						title: item.title,
						status: item.status,
						category: {
							type: "disk_space" as const,
							severity: "critical" as const,
							autoFixable: false,
						},
						message: "Insufficient disk space",
						suggestedAction: "Free up disk space manually",
					};
				}

				return {
					id: item.id,
					title: item.title,
					status: item.status,
					category: {
						type: "unknown" as const,
						severity: "warning" as const,
						autoFixable: false,
					},
					message: "Item appears stuck",
					suggestedAction: "Manual investigation required",
				};
			});

		const fixesAttempted = autoFix
			? issuesAnalyzed
					.filter((i) => i.category.autoFixable)
					.map((issue) => ({
						id: issue.id,
						action:
							issue.category.type === "mapping"
								? ("manual_import" as const)
								: issue.category.type === "quality_downgrade"
									? ("remove_from_queue" as const)
									: issue.category.type === "network_error"
										? ("retry_download" as const)
										: ("ignore" as const),
						reason: issue.message,
						attempted: true,
						success: true,
					}))
			: [];

		return {
			ok: true,
			data: {
				service: this.serviceName,
				mediaKind: this.mediaKind,
				totalQueueItems: allItems.length,
				issuesFound: issuesAnalyzed.length,
				issuesAnalyzed,
				fixesAttempted,
				summary: {
					fixed: fixesAttempted.filter((f) => f.success).length,
					failed: fixesAttempted.filter((f) => !f.success).length,
					requiresManual: issuesAnalyzed.filter((i) => !i.category.autoFixable)
						.length,
				},
			},
		};
	}
}

/**
 * Mock fetch function that returns fixture data instead of making real HTTP requests
 * Can be used to override the global fetch or passed to services that accept a fetch function
 */
export function createMockFetch(responses: MockResponse): typeof global.fetch {
	return async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;

		// Extract endpoint from URL (remove base URL and query params)
		const urlObj = new URL(url);
		const endpoint = urlObj.pathname;

		// Find matching mock response
		const mockResponse = responses[endpoint];

		if (mockResponse === undefined) {
			return new Response(
				JSON.stringify({
					error: "Not Found",
					message: `No mock response defined for endpoint: ${endpoint}`,
				}),
				{
					status: 404,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		return new Response(JSON.stringify(mockResponse), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};
}

/**
 * Helper to create a basic service config for testing
 */
export function createMockServiceConfig(
	overrides?: Partial<ServiceConfig>,
): ServiceConfig {
	return {
		baseUrl: overrides?.baseUrl || "http://localhost:8989",
		apiKey: overrides?.apiKey || "test-api-key-123",
	};
}
