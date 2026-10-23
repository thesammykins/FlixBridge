import { z } from "zod";
import { createInternalError, serializeError } from "../core.js";
import { count, parse } from "./arr.js";
import {
	type JellyItem,
	type MediaServerConfig,
	type PlexItem,
	findServer,
	jellyItems,
	jellyUser,
	mediaReader,
	mediaUsers,
	plexIds,
	plexItemSchema,
	plexItems,
	plexLibrary,
} from "./media.js";
import type {
	LibraryItem,
	ProviderIds,
	ViewerScope,
	WatchEvidence,
} from "./model.js";

const scopeSchema = z
	.object({
		server: z.string().min(1).max(200),
		userId: z.string().min(1).max(200),
	})
	.strict();
export const viewersSchema = z.array(scopeSchema).min(1).max(100);
type Status = WatchEvidence["viewers"][number]["status"];
type Viewer = WatchEvidence["viewers"][number];
type Observation = {
	viewer: Viewer;
	active: boolean | null;
	favourite: boolean | null;
	blockers: string[];
};
export function exactMatch(
	wanted: ProviderIds,
	candidates: Array<{ ids: ProviderIds }>,
): number {
	const matches: number[] = [];
	for (const [index, candidate] of candidates.entries()) {
		const shared = (["tvdb", "tmdb", "imdb"] as const).filter(
			(key) => wanted[key] && candidate.ids[key],
		);
		if (!shared.some((key) => wanted[key] === candidate.ids[key])) continue;
		if (shared.some((key) => wanted[key] !== candidate.ids[key]))
			throw createInternalError("Conflicting provider IDs");
		matches.push(index);
	}
	if (matches.length !== 1 || matches[0] === undefined)
		throw createInternalError("Exact provider identity missing or ambiguous");
	return matches[0];
}
export function jellyIds(item: JellyItem): ProviderIds {
	return {
		tvdb: item.ProviderIds?.Tvdb,
		tmdb: item.ProviderIds?.Tmdb,
		imdb: item.ProviderIds?.Imdb,
	};
}
function jellyStatus(item: JellyItem, userId: string): Status {
	if ((item.MediaSources?.length ?? 0) > 1) return "unknown";
	const state = item.UserData;
	if (
		!state ||
		(state.UserId !== undefined && state.UserId !== userId) ||
		state.Played === undefined ||
		state.PlaybackPositionTicks === undefined ||
		(state.Played && state.PlayCount === 0)
	)
		return "unknown";
	if (state.PlaybackPositionTicks > 0) return "partial";
	return state.Played ? "watched" : "unwatched";
}
export function combined(statuses: Status[]): Status {
	if (!statuses.length || statuses.includes("unknown")) return "unknown";
	if (statuses.every((status) => status === "watched")) return "watched";
	if (statuses.every((status) => status === "unwatched")) return "unwatched";
	return "partial";
}
async function jellyEvidence(
	server: MediaServerConfig,
	scope: ViewerScope,
	item: LibraryItem,
	seasonNumber?: number,
): Promise<Observation> {
	await jellyUser(server, scope.userId);
	const candidates = await jellyItems(
		server,
		{ IncludeItemTypes: item.mediaKind === "movie" ? "Movie" : "Series" },
		scope.userId,
	);
	const root =
		candidates[
			exactMatch(
				item.providerIds,
				candidates.map((candidate) => ({ ids: jellyIds(candidate) })),
			)
		];
	if (!root || root.Type !== (item.mediaKind === "movie" ? "Movie" : "Series"))
		throw createInternalError("Jellyfin media kind mismatch");
	const episodes =
		item.mediaKind === "series"
			? await jellyItems(
					server,
					{ ParentId: root.Id, IncludeItemTypes: "Episode" },
					scope.userId,
				)
			: [];
	const selected = item.episodes.filter(
		(episode) =>
			seasonNumber === undefined || episode.seasonNumber === seasonNumber,
	);
	const matched = selected.map((episode) => {
		const matches = episodes.filter(
			(candidate) =>
				candidate.Type === "Episode" &&
				candidate.SeriesId === root.Id &&
				candidate.ParentIndexNumber === episode.seasonNumber &&
				candidate.IndexNumber === episode.episodeNumber,
		);
		return { ...episode, media: matches.length === 1 ? matches[0] : undefined };
	});
	const states = matched.map((episode) => ({
		seasonNumber: episode.seasonNumber,
		episodeNumber: episode.episodeNumber,
		status: episode.media
			? jellyStatus(episode.media, scope.userId)
			: ("unknown" as const),
	}));
	const viewer: Viewer = {
		...scope,
		status:
			item.mediaKind === "movie"
				? jellyStatus(root, scope.userId)
				: combined(states.map((episode) => episode.status)),
		episodes: states,
	};
	const watched = [
		root,
		...matched.flatMap((episode) => (episode.media ? [episode.media] : [])),
	];
	const dates = watched
		.flatMap((entry) =>
			entry.UserData?.LastPlayedDate ? [entry.UserData.LastPlayedDate] : [],
		)
		.sort((left, right) => Date.parse(left) - Date.parse(right));
	if (dates.length) viewer.lastWatchedAt = dates[dates.length - 1];
	const favourite = watched.some((entry) => entry.UserData?.IsFavorite === true)
		? true
		: watched.every((entry) => entry.UserData?.IsFavorite === false) &&
				matched.every((episode) => episode.media)
			? false
			: null;
	// /Sessions can silently restrict non-admin users. Require a reviewed elevated read first.
	parse(
		z.array(z.object({ Id: z.string(), Name: z.string() })),
		await mediaReader(server)("Auth/Providers"),
		"Jellyfin /Auth/Providers elevation probe",
	);
	const sessions = parse(
		z.array(
			z.object({
				UserId: z.string().optional(),
				NowPlayingItem: z
					.object({ Id: z.string().min(1), SeriesId: z.string().optional() })
					.nullish(),
			}),
		),
		await mediaReader(server)("Sessions"),
		"Jellyfin /Sessions",
	);
	const ids = new Set([root.Id, ...episodes.map((episode) => episode.Id)]);
	const active = sessions.some(
		(session) =>
			session.NowPlayingItem &&
			(ids.has(session.NowPlayingItem.Id) ||
				session.NowPlayingItem.SeriesId === root.Id),
	);
	const blockers = [];
	if (viewer.status === "unknown")
		blockers.push("Jellyfin user data or episode coverage is incomplete");
	if (favourite === null)
		blockers.push("Jellyfin favourite coverage is incomplete");
	return { viewer, active, favourite, blockers };
}
function plexViewerToken(server: MediaServerConfig, userId: string): string {
	const tokens: string[] = [];
	if (process.env[`${server.prefix}_USER_ID`] === userId)
		tokens.push(server.token);
	for (const key of Object.keys(process.env)) {
		if (
			!key.startsWith(`${server.prefix}_USER_`) ||
			!key.endsWith("_ID") ||
			key === `${server.prefix}_USER_ID` ||
			process.env[key] !== userId
		)
			continue;
		const token = process.env[`${key.slice(0, -3)}_TOKEN`];
		if (!token)
			throw createInternalError(
				"Plex explicit user token binding is incomplete",
			);
		tokens.push(token);
	}
	if (!tokens.length || new Set(tokens).size !== 1)
		throw createInternalError(
			"Plex requires one explicitly configured per-user token binding; the server owner token is not a fallback",
		);
	return tokens[0] as string;
}
function plexStatus(item: PlexItem): Status {
	if (item.viewCount === undefined) return "unknown";
	if ((item.viewOffset ?? 0) > 0) return "partial";
	return item.viewCount > 0 ? "watched" : "unwatched";
}
async function plexEvidence(
	server: MediaServerConfig,
	scope: ViewerScope,
	item: LibraryItem,
	seasonNumber?: number,
): Promise<Observation> {
	const token = plexViewerToken(server, scope.userId);
	if (!(await mediaUsers(server)).some((user) => user.userId === scope.userId))
		throw createInternalError(
			"Plex account is not present on the selected server",
		);
	const candidates = (await plexLibrary(server, token)).filter(
		(candidate) =>
			candidate.type === (item.mediaKind === "series" ? "show" : "movie"),
	);
	const root =
		candidates[
			exactMatch(
				item.providerIds,
				candidates.map((candidate) => ({ ids: plexIds(candidate) })),
			)
		];
	if (!root)
		throw createInternalError("Plex exact provider match is unavailable");
	const episodes =
		item.mediaKind === "series"
			? await plexItems(
					server,
					`library/metadata/${encodeURIComponent(root.ratingKey)}/allLeaves`,
					{},
					token,
				)
			: [];
	const states = item.episodes
		.filter(
			(episode) =>
				seasonNumber === undefined || episode.seasonNumber === seasonNumber,
		)
		.map((episode) => {
			const matches = episodes.filter(
				(candidate) =>
					candidate.type === "episode" &&
					candidate.grandparentRatingKey === root.ratingKey &&
					candidate.parentIndex === episode.seasonNumber &&
					candidate.index === episode.episodeNumber,
			);
			return {
				seasonNumber: episode.seasonNumber,
				episodeNumber: episode.episodeNumber,
				status:
					matches.length === 1 && matches[0]
						? plexStatus(matches[0])
						: ("unknown" as const),
			};
		});
	const viewer: Viewer = {
		...scope,
		status:
			item.mediaKind === "movie"
				? plexStatus(root)
				: combined(states.map((episode) => episode.status)),
		episodes: states,
	};
	const last = Math.max(
		root.lastViewedAt ?? 0,
		...episodes
			.filter(
				(episode) =>
					seasonNumber === undefined || episode.parentIndex === seasonNumber,
			)
			.map((episode) => episode.lastViewedAt ?? 0),
	);
	if (last > 0) viewer.lastWatchedAt = new Date(last * 1000).toISOString();
	const { MediaContainer: sessions } = parse(
		z.object({
			MediaContainer: z.object({
				size: count,
				Metadata: z.array(plexItemSchema).optional(),
			}),
		}),
		await mediaReader(server)("status/sessions"),
		"Plex /status/sessions",
	);
	if (sessions.size !== (sessions.Metadata?.length ?? 0))
		throw createInternalError("Plex active session coverage is incomplete");
	const ids = new Set([
		root.ratingKey,
		...episodes.map((episode) => episode.ratingKey),
	]);
	const active = (sessions.Metadata ?? []).some(
		(session) =>
			ids.has(session.ratingKey) ||
			session.grandparentRatingKey === root.ratingKey,
	);
	return {
		viewer,
		active,
		favourite: null,
		blockers: [
			"Plex favourite/watchlist protection is unsupported; ratings are not favourites",
			...(viewer.status === "unknown"
				? ["Plex user summary or episode coverage is incomplete"]
				: []),
		],
	};
}
export async function playbackHistory(
	server: MediaServerConfig,
	userId: string,
	page = 1,
	pageSize = 50,
) {
	if (!(await mediaUsers(server)).some((user) => user.userId === userId))
		throw createInternalError(
			"Plex account is not present on the selected server",
		);
	const offset = (page - 1) * pageSize;
	const entry = z.object({
		historyKey: z.string().min(1),
		ratingKey: z.string().min(1),
		type: z.string(),
		title: z.string(),
		accountID: z.union([count, z.string().min(1)]),
		viewedAt: count.max(8640000000000),
		parentIndex: count.optional(),
		index: count.optional(),
	});
	const { MediaContainer: result } = parse(
		z.object({
			MediaContainer: z.object({
				size: count,
				totalSize: count,
				offset: count.optional(),
				Metadata: z.array(entry).optional(),
			}),
		}),
		await mediaReader(server)("status/sessions/history", {
			accountID: userId,
			"X-Plex-Container-Start": offset,
			"X-Plex-Container-Size": pageSize,
			sort: "viewedAt:desc",
		}),
		"Plex /status/sessions/history",
	);
	const records = result.Metadata ?? [];
	if (
		result.size !== records.length ||
		records.length > pageSize ||
		(result.offset !== undefined && result.offset !== offset) ||
		(offset < result.totalSize && !records.length) ||
		(records.length > 0 && offset + records.length > result.totalSize) ||
		records.some((record) => String(record.accountID) !== userId) ||
		new Set(records.map((record) => record.historyKey)).size !== records.length
	)
		throw createInternalError(
			"Plex history account scope or pagination failed validation",
		);
	return {
		server: server.name,
		userId,
		supported: true,
		events: records.map((record) => ({
			id: record.historyKey,
			itemId: record.ratingKey,
			title: record.title,
			mediaType: record.type,
			watchedAt: new Date(record.viewedAt * 1000).toISOString(),
			...(record.parentIndex === undefined
				? {}
				: { seasonNumber: record.parentIndex }),
			...(record.index === undefined ? {} : { episodeNumber: record.index }),
		})),
		total: result.totalSize,
		page,
		pageSize,
		hasMore: offset + records.length < result.totalSize,
		complete: true,
	};
}
export async function getWatchEvidence(
	item: LibraryItem,
	users: ViewerScope[],
	seasonNumber?: number,
): Promise<WatchEvidence> {
	if (
		!viewersSchema.safeParse(users).success ||
		new Set(users.map((user) => JSON.stringify([user.server, user.userId])))
			.size !== users.length
	)
		throw createInternalError("Explicit unique viewer scopes are required");
	if (
		seasonNumber !== undefined &&
		(!count.safeParse(seasonNumber).success || item.mediaKind !== "series")
	)
		throw createInternalError("Season scope requires a valid series season");
	const evidence: WatchEvidence = {
		complete: false,
		activePlayback: null,
		favourite: null,
		viewers: [],
		blockers: item.complete ? [] : ["ARR item coverage is incomplete"],
	};
	const observations: Observation[] = [];
	for (const scope of users) {
		try {
			const server = findServer(scope.server);
			observations.push(
				await (server.type === "jellyfin"
					? jellyEvidence(server, scope, item, seasonNumber)
					: plexEvidence(server, scope, item, seasonNumber)),
			);
		} catch (error) {
			observations.push({
				viewer: { ...scope, status: "unknown", episodes: [] },
				active: null,
				favourite: null,
				blockers: [serializeError(error).message],
			});
		}
	}
	for (const observation of observations) {
		evidence.viewers.push(observation.viewer);
		evidence.blockers.push(
			...observation.blockers.map(
				(blocker) => `${observation.viewer.server}: ${blocker}`,
			),
		);
	}
	const combineFlag = (values: Array<boolean | null>) =>
		values.includes(true)
			? true
			: values.every((value) => value === false)
				? false
				: null;
	evidence.activePlayback = combineFlag(
		observations.map((observation) => observation.active),
	);
	evidence.favourite = combineFlag(
		observations.map((observation) => observation.favourite),
	);
	evidence.complete =
		evidence.blockers.length === 0 &&
		evidence.viewers.every((viewer) => viewer.status !== "unknown") &&
		evidence.activePlayback !== null &&
		evidence.favourite !== null;
	return evidence;
}
