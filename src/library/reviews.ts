import { z } from "zod";
import { createInternalError, serializeError } from "../core.js";
import { count, endpoint, id, parse, readJson } from "./arr.js";
import type { LibraryItem } from "./model.js";

/** Provider text is data only: it is never fed to the retention rule evaluator. */
export async function reviewMetadata(
	item: LibraryItem,
	requested: boolean,
	page = 1,
) {
	const token = process.env.TMDB_API_TOKEN ?? process.env.TMDB_TOKEN;
	const key = process.env.TMDB_API_KEY;
	const base = { source: "tmdb", executableConditions: false, items: [] };
	if (!token && !key)
		return {
			...base,
			capability: "unconfigured",
			reason:
				"Configure TMDB_API_KEY or TMDB_API_TOKEN to enable optional review metadata",
		};
	if (!item.providerIds.tmdb || !/^\d+$/.test(item.providerIds.tmdb))
		return {
			...base,
			capability: "unsupported",
			reason:
				"An exact TMDB provider ID is required; no title-based review lookup",
		};
	if (!requested)
		return {
			...base,
			capability: "configured",
			reason: "Pass includeReviews:true to fetch provider content",
		};
	const kind = item.mediaKind === "series" ? "tv" : "movie";
	const tmdbId = Number(item.providerIds.tmdb);
	if (!id.safeParse(tmdbId).success)
		return {
			...base,
			capability: "unsupported",
			reason: "TMDB identity is outside supported bounds",
		};
	const params: Record<string, string | number> = token
		? {}
		: { api_key: key ?? "" };
	const headers: Record<string, string> = token
		? { Authorization: `Bearer ${token}` }
		: {};
	const read = (suffix: string, query: Record<string, string | number> = {}) =>
		readJson(
			"tmdb",
			endpoint(
				"https://api.themoviedb.org/3",
				`${kind}/${item.providerIds.tmdb}${suffix}`,
				{ ...params, ...query },
			),
			headers,
		);
	try {
		const details = parse(
			z.object({
				id: z.literal(tmdbId),
				vote_average: z.number().min(0).max(10),
				vote_count: count,
			}),
			await read(""),
			"TMDB title detail",
		);
		const review = z.object({
			id: z.string().min(1),
			author: z.string(),
			content: z.string().max(100000),
			url: z
				.string()
				.url()
				.refine((url) => {
					const parsed = new URL(url);
					return (
						parsed.protocol === "https:" &&
						["www.themoviedb.org", "themoviedb.org"].includes(
							parsed.hostname,
						) &&
						!parsed.username &&
						!parsed.password
					);
				}),
			created_at: z.string().datetime({ offset: true }),
			updated_at: z.string().datetime({ offset: true }).optional(),
			author_details: z
				.object({ rating: z.number().min(0).max(10).nullable().optional() })
				.optional(),
		});
		const result = parse(
			z.object({
				id: z.literal(tmdbId),
				page: z.literal(page),
				total_pages: count,
				total_results: count,
				results: z.array(review).max(20),
			}),
			await read("/reviews", { page }),
			"TMDB /{kind}/{id}/reviews",
		);
		if (
			(result.total_results > 0 &&
				!result.results.length &&
				page <= result.total_pages) ||
			result.results.length > result.total_results ||
			new Set(result.results.map((entry) => entry.id)).size !==
				result.results.length
		)
			throw createInternalError("TMDB review pagination failed validation");
		return {
			...base,
			capability: "supported",
			sourceUrl: `https://www.themoviedb.org/${kind}/${item.providerIds.tmdb}`,
			trust: "untrusted-provider-content",
			rating: {
				source: "tmdb",
				value: details.vote_average,
				scale: 10,
				votes: details.vote_count,
			},
			items: result.results.map((entry) => ({
				id: entry.id,
				author: entry.author,
				content: entry.content,
				sourceUrl: entry.url,
				createdAt: entry.created_at,
				updatedAt: entry.updated_at,
				rating: entry.author_details?.rating,
			})),
			page,
			total: result.total_results,
			totalPages: result.total_pages,
			hasMore: page < result.total_pages,
			complete: result.total_pages <= 1,
		};
	} catch (error) {
		return {
			...base,
			capability: "unavailable",
			complete: false,
			error: serializeError(error),
		};
	}
}
