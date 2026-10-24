import { z } from "zod";
import { loadConfigFromEnvOnly } from "../config.js";
import {
	createInternalError,
	createServiceError,
	fetchJson,
	serializeError,
} from "../core.js";
import { SonarrService } from "../services/arr/sonarr.js";
import type { ServiceConfig } from "../services/base.js";
import type { LibraryItem, LibrarySnapshot } from "./model.js";

export const count = z.number().int().nonnegative().safe();
export const id = count.positive();
export function parse<T>(
	schema: z.ZodType<T>,
	value: unknown,
	context = "Library provider response",
): T {
	const result = schema.safeParse(value);
	if (!result.success)
		throw createInternalError(`${context} failed schema validation`);
	return result.data;
}
export function endpoint(
	base: string,
	path: string,
	params: Record<string, string | number> = {},
): string {
	const url = new URL(
		`${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
	);
	for (const [key, value] of Object.entries(params))
		url.searchParams.set(key, String(value));
	return url.toString();
}
export async function readJson(
	name: string,
	url: string,
	headers: Record<string, string>,
): Promise<unknown> {
	try {
		return await fetchJson<unknown>(url, { headers });
	} catch (error) {
		const normalized = serializeError(error);
		if ("status" in normalized)
			throw createServiceError(name, normalized.status, normalized.message);
		throw normalized;
	}
}
export async function arrConfigs(): Promise<Record<string, ServiceConfig>> {
	try {
		return (await loadConfigFromEnvOnly()).services;
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("No services configured.")
		)
			return {};
		throw createInternalError(
			"ARR environment configuration is missing or invalid",
		);
	}
}
export async function arrReader(name: string, config: ServiceConfig) {
	// Use the existing adapter's reviewed discovery, pin verification and operation map.
	// No private routing access, subclass override, family guessing or retry on v3.
	if (
		name.toLowerCase().includes("sonarr") &&
		config.apiVersion !== undefined
	) {
		const result = await new SonarrService(name, config).systemStatus();
		if (!result.ok)
			throw (
				result.error ??
				createInternalError("Sonarr API policy verification failed")
			);
		if (result.data?.api?.effectiveOperations.lookupLibraryItem !== 3)
			throw createInternalError(
				"Sonarr API v5 library intelligence workflow not ported; configure an explicitly reviewed v3 instance policy",
			);
	}
	return (path: string, params: Record<string, string | number> = {}) =>
		readJson(name, endpoint(config.baseUrl, `api/v3/${path}`, params), {
			"X-Api-Key": config.apiKey,
		});
}

type Reader = Awaited<ReturnType<typeof arrReader>>;
export async function arrList<T extends { id: number }>(
	read: Reader,
	path: string,
	schema: z.ZodType<T>,
	params: Record<string, string | number> = {},
): Promise<T[]> {
	const out: T[] = [];
	let total: number | undefined;
	for (let page = 1; page <= 100; page++) {
		const raw = await read(path, { ...params, page, pageSize: 250 });
		if (Array.isArray(raw)) {
			if (page !== 1)
				throw createInternalError("Library pagination changed shape");
			out.push(...parse(z.array(schema).max(25000), raw, `ARR /${path}`));
			break;
		}
		const envelope = parse(
			z.object({
				records: z.array(schema),
				totalRecords: count,
				page: id.optional(),
			}),
			raw,
			`ARR /${path}`,
		);
		if (envelope.page !== undefined && envelope.page !== page)
			throw createInternalError("Library pagination returned the wrong page");
		if (total !== undefined && total !== envelope.totalRecords)
			throw createInternalError("Library pagination total changed");
		total = envelope.totalRecords;
		out.push(...envelope.records);
		if (out.length === total) break;
		if (!envelope.records.length || out.length > total || page === 100)
			throw createInternalError("Library pagination is incomplete");
	}
	if (new Set(out.map((value) => value.id)).size !== out.length)
		throw createInternalError("Library identities are ambiguous");
	return out;
}
const rating = z.object({
	value: z.number().finite().nonnegative(),
	votes: count.optional(),
});
const titleSchema = z.object({
	id,
	title: z.string().min(1),
	path: z.string().min(1),
	monitored: z.boolean(),
	status: z.string().min(1),
	year: count.optional(),
	tvdbId: count.nullish(),
	tmdbId: count.nullish(),
	imdbId: z.string().nullish(),
	added: z.string().datetime({ offset: true }).optional(),
	tags: z.array(id),
	ratings: z.union([rating, z.record(z.string(), rating)]).optional(),
	seasons: z
		.array(z.object({ seasonNumber: count, monitored: z.boolean() }))
		.optional(),
	hasFile: z.boolean().optional(),
	movieFile: z.object({ id: count }).nullish(),
	statistics: z
		.object({
			episodeFileCount: count.optional(),
			totalEpisodeCount: count.optional(),
			sizeOnDisk: count.optional(),
		})
		.optional(),
});
const episodeSchema = z.object({
	id,
	seriesId: id,
	seasonNumber: count,
	episodeNumber: id,
	title: z.string(),
	airDateUtc: z.string().datetime({ offset: true }).nullish(),
	airDate: z.string().optional(),
	episodeFileId: count,
	monitored: z.boolean(),
	hasFile: z.boolean(),
});
const fileSchema = z.object({
	id,
	path: z.string().min(1),
	size: count,
	seriesId: id.optional(),
	movieId: id.optional(),
});
const tagSchema = z.object({ id, label: z.string().min(1) });
function ratings(
	value: z.infer<typeof titleSchema>["ratings"],
): LibraryItem["ratings"] {
	if (!value) return [];
	if (typeof value.value === "number") {
		if (value.value > 10)
			throw createInternalError("TVDB rating is outside its 0..10 scale");
		return [
			{
				source: "tvdb",
				value: value.value,
				scale: 10,
				...(typeof value.votes === "number" ? { votes: value.votes } : {}),
			},
		];
	}
	const scales: Record<string, number> = {
		imdb: 10,
		tmdb: 10,
		tvdb: 10,
		trakt: 10,
		metacritic: 100,
		rottenTomatoes: 100,
	};
	return Object.entries(value).flatMap(([source, entry]) => {
		const scale = scales[source];
		if (typeof entry !== "object" || !scale || entry.value > scale)
			throw createInternalError(
				"Unsupported rating source or value outside provider scale",
			);
		return [
			{
				source,
				value: entry.value,
				scale,
				...(entry.votes === undefined ? {} : { votes: entry.votes }),
			},
		];
	});
}
export async function arrDetail(
	name: string,
	read: Reader,
	itemId: number,
	tags: z.infer<typeof tagSchema>[],
): Promise<LibraryItem> {
	const series = name.toLowerCase().includes("sonarr");
	const raw = parse(
		titleSchema,
		await read(`${series ? "series" : "movie"}/${itemId}`),
		`ARR /${series ? "series" : "movie"}/{itemId}`,
	);
	if (raw.id !== itemId)
		throw createInternalError("Library detail identity mismatch");
	const files = await arrList(
		read,
		series ? "episodefile" : "moviefile",
		fileSchema,
		{ [series ? "seriesId" : "movieId"]: itemId },
	);
	const episodes = series
		? await arrList(read, "episode", episodeSchema, { seriesId: itemId })
		: [];
	let complete = !!(raw.tvdbId || raw.tmdbId || raw.imdbId);
	if (
		files.some((file) => (series ? file.seriesId : file.movieId) !== itemId) ||
		episodes.some((ep) => ep.seriesId !== itemId)
	)
		throw createInternalError(
			"Library subresource belongs to a different title",
		);
	const resolvedTags = raw.tags.map(
		(tagId) => tags.find((tag) => tag.id === tagId)?.label,
	);
	if (resolvedTags.some((tag) => tag === undefined)) complete = false;
	if (
		series &&
		(!raw.seasons ||
			new Set(episodes.map((ep) => `${ep.seasonNumber}:${ep.episodeNumber}`))
				.size !== episodes.length)
	)
		complete = false;
	if (
		series &&
		raw.statistics?.totalEpisodeCount !== undefined &&
		raw.statistics.totalEpisodeCount !== episodes.length
	)
		complete = false;
	if (
		series &&
		raw.statistics?.episodeFileCount !== undefined &&
		raw.statistics.episodeFileCount !== files.length
	)
		complete = false;
	if (
		series &&
		episodes.some(
			(ep) =>
				ep.hasFile !== ep.episodeFileId > 0 ||
				(ep.episodeFileId > 0 &&
					!files.some((file) => file.id === ep.episodeFileId)) ||
				!raw.seasons?.some((season) => season.seasonNumber === ep.seasonNumber),
		)
	)
		complete = false;
	if (
		series &&
		files.some((file) => !episodes.some((ep) => ep.episodeFileId === file.id))
	)
		complete = false;
	if (
		!series &&
		(raw.hasFile === undefined ||
			raw.hasFile !== files.length > 0 ||
			(raw.hasFile &&
				(files.length !== 1 || files[0]?.id !== raw.movieFile?.id)))
	)
		complete = false;
	return {
		service: name,
		id: raw.id,
		mediaKind: series ? "series" : "movie",
		title: raw.title,
		year: raw.year,
		providerIds: {
			...(raw.tvdbId ? { tvdb: String(raw.tvdbId) } : {}),
			...(raw.tmdbId ? { tmdb: String(raw.tmdbId) } : {}),
			...(raw.imdbId ? { imdb: raw.imdbId } : {}),
		},
		path: raw.path,
		sizeBytes: files.reduce((sum, file) => sum + file.size, 0),
		addedAt: raw.added,
		status: raw.status,
		monitored: raw.monitored,
		tags: resolvedTags.filter((tag): tag is string => tag !== undefined),
		ratings: ratings(raw.ratings),
		seasons: raw.seasons ?? [],
		episodes: episodes.map((ep) => ({
			id: ep.id,
			seasonNumber: ep.seasonNumber,
			episodeNumber: ep.episodeNumber,
			title: ep.title,
			airDate: ep.airDateUtc ?? ep.airDate,
			...(ep.episodeFileId > 0 ? { fileId: ep.episodeFileId } : {}),
			monitored: ep.monitored,
		})),
		files: files.map((file) => ({
			id: file.id,
			path: file.path,
			sizeBytes: file.size,
			episodeIds: episodes
				.filter((ep) => ep.episodeFileId === file.id)
				.map((ep) => ep.id),
		})),
		complete,
		apiFamily: 3,
	};
}
export async function loadLibrarySnapshot(
	services?: string[],
): Promise<LibrarySnapshot> {
	const configs = await arrConfigs();
	const snapshot: LibrarySnapshot = {
		items: [],
		errors: [],
		complete: true,
		observedAt: new Date().toISOString(),
	};
	for (const name of services ?? Object.keys(configs).sort()) {
		try {
			const config = configs[name];
			if (!config) throw createInternalError("Unknown ARR service");
			const read = await arrReader(name, config);
			const tags = await arrList(read, "tag", tagSchema);
			const items = await arrList(
				read,
				name.toLowerCase().includes("sonarr") ? "series" : "movie",
				z.object({ id }),
			);
			for (const item of items) {
				try {
					snapshot.items.push(await arrDetail(name, read, item.id, tags));
				} catch (error) {
					snapshot.errors.push({
						service: name,
						message: serializeError(error).message,
					});
				}
			}
		} catch (error) {
			snapshot.errors.push({
				service: name,
				message: serializeError(error).message,
			});
		}
	}
	snapshot.complete =
		snapshot.errors.length === 0 &&
		snapshot.items.every((item) => item.complete);
	return snapshot;
}
export async function loadDetail(
	service: string,
	itemId: number,
): Promise<LibraryItem> {
	const config = (await arrConfigs())[service];
	if (!config) throw createInternalError("Unknown ARR service");
	const read = await arrReader(service, config);
	return arrDetail(
		service,
		read,
		itemId,
		await arrList(read, "tag", tagSchema),
	);
}
