import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { createInternalError, handleError } from "../../core.js";
import { requestSignal } from "../../request-context.js";
import type {
	OperationResult,
	ServiceConfig,
	ServiceImplementation,
	SonarrApiPolicy,
} from "../base.js";
import { BaseArrService } from "../shared.js";

const DiscoverySchema = z.object({
	current: z.string().regex(/^v[1-9]\d*$/),
	deprecated: z.array(z.string().regex(/^v[1-9]\d*$/)),
});
const StatusSchema = z.object({
	appName: z.literal("Sonarr"),
	version: z.string().min(1),
});
const CountSchema = z.number().int().nonnegative().safe();
const LibraryStatisticsSchema = z.object({
	seriesCount: CountSchema,
	monitoredSeriesCount: CountSchema,
	completedSeriesCount: CountSchema,
	continuingSeriesCount: CountSchema,
	endedSeriesCount: CountSchema,
	upcomingSeriesCount: CountSchema,
	deletedSeriesCount: CountSchema,
	standardSeriesCount: CountSchema,
	dailySeriesCount: CountSchema,
	animeSeriesCount: CountSchema,
	seasonCount: CountSchema,
	completedSeasonCount: CountSchema,
	totalEpisodeCount: CountSchema,
	monitoredEpisodeCount: CountSchema,
	downloadedEpisodeCount: CountSchema,
	missingEpisodeCount: CountSchema,
	unairedEpisodeCount: CountSchema,
	episodeFileCount: CountSchema,
	sizeOnDisk: CountSchema,
	qualityProfileStatistics: z.array(
		z.object({
			qualityProfileId: CountSchema,
			name: z.string(),
			seriesCount: CountSchema,
			episodeFileCount: CountSchema,
			sizeOnDisk: CountSchema,
		}),
	),
	qualityStatistics: z.array(
		z.object({
			quality: z.object({
				id: CountSchema,
				name: z.string(),
				resolution: CountSchema.optional(),
				source: z.string().optional(),
			}),
			episodeFileCount: CountSchema,
			sizeOnDisk: CountSchema,
		}),
	),
	tagStatistics: z.array(
		z.object({
			tagId: CountSchema,
			label: z.string(),
			seriesCount: CountSchema,
			episodeFileCount: CountSchema,
			sizeOnDisk: CountSchema,
		}),
	),
});
const DISCOVERY_MAX_AGE_MS = 5 * 60 * 1000;
type Family = 3 | 5;
// Only reviewed end-to-end workflows may select v5. Absence is not a fallback.
const V3_ONLY_OPERATIONS = [
	"importIssues",
	"deleteFile",
	"prepareRemoval",
	"executeRemoval",
	"queueDiagnosticsAutoFix",
];
const V5_OPERATIONS = new Set([
	"systemStatus",
	"queueList",
	"rootFolderList",
	"historyDetail",
	"search",
	"listQualityProfiles",
	"lookupLibraryItem",
	"lookupEpisodeFile",
	"queueDiagnostics",
	"previewManualImport",
	"executeManualImport",
	"updateQualityProfile",
	"addNew",
	"libraryStatistics",
	"queueGrab",
	"triggerSearch",
]);

export class SonarrService
	extends BaseArrService
	implements ServiceImplementation
{
	readonly id = "sonarr" as const;
	readonly mediaKind = "series" as const;
	readonly endpoints = {
		lookup: "/series/lookup",
		add: "/series",
		wanted: "/wanted/missing",
	};
	private readonly policy: SonarrApiPolicy | undefined;
	private readonly route = new AsyncLocalStorage<Family>();
	private discovery?: {
		current: string;
		deprecated: string[];
		at: number;
		verified: Set<Family>;
	};
	private discovering?: Promise<NonNullable<SonarrService["discovery"]>>;
	private readonly verifying = new Map<Family, Promise<void>>();
	private readonly removalPlans = new WeakMap<
		Parameters<BaseArrService["executeRemoval"]>[0],
		Family
	>();
	private readonly importPlans = new WeakMap<
		Parameters<BaseArrService["executeManualImport"]>[0],
		Family
	>();

	constructor(serviceName: string, config: ServiceConfig) {
		super(serviceName, config);
		this.policy = config.apiVersion;
	}

	protected override async prepareAddPayload(
		request: Parameters<BaseArrService["addNew"]>[0],
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		if (this.apiFamily() !== 5) return payload;
		// ponytail: reviewed metadata language IDs 1..53; extend after upstream review.
		// Language.cs + IsoLanguages.cs exclude Unknown and Original from metadata.
		const schema = z.array(
			z
				.object({
					tvdbId: z.number().int().positive(),
					title: z.string().min(1),
					language: z.object({
						id: z.number().int().min(1).max(53),
						name: z.string().min(1),
					}),
					seasonType: z.string().min(1),
				})
				.passthrough(),
		);
		const lookup = schema.safeParse(
			await this.fetchJson(
				this.buildApiUrl(this.endpoints.lookup, {
					term: `tvdb:${request.foreignId}`,
				}),
			),
		);
		if (!lookup.success)
			throw createInternalError(
				"Sonarr v5 add requires a validated lookup with language and seasonType; no defaults are supplied",
			);
		const matches = lookup.data.filter(
			(item) => item.tvdbId === request.foreignId,
		);
		const match = matches[0];
		if (matches.length !== 1 || !match)
			throw createInternalError(
				"Sonarr v5 add requires one exact foreign-ID lookup match",
			);
		return { ...match, ...payload, title: match.title };
	}

	protected override strictContracts(): boolean {
		return this.policy !== undefined;
	}

	protected override apiFamily(): Family {
		return this.route.getStore() ?? 3;
	}

	private async discover() {
		const age = this.discovery ? Date.now() - this.discovery.at : undefined;
		if (
			this.discovery &&
			age !== undefined &&
			age >= 0 &&
			age < DISCOVERY_MAX_AGE_MS
		)
			return this.discovery;
		const load = async () => {
			const parsed = DiscoverySchema.safeParse(
				await this.fetchJson(this.buildDiscoveryUrl()),
			);
			if (!parsed.success)
				throw createInternalError(
					"Sonarr API discovery failed validation; check the URL base and configured API policy",
				);
			const info = {
				...parsed.data,
				at: Date.now(),
				verified: new Set<Family>(),
			};
			this.discovery = info;
			return info;
		};
		// ponytail: cancelable cold callers probe independently; share completed results.
		// Signal-free callers retain in-flight deduplication without a caller owner.
		if (requestSignal.getStore()) return load();
		this.discovering ??= load();
		try {
			return await this.discovering;
		} finally {
			this.discovering = undefined;
		}
	}

	private async verify(
		family: Family,
		info: NonNullable<SonarrService["discovery"]>,
	) {
		if (info.verified.has(family)) return;
		if (![info.current, ...info.deprecated].includes(`v${family}`))
			throw createInternalError(
				`Sonarr API v${family} is not advertised; review this instance's API policy`,
			);
		const probe = async () => {
			const status = await this.fetchJson(
				`${this.buildDiscoveryUrl()}/v${family}/system/status`,
			);
			if (!StatusSchema.safeParse(status).success)
				throw createInternalError(
					`Sonarr API v${family} status failed validation`,
				);
			info.verified.add(family);
		};
		if (requestSignal.getStore()) return probe();
		if (!this.verifying.has(family)) this.verifying.set(family, probe());
		try {
			await this.verifying.get(family);
		} finally {
			this.verifying.delete(family);
		}
	}

	private effectiveFamily(operation: string): Family | "unsupported" {
		if (this.policy === undefined)
			return operation === "libraryStatistics" ? "unsupported" : 3;
		if (this.policy === 3)
			return operation === "libraryStatistics" ? "unsupported" : 3;
		if (this.policy === 5)
			return V5_OPERATIONS.has(operation) ? 5 : "unsupported";
		if (this.discovery?.current === "v5" && V5_OPERATIONS.has(operation))
			return 5;
		if (
			operation !== "libraryStatistics" &&
			[this.discovery?.current, ...(this.discovery?.deprecated ?? [])].includes(
				"v3",
			)
		)
			return 3;
		return "unsupported";
	}

	private async routed<T>(
		operation: string,
		run: () => Promise<OperationResult<T>>,
		frozenFamily?: Family,
	): Promise<OperationResult<T>> {
		try {
			const inherited = this.route.getStore();
			if (inherited) return await run();
			if (this.policy === undefined) return await this.route.run(3, run);
			const info = await this.discover();
			if (this.policy === 5 && !V5_OPERATIONS.has(operation))
				throw createInternalError(
					`Sonarr API v5 workflow not ported: ${operation}; use an explicitly reviewed v3 instance policy`,
				);
			const family = frozenFamily ?? this.effectiveFamily(operation);
			if (
				frozenFamily &&
				this.policy !== "auto" &&
				this.policy !== frozenFamily
			)
				throw createInternalError(
					"Sonarr preview API family conflicts with the configured policy; preview again",
				);
			if (family === "unsupported")
				throw createInternalError(
					`Sonarr current API ${info.current} has no reviewed route for ${operation}; configure an advertised reviewed family explicitly`,
				);
			await this.verify(family, info);
			return await this.route.run(family, run);
		} catch (error) {
			return handleError(error, this.serviceName);
		}
	}

	override queueList(options: Parameters<BaseArrService["queueList"]>[0] = {}) {
		return this.routed("queueList", () => super.queueList(options));
	}

	override queueGrab(...args: Parameters<BaseArrService["queueGrab"]>) {
		return this.routed("queueGrab", () => super.queueGrab(...args));
	}
	override rootFolderList(
		...args: Parameters<BaseArrService["rootFolderList"]>
	) {
		return this.routed("rootFolderList", () => super.rootFolderList(...args));
	}
	override historyDetail(...args: Parameters<BaseArrService["historyDetail"]>) {
		return this.routed("historyDetail", () => super.historyDetail(...args));
	}
	override search(...args: Parameters<BaseArrService["search"]>) {
		return this.routed("search", () => super.search(...args));
	}
	override addNew(...args: Parameters<BaseArrService["addNew"]>) {
		return this.routed("addNew", () => super.addNew(...args));
	}
	override importIssues(...args: Parameters<BaseArrService["importIssues"]>) {
		return this.routed("importIssues", () => super.importIssues(...args));
	}
	override listQualityProfiles(
		...args: Parameters<BaseArrService["listQualityProfiles"]>
	) {
		return this.routed("listQualityProfiles", () =>
			super.listQualityProfiles(...args),
		);
	}
	override lookupLibraryItem(
		...args: Parameters<BaseArrService["lookupLibraryItem"]>
	) {
		return this.routed("lookupLibraryItem", () =>
			super.lookupLibraryItem(...args),
		);
	}
	override deleteFile(...args: Parameters<BaseArrService["deleteFile"]>) {
		return this.routed("deleteFile", () => super.deleteFile(...args));
	}
	override triggerSearch(...args: Parameters<BaseArrService["triggerSearch"]>) {
		return this.routed("triggerSearch", () => super.triggerSearch(...args));
	}
	override updateQualityProfile(
		...args: Parameters<BaseArrService["updateQualityProfile"]>
	) {
		return this.routed("updateQualityProfile", () =>
			super.updateQualityProfile(...args),
		);
	}
	override lookupEpisodeFile(
		...args: Parameters<BaseArrService["lookupEpisodeFile"]>
	) {
		return this.routed("lookupEpisodeFile", () =>
			super.lookupEpisodeFile(...args),
		);
	}
	override prepareRemoval(
		...args: Parameters<BaseArrService["prepareRemoval"]>
	) {
		return this.routed("prepareRemoval", async () => {
			const result = await super.prepareRemoval(...args);
			if (result.data) {
				result.data.apiFamily = this.apiFamily();
				this.removalPlans.set(result.data, this.apiFamily());
			}
			return result;
		});
	}
	override executeRemoval(
		...args: Parameters<BaseArrService["executeRemoval"]>
	) {
		const preparation = args[0];
		const plan = this.removalPlans.get(preparation);
		if (
			preparation.service !== this.serviceName ||
			(this.policy !== undefined && (!plan || plan !== preparation.apiFamily))
		)
			return Promise.resolve(
				handleError(
					createInternalError(
						"Sonarr removal preparation does not bind this instance and API family; preview again",
					),
					this.serviceName,
				),
			);
		return this.routed(
			"executeRemoval",
			() => super.executeRemoval(...args),
			plan ?? preparation.apiFamily,
		);
	}
	override previewManualImport(
		...args: Parameters<BaseArrService["previewManualImport"]>
	) {
		return this.routed("previewManualImport", async () => {
			const result = await super.previewManualImport(...args);
			if (result.data) {
				result.data.apiFamily = this.apiFamily();
				this.importPlans.set(result.data, this.apiFamily());
			}
			return result;
		});
	}
	override executeManualImport(
		...args: Parameters<BaseArrService["executeManualImport"]>
	) {
		const preview = args[0];
		const plan = this.importPlans.get(preview);
		if (
			preview.service !== this.serviceName ||
			(this.policy !== undefined &&
				!this.route.getStore() &&
				(!plan || plan !== preview.apiFamily))
		)
			return Promise.resolve(
				handleError(
					createInternalError(
						"Sonarr import preview does not bind this instance and API family; preview again",
					),
					this.serviceName,
				),
			);
		return this.routed(
			"executeManualImport",
			() => super.executeManualImport(...args),
			plan ?? this.route.getStore() ?? preview.apiFamily,
		);
	}
	override queueDiagnostics(autoFix = false) {
		return this.routed(
			autoFix ? "queueDiagnosticsAutoFix" : "queueDiagnostics",
			() => super.queueDiagnostics(autoFix),
		);
	}

	override libraryStatistics() {
		if (this.policy === undefined || this.policy === 3)
			return super.libraryStatistics();
		return this.routed("libraryStatistics", async () => {
			if (this.apiFamily() !== 5) return super.libraryStatistics();
			const parsed = LibraryStatisticsSchema.safeParse(
				await this.fetchJson(this.buildApiUrl("/statistics")),
			);
			if (!parsed.success)
				throw createInternalError(
					"Sonarr v5 library statistics failed validation",
				);
			return {
				ok: true,
				data: {
					service: this.serviceName,
					apiFamily: 5 as const,
					statistics: parsed.data,
				},
			};
		});
	}

	override systemStatus() {
		return this.routed("systemStatus", async () => {
			const result = await super.systemStatus();
			if (result.data)
				result.data.api = {
					configuredPolicy: this.policy ?? "legacy",
					current: this.discovery?.current,
					deprecated: this.discovery?.deprecated ?? [],
					verifiedFamilies: [...(this.discovery?.verified ?? [])],
					effectiveOperations: Object.fromEntries(
						[...V5_OPERATIONS, ...V3_ONLY_OPERATIONS].map((operation) => [
							operation,
							this.effectiveFamily(operation),
						]),
					),
				};
			return result;
		});
	}
}
