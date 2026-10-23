import { z } from "zod";
import { createInternalError } from "../core.js";
import { count, endpoint, parse, readJson } from "./arr.js";
import type { ProviderIds } from "./model.js";

export interface MediaServerConfig {
	name: string;
	type: "plex" | "jellyfin";
	baseUrl: string;
	token: string;
	prefix: string;
}
export function serverConfigs(): MediaServerConfig[] {
	const servers: MediaServerConfig[] = [];
	for (const type of ["PLEX", "JELLYFIN"] as const) {
		const prefixes = new Set<string>();
		for (const key of Object.keys(process.env)) {
			const match = key.match(
				new RegExp(`^((?:FLIX_BRIDGE_)?${type}_[A-Z0-9_]+)_(?:URL|BASE_URL)$`),
			);
			if (match?.[1]) prefixes.add(match[1].replace(/_BASE$/, ""));
		}
		if (
			[
				`${type}_URL`,
				`${type}_BASE_URL`,
				`FLIX_BRIDGE_${type}_URL`,
				`FLIX_BRIDGE_${type}_BASE_URL`,
			].some((key) => process.env[key])
		)
			prefixes.add(
				process.env[`${type}_URL`] || process.env[`${type}_BASE_URL`]
					? type
					: `FLIX_BRIDGE_${type}`,
			);
		const bySlug = new Map<string, MediaServerConfig>();
		for (const prefix of [...prefixes].sort()) {
			const baseUrl =
				process.env[`${prefix}_URL`] ?? process.env[`${prefix}_BASE_URL`];
			const token =
				process.env[`${prefix}_${type === "PLEX" ? "TOKEN" : "API_KEY"}`] ??
				process.env[`${prefix}_TOKEN`] ??
				process.env[`${prefix}_KEY`];
			if (!baseUrl || !token)
				throw createInternalError(
					"Media server configuration requires URL and token/API_KEY",
				);
			let parsed: URL;
			try {
				parsed = new URL(baseUrl);
			} catch {
				throw createInternalError("Invalid media server URL");
			}
			if (
				!/^https?:$/.test(parsed.protocol) ||
				parsed.username ||
				parsed.password ||
				parsed.search ||
				parsed.hash
			)
				throw createInternalError("Invalid media server URL");
			const slug = prefix
				.replace(/^FLIX_BRIDGE_/, "")
				.slice(type.length)
				.replace(/^_/, "")
				.toLowerCase()
				.replace(/_/g, "-");
			const name =
				process.env[`${prefix}_NAME`] ??
				`${type.toLowerCase()}${slug ? `-${slug}` : ""}`;
			if (!z.string().min(1).max(200).safeParse(name).success)
				throw createInternalError("Invalid media server name");
			const config: MediaServerConfig = {
				name,
				type: type === "PLEX" ? "plex" : "jellyfin",
				baseUrl: parsed.toString().replace(/\/+$/, ""),
				token,
				prefix,
			};
			const prior = bySlug.get(slug);
			if (
				prior &&
				(prior.baseUrl !== config.baseUrl ||
					prior.token !== config.token ||
					prior.name !== name)
			)
				throw createInternalError(
					"Conflicting media server configuration aliases",
				);
			bySlug.set(slug, config);
		}
		servers.push(...bySlug.values());
	}
	if (new Set(servers.map((server) => server.name)).size !== servers.length)
		throw createInternalError("Duplicate media server names");
	return servers.sort((a, b) => a.name.localeCompare(b.name));
}
export function mediaReader(server: MediaServerConfig, token = server.token) {
	return (path: string, params: Record<string, string | number> = {}) =>
		readJson(
			server.name,
			endpoint(server.baseUrl, path, params),
			server.type === "plex"
				? { "X-Plex-Token": token, Accept: "application/json" }
				: { "X-Emby-Token": token },
		);
}
export function findServer(name: string): MediaServerConfig {
	const server = serverConfigs().find((candidate) => candidate.name === name);
	if (!server) throw createInternalError("Unknown media server");
	return server;
}
export const jellyItemSchema = z.object({
	Id: z.string().min(1),
	Name: z.string(),
	Type: z.string(),
	ProviderIds: z.record(z.string()).optional(),
	MediaSources: z
		.array(z.object({ Id: z.string().optional(), Path: z.string().optional() }))
		.optional(),
	SeriesId: z.string().optional(),
	ParentIndexNumber: count.optional(),
	IndexNumber: count.optional(),
	UserData: z
		.object({
			UserId: z.string().optional(),
			Played: z.boolean().optional(),
			PlayCount: count.optional(),
			PlaybackPositionTicks: count.optional(),
			IsFavorite: z.boolean().optional(),
			LastPlayedDate: z.string().datetime({ offset: true }).optional(),
		})
		.optional(),
});
export type JellyItem = z.infer<typeof jellyItemSchema>;
export async function jellyItems(
	server: MediaServerConfig,
	params: Record<string, string | number>,
	userId?: string,
): Promise<JellyItem[]> {
	const items: JellyItem[] = [];
	let total: number | undefined;
	for (let page = 0; page < 100; page++) {
		const result = parse(
			z.object({
				Items: z.array(jellyItemSchema),
				TotalRecordCount: count,
				StartIndex: count.optional(),
			}),
			await mediaReader(server)(
				userId ? `Users/${encodeURIComponent(userId)}/Items` : "Items",
				{
					Recursive: "true",
					Fields: "ProviderIds,MediaSources",
					EnableUserData: userId ? "true" : "false",
					EnableTotalRecordCount: "true",
					...params,
					StartIndex: items.length,
					Limit: 250,
				},
			),
			userId ? "Jellyfin /Users/{userId}/Items" : "Jellyfin /Items",
		);
		if (
			(total !== undefined && total !== result.TotalRecordCount) ||
			(result.StartIndex !== undefined && result.StartIndex !== items.length)
		)
			throw createInternalError("Jellyfin pagination changed");
		total = result.TotalRecordCount;
		items.push(...result.Items);
		if (items.length === total) break;
		if (!result.Items.length || items.length > total || page === 99)
			throw createInternalError("Jellyfin pagination is incomplete");
	}
	if (new Set(items.map((item) => item.Id)).size !== items.length)
		throw createInternalError("Jellyfin identities are ambiguous");
	return items;
}
export async function jellyUser(
	server: MediaServerConfig,
	userId: string,
): Promise<void> {
	const user = parse(
		z.object({ Id: z.string().min(1) }),
		await mediaReader(server)(`Users/${encodeURIComponent(userId)}`),
		"Jellyfin /Users/{userId}",
	);
	if (user.Id !== userId)
		throw createInternalError("Jellyfin user identity mismatch");
}
export async function mediaStatus(name: string) {
	const server = findServer(name);
	if (server.type === "jellyfin") {
		const status = parse(
			z.object({
				Id: z.string().min(1),
				ServerName: z.string(),
				Version: z.string().min(1),
			}),
			await mediaReader(server)("System/Info"),
			"Jellyfin /System/Info",
		);
		return {
			service: name,
			type: server.type,
			id: status.Id,
			name: status.ServerName,
			version: status.Version,
			isHealthy: true,
		};
	}
	const status = parse(
		z.object({
			MediaContainer: z.object({
				machineIdentifier: z.string().min(1),
				version: z.string().min(1),
			}),
		}),
		await mediaReader(server)("identity"),
		"Plex /identity",
	);
	return {
		service: name,
		type: server.type,
		id: status.MediaContainer.machineIdentifier,
		version: status.MediaContainer.version,
		isHealthy: true,
	};
}
export const plexItemSchema = z.object({
	ratingKey: z.string().min(1),
	title: z.string(),
	type: z.string(),
	guid: z.string().optional(),
	Guid: z.array(z.object({ id: z.string() })).optional(),
	parentIndex: count.optional(),
	index: count.optional(),
	grandparentRatingKey: z.string().optional(),
	viewCount: count.optional(),
	viewOffset: count.optional(),
	lastViewedAt: count.optional(),
});
export type PlexItem = z.infer<typeof plexItemSchema>;
export function plexIds(item: PlexItem): ProviderIds {
	const ids: ProviderIds = {};
	for (const guid of [
		...(item.Guid ?? []).map((entry) => entry.id),
		...(item.guid ? [item.guid] : []),
	]) {
		const match =
			guid.match(/^(tvdb|tmdb|imdb):\/\/(tt\d+|\d+)$/) ??
			guid.match(
				/^com\.plexapp\.agents\.(thetvdb|themoviedb|imdb):\/\/(tt\d+|\d+)(?:\?[^#]*)?$/,
			);
		if (!match?.[1] || !match[2]) continue;
		const key =
			match[1] === "thetvdb"
				? "tvdb"
				: match[1] === "themoviedb"
					? "tmdb"
					: match[1];
		if (key !== "tvdb" && key !== "tmdb" && key !== "imdb") continue;
		if (ids[key] && ids[key] !== match[2])
			throw createInternalError("Conflicting Plex GUIDs");
		ids[key] = match[2];
	}
	return ids;
}
export async function plexItems(
	server: MediaServerConfig,
	path: string,
	params: Record<string, string | number> = {},
	token = server.token,
): Promise<PlexItem[]> {
	const items: PlexItem[] = [];
	let total: number | undefined;
	for (let page = 0; page < 100; page++) {
		const { MediaContainer: result } = parse(
			z.object({
				MediaContainer: z.object({
					size: count,
					totalSize: count,
					offset: count.optional(),
					Metadata: z.array(plexItemSchema).optional(),
				}),
			}),
			await mediaReader(server, token)(path, {
				includeGuids: 1,
				...params,
				"X-Plex-Container-Start": items.length,
				"X-Plex-Container-Size": 250,
			}),
			"Plex library metadata page",
		);
		if (
			result.size !== (result.Metadata?.length ?? 0) ||
			(total !== undefined && total !== result.totalSize) ||
			(result.offset !== undefined && result.offset !== items.length)
		)
			throw createInternalError("Plex pagination changed");
		total = result.totalSize;
		items.push(...(result.Metadata ?? []));
		if (items.length === total) break;
		if (!result.size || items.length > total || page === 99)
			throw createInternalError("Plex pagination is incomplete");
	}
	if (new Set(items.map((item) => item.ratingKey)).size !== items.length)
		throw createInternalError("Plex copies are ambiguous");
	return items;
}
export async function plexLibrary(
	server: MediaServerConfig,
	token = server.token,
): Promise<PlexItem[]> {
	const { MediaContainer: sections } = parse(
		z.object({
			MediaContainer: z.object({
				Directory: z.array(
					z.object({ key: z.string().min(1), type: z.string() }),
				),
			}),
		}),
		await mediaReader(server, token)("library/sections"),
		"Plex /library/sections",
	);
	const items: PlexItem[] = [];
	for (const section of sections.Directory.filter((section) =>
		["movie", "show"].includes(section.type),
	))
		items.push(
			...(await plexItems(
				server,
				`library/sections/${encodeURIComponent(section.key)}/all`,
				{},
				token,
			)),
		);
	if (new Set(items.map((item) => item.ratingKey)).size !== items.length)
		throw createInternalError("Plex copies are ambiguous across libraries");
	return items;
}
export async function mediaUsers(server: MediaServerConfig) {
	if (server.type === "jellyfin") {
		const users = parse(
			z.array(z.object({ Id: z.string().min(1), Name: z.string() })),
			await mediaReader(server)("Users"),
			"Jellyfin /Users",
		);
		if (new Set(users.map((user) => user.Id)).size !== users.length)
			throw createInternalError("Jellyfin account identities are ambiguous");
		return users.map((user) => ({
			server: server.name,
			userId: user.Id,
			name: user.Name,
		}));
	}
	const users = parse(
		z.object({
			MediaContainer: z.object({
				Account: z.array(
					z.object({
						id: z.union([count, z.string().min(1)]),
						name: z.string().optional(),
					}),
				),
			}),
		}),
		await mediaReader(server)("accounts"),
		"Plex /accounts",
	).MediaContainer.Account;
	if (new Set(users.map((user) => String(user.id))).size !== users.length)
		throw createInternalError("Plex account identities are ambiguous");
	return users.map((user) => ({
		server: server.name,
		userId: String(user.id),
		name: user.name,
	}));
}
export async function browseMedia(server: MediaServerConfig) {
	if (server.type === "jellyfin")
		return (await jellyItems(server, { IncludeItemTypes: "Movie,Series" })).map(
			(item) => {
				if (!["Movie", "Series"].includes(item.Type))
					throw createInternalError(
						"Jellyfin /Items returned an unexpected media kind",
					);
				return {
					service: server.name,
					id: item.Id,
					title: item.Name,
					mediaKind: item.Type === "Series" ? "series" : "movie",
					providerIds: {
						tvdb: item.ProviderIds?.Tvdb,
						tmdb: item.ProviderIds?.Tmdb,
						imdb: item.ProviderIds?.Imdb,
					},
					source: "jellyfin" as const,
				};
			},
		);
	return (await plexLibrary(server)).map((item) => ({
		service: server.name,
		id: item.ratingKey,
		title: item.title,
		mediaKind: item.type === "show" ? "series" : "movie",
		providerIds: plexIds(item),
		source: "plex" as const,
	}));
}
export function mediaServers() {
	return serverConfigs().map(({ name, type }) => ({
		name,
		type,
		configured: true,
		reachable: null,
		capabilities: {
			library: true,
			users: true,
			favourites: type === "jellyfin",
			watchStatus: true,
			watchHistory: type === "plex",
			reviews: false,
		},
	}));
}
