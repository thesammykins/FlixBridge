import { fetchJson } from "../../core.js";
import type { InternalError, OperationResult, ServiceError } from "../base.js";

export interface SabnzbdConfig {
	baseUrl: string;
	apiKey: string;
	name?: string;
}

export interface SabnzbdQueueSlot {
	nzo_id: string;
	filename: string;
	mb: string;
	mbleft: string;
	percentage: string;
	status: string;
	priority: string;
	eta: string;
	timeleft: string;
}

export interface SabnzbdQueueResponse {
	queue: {
		slots: SabnzbdQueueSlot[];
		speed: string;
		size: string;
		sizeleft: string;
		paused: boolean;
		noofslots: number;
	};
}

export interface SabnzbdHistorySlot {
	nzo_id: string;
	name: string;
	size: string;
	status: string;
	completed: number;
	completedOn: string;
	category: string;
}

export interface SabnzbdHistoryResponse {
	history: {
		slots: SabnzbdHistorySlot[];
		noofslots: number;
		total_size: string;
	};
}

export interface SabnzbdStats {
	uptime: string;
	version: string;
	color_scheme: string;
	darwin: boolean;
	nt: boolean;
	speedlimit: string;
	speedlimit_abs: string;
	have_warnings: string;
	paused: boolean;
	pause_int: string;
	quota: string;
	have_quota: boolean;
	left_quota: string;
	cache_art: string;
	cache_size: string;
	finishaction: null;
	noofslots: number;
	start: number;
	restart: boolean;
	pid: number;
	loadavg: string;
	cache_max: string;
	free_space: string;
}

export interface NormalizedSabQueueItem {
	nzoId: string;
	title: string;
	status: string;
	progressPct: number;
	sizeMB: number;
	sizeLeftMB: number;
	eta: string;
}

export interface SabnzbdStatusData {
	service: string;
	name: string;
	version: string;
	isHealthy: boolean;
	paused: boolean;
	totalSlots: number;
	speedKBps?: number;
}

export interface SabnzbdQueueData {
	service: string;
	total: number;
	items: NormalizedSabQueueItem[];
	paused: boolean;
	speedKBps?: number;
	totalSizeMB: number;
	remainingSizeMB: number;
}

export interface SabnzbdRemovalPreview {
	downloader: string;
	requestedIds: string[];
	missingIds: string[];
	items: NormalizedSabQueueItem[];
}

export interface SabnzbdRemovalResultItem {
	id: string;
	title: string;
	status: "removed" | "failed" | "skipped";
	message?: string;
}

export interface SabnzbdRemovalResult {
	downloader: string;
	removed: number;
	failed: number;
	missingIds: string[];
	details: SabnzbdRemovalResultItem[];
}

export class SabnzbdService {
	readonly id = "sabnzbd" as const;
	readonly serviceName: string;
	private readonly baseUrl: string;
	private readonly apiKey: string;

	constructor(config: SabnzbdConfig) {
		this.serviceName = config.name || "SABnzbd";
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.apiKey = config.apiKey;
	}

	private buildApiUrl(
		mode: string,
		extraParams: Record<string, string> = {},
	): string {
		const url = new URL("/api", this.baseUrl);
		url.searchParams.set("mode", mode);
		url.searchParams.set("output", "json");
		url.searchParams.set("apikey", this.apiKey);

		for (const [key, value] of Object.entries(extraParams)) {
			url.searchParams.set(key, value);
		}

		return url.toString();
	}

	async serverStats(): Promise<OperationResult<SabnzbdStatusData>> {
		try {
			const url = this.buildApiUrl("server_stats");
			const response = await fetchJson<SabnzbdStats>(url);

			const speedMatch = response.speedlimit?.match(/(\d+)/);
			const speedKBps = speedMatch
				? Number.parseInt(speedMatch[1] || "0", 10)
				: undefined;

			return {
				ok: true,
				data: {
					service: this.serviceName,
					name: "SABnzbd",
					version: response.version || "unknown",
					isHealthy: true,
					paused: response.paused || false,
					totalSlots: response.noofslots || 0,
					speedKBps,
				},
			};
		} catch (error) {
			return {
				ok: false,
				error: this.mapError(error),
			};
		}
	}

	async queueList(): Promise<OperationResult<SabnzbdQueueData>> {
		try {
			const url = this.buildApiUrl("queue");
			const response = await fetchJson<SabnzbdQueueResponse>(url);

			const queue = response.queue || {};
			const slots = queue.slots || [];

			const items: NormalizedSabQueueItem[] = slots.map((slot) => ({
				nzoId: slot.nzo_id,
				title: slot.filename,
				status: slot.status || "unknown",
				progressPct: Number.parseFloat(slot.percentage) || 0,
				sizeMB: Number.parseFloat(slot.mb) || 0,
				sizeLeftMB: Number.parseFloat(slot.mbleft) || 0,
				eta: slot.eta || "",
			}));

			const speedMatch = queue.speed?.match(/(\d+)/);
			const speedKBps = speedMatch
				? Number.parseInt(speedMatch[1] || "0", 10)
				: undefined;

			return {
				ok: true,
				data: {
					service: this.serviceName,
					total: queue.noofslots || 0,
					items,
					paused: queue.paused || false,
					speedKBps,
					totalSizeMB: Number.parseFloat(queue.size) || 0,
					remainingSizeMB: Number.parseFloat(queue.sizeleft) || 0,
				},
			};
		} catch (error) {
			return {
				ok: false,
				error: this.mapError(error),
			};
		}
	}

	async historyList(
		limit?: number,
	): Promise<OperationResult<SabnzbdHistorySlot[]>> {
		try {
			const params: Record<string, string> = {};
			if (limit) {
				params.limit = limit.toString();
			}

			const url = this.buildApiUrl("history", params);
			const response = await fetchJson<SabnzbdHistoryResponse>(url);

			const history = response.history || {};
			const slots = history.slots || [];

			return {
				ok: true,
				data: slots,
			};
		} catch (error) {
			return {
				ok: false,
				error: this.mapError(error),
			};
		}
	}

	async addUrl(
		nzbUrl: string,
		name?: string,
		category?: string,
	): Promise<OperationResult<{ added: boolean }>> {
		try {
			const params: Record<string, string> = {
				name: nzbUrl,
			};

			if (name) {
				params.nzbname = name;
			}
			if (category) {
				params.cat = category;
			}

			const url = this.buildApiUrl("addurl", params);
			await fetchJson(url);

			return {
				ok: true,
				data: { added: true },
			};
		} catch (error) {
			return {
				ok: false,
				error: this.mapError(error),
			};
		}
	}

	async prepareRemoval(
		ids: Array<string | number>,
	): Promise<OperationResult<SabnzbdRemovalPreview>> {
		const normalizedIds = Array.from(
			new Set(
				ids
					.map((value) => String(value ?? "").trim())
					.filter((value) => value.length > 0),
			),
		);

		if (normalizedIds.length === 0) {
			return {
				ok: false,
				error: {
					kind: "internal",
					message: "No valid downloader ids supplied for removal",
				},
			};
		}

		const queue = await this.queueList();
		if (!queue.ok || !queue.data) {
			return {
				ok: false,
				error: queue.error ?? {
					kind: "internal",
					message: "Unable to load SABnzbd queue",
				},
			};
		}

		const map = new Map(queue.data.items.map((item) => [item.nzoId, item]));
		const items: NormalizedSabQueueItem[] = [];
		const missing: string[] = [];

		for (const id of normalizedIds) {
			const item = map.get(id);
			if (item) {
				items.push(item);
			} else {
				missing.push(id);
			}
		}

		items.sort((a, b) => a.nzoId.localeCompare(b.nzoId));
		missing.sort((a, b) => a.localeCompare(b));

		return {
			ok: true,
			data: {
				downloader: this.serviceName,
				requestedIds: normalizedIds,
				missingIds: missing,
				items,
			},
		};
	}

	async removeQueueItems(
		ids: Array<string | number>,
		deleteData = false,
	): Promise<OperationResult<SabnzbdRemovalResult>> {
		const normalizedIds = Array.from(
			new Set(
				ids
					.map((value) => String(value ?? "").trim())
					.filter((value) => value.length > 0),
			),
		);

		if (normalizedIds.length === 0) {
			return {
				ok: false,
				error: {
					kind: "internal",
					message: "No valid downloader ids supplied for removal",
				},
			};
		}

		const queue = await this.queueList();
		if (!queue.ok || !queue.data) {
			return {
				ok: false,
				error: queue.error ?? {
					kind: "internal",
					message: "Unable to load SABnzbd queue",
				},
			};
		}

		const titleMap = new Map(
			queue.data.items.map((item) => [item.nzoId, item.title]),
		);
		const missing: string[] = [];
		const details: SabnzbdRemovalResultItem[] = [];
		let removed = 0;
		let failed = 0;

		for (const id of normalizedIds) {
			const title = titleMap.get(id) || id;
			if (!titleMap.has(id)) {
				missing.push(id);
				details.push({
					id,
					title,
					status: "skipped",
					message: "Item not present in downloader queue",
				});
				continue;
			}

			try {
				const url = this.buildApiUrl("queue", {
					name: "delete",
					value: id,
					del_files: deleteData ? "1" : "0",
				});
				const response = await fetchJson<{ status?: boolean; error?: string }>(
					url,
				);
				if (response && response.status === false) {
					throw new Error(
						response.error || "SABnzbd rejected deletion request",
					);
				}

				details.push({ id, title, status: "removed" });
				removed += 1;
			} catch (error) {
				failed += 1;
				details.push({
					id,
					title,
					status: "failed",
					message: this.describeError(error),
				});
			}
		}

		missing.sort((a, b) => a.localeCompare(b));

		return {
			ok: true,
			data: {
				downloader: this.serviceName,
				removed,
				failed,
				missingIds: missing,
				details,
			},
		};
	}

	/**
	 * Correlate SABnzbd queue items with arr queue items by title matching
	 */
	correlateTitles(
		sabItems: NormalizedSabQueueItem[],
		arrTitles: string[],
	): Array<{
		sabItem: NormalizedSabQueueItem;
		arrTitle?: string;
		confidence: number;
	}> {
		const results: Array<{
			sabItem: NormalizedSabQueueItem;
			arrTitle?: string;
			confidence: number;
		}> = [];

		for (const sabItem of sabItems) {
			let bestMatch: string | undefined;
			let bestConfidence = 0;

			const sabTitle = this.sanitizeTitle(sabItem.title);

			for (const arrTitle of arrTitles) {
				const sanitizedArrTitle = this.sanitizeTitle(arrTitle);
				const confidence = this.calculateTitleSimilarity(
					sabTitle,
					sanitizedArrTitle,
				);

				if (confidence > bestConfidence && confidence > 0.6) {
					bestMatch = arrTitle;
					bestConfidence = confidence;
				}
			}

			results.push({
				sabItem,
				arrTitle: bestMatch,
				confidence: bestConfidence,
			});
		}

		return results;
	}

	private sanitizeTitle(title: string): string {
		return title
			.toLowerCase()
			.replace(/[.\-_[\]()]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	private calculateTitleSimilarity(title1: string, title2: string): number {
		const words1 = title1.split(" ");
		const words2 = title2.split(" ");

		if (words1.length === 0 || words2.length === 0) return 0;

		let matches = 0;
		for (const word1 of words1) {
			for (const word2 of words2) {
				if (word1.length > 2 && word2.length > 2 && word1 === word2) {
					matches++;
					break;
				}
			}
		}

		return matches / Math.max(words1.length, words2.length);
	}

	private describeError(error: unknown): string {
		if (error && typeof error === "object" && "message" in error) {
			const message = (error as { message?: unknown }).message;
			if (typeof message === "string" && message.length > 0) {
				return message;
			}
		}

		if (error instanceof Error) {
			return error.message;
		}

		return String(error);
	}

	private mapError(error: unknown): ServiceError | InternalError {
		if (error && typeof error === "object" && "status" in error) {
			const errObj = error as { status?: number; message?: string };
			return {
				service: this.serviceName,
				status: errObj.status ?? 500,
				message: errObj.message ?? "SABnzbd API error",
				raw: error,
			};
		}

		return {
			kind: "internal",
			message: `SABnzbd service error: ${String(error)}`,
			cause: error,
		};
	}
}
