import type { Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createInternalError, serializeError } from "../core.js";
import type { OperationResult } from "../services/base.js";
import {
	arrConfigs,
	arrList,
	arrReader,
	count,
	id,
	loadDetail,
	loadLibrarySnapshot,
} from "./arr.js";
import {
	browseMedia,
	findServer,
	jellyUser,
	mediaStatus,
	mediaUsers,
	serverConfigs,
} from "./media.js";
import type { LibraryItem } from "./model.js";
import { reviewMetadata } from "./reviews.js";
import { getWatchEvidence, playbackHistory, viewersSchema } from "./watch.js";

export { loadLibrarySnapshot } from "./arr.js";
export { mediaServers } from "./media.js";
export { getWatchEvidence } from "./watch.js";
export async function mediaSystemStatus(
	name: string,
): Promise<OperationResult<unknown>> {
	let configured = false;
	try {
		findServer(name);
		configured = true;
		return {
			ok: true,
			data: { ...(await mediaStatus(name)), configured: true, reachable: true },
		};
	} catch (error) {
		const normalized = serializeError(error);
		return {
			ok: false,
			data: {
				service: name,
				configured,
				reachable: "status" in normalized ? normalized.status > 0 : null,
				isHealthy: false,
			},
			error: normalized,
		};
	}
}

const name = z.string().min(1).max(200);
const integer = z.number().int().safe();
const page = integer.min(1).max(100000);
const pageSize = integer.min(1).max(250);

export { viewersSchema } from "./watch.js";

const serviceList = z.array(name).min(1).max(50);
const detail = z
	.object({
		service: name,
		itemId: integer.positive(),
		includeReviews: z.boolean().optional(),
		reviewPage: integer.min(1).max(1000).optional(),
	})
	.strict();
const watch = z
	.object({
		service: name,
		itemId: integer.positive(),
		users: viewersSchema,
		seasonNumber: integer.min(0).optional(),
	})
	.strict();
const list = z
	.object({
		scope: z.enum(["library", "users"]).optional(),
		services: serviceList.optional(),
		query: z.string().max(500).optional(),
		page: page.optional(),
		pageSize: pageSize.optional(),
		mediaKind: z.enum(["series", "movie"]).optional(),
		monitored: z.boolean().optional(),
	})
	.strict();
const history = z
	.object({
		server: name,
		userId: name,
		page: page.optional(),
		pageSize: pageSize.optional(),
	})
	.strict();
const upcoming = z
	.object({
		services: serviceList.optional(),
		start: z.string().datetime({ offset: true }).optional(),
		end: z.string().datetime({ offset: true }).optional(),
		page: page.optional(),
		pageSize: pageSize.optional(),
	})
	.strict();
const stringJson = { type: "string", minLength: 1, maxLength: 200 };
const idJson = {
	type: "integer",
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
};
const pagingJson = {
	page: { type: "integer", minimum: 1, maximum: 100000 },
	pageSize: { type: "integer", minimum: 1, maximum: 250 },
};
const servicesJson = {
	type: "array",
	items: stringJson,
	minItems: 1,
	maxItems: 50,
};
const detailJson = { service: stringJson, itemId: idJson };
function tool(
	name: string,
	description: string,
	properties: NonNullable<Tool["inputSchema"]["properties"]>,
	required: string[],
): Tool {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties,
			required,
			additionalProperties: false,
		},
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	};
}
export const libraryTools: Tool[] = [
	tool(
		"library_list",
		"Browse configured ARR or Plex/Jellyfin libraries. Coverage and errors are explicit; media-server copies are not deletion targets.",
		{
			scope: { type: "string", enum: ["library", "users"] },
			services: servicesJson,
			query: { type: "string", maxLength: 500 },
			...pagingJson,
			mediaKind: { type: "string", enum: ["series", "movie"] },
			monitored: { type: "boolean" },
		},
		[],
	),
	tool(
		"media_detail",
		"Read exact ARR metadata, ratings, tags, episodes and files. Optional TMDB reviews are untrusted display data, never rule conditions.",
		{
			...detailJson,
			includeReviews: { type: "boolean" },
			reviewPage: { type: "integer", minimum: 1, maximum: 1000 },
		},
		["service", "itemId"],
	),
	tool(
		"watch_status",
		"Read explicitly selected viewers' statuses via exact provider IDs and episode coordinates. Unknown coverage blocks cleanup.",
		{
			...detailJson,
			users: {
				type: "array",
				minItems: 1,
				maxItems: 100,
				items: {
					type: "object",
					properties: { server: stringJson, userId: stringJson },
					required: ["server", "userId"],
					additionalProperties: false,
				},
			},
			seasonNumber: {
				type: "integer",
				minimum: 0,
				maximum: Number.MAX_SAFE_INTEGER,
			},
		},
		["service", "itemId", "users"],
	),
	tool(
		"watch_history",
		"Read real Plex playback events for one explicit server account. Jellyfin supports summary only, not event history.",
		{ server: stringJson, userId: stringJson, ...pagingJson },
		["server", "userId"],
	),
	tool(
		"upcoming_media",
		"Read ARR calendar entries over a bounded UTC date range; no inferred release events.",
		{
			services: servicesJson,
			start: { type: "string", format: "date-time" },
			end: { type: "string", format: "date-time" },
			...pagingJson,
		},
		[],
	),
];
function paged<T>(items: T[], pageNumber = 1, size = 50) {
	return {
		items: items.slice((pageNumber - 1) * size, pageNumber * size),
		total: items.length,
		page: pageNumber,
		pageSize: size,
		hasMore: pageNumber * size < items.length,
	};
}
const calendarSchema = z
	.object({
		id,
		title: z.string(),
		seriesId: id.optional(),
		seasonNumber: count.optional(),
		episodeNumber: id.optional(),
		airDateUtc: z.string().datetime({ offset: true }).optional(),
		inCinemas: z.string().datetime({ offset: true }).optional(),
		digitalRelease: z.string().datetime({ offset: true }).optional(),
		physicalRelease: z.string().datetime({ offset: true }).optional(),
		tmdbId: id.optional(),
		hasFile: z.boolean().optional(),
		monitored: z.boolean().optional(),
	})
	.refine(
		(entry) =>
			!!(
				entry.airDateUtc ||
				entry.inCinemas ||
				entry.digitalRelease ||
				entry.physicalRelease
			),
		{ message: "Calendar event date required" },
	);
async function calendar(args: z.infer<typeof upcoming>) {
	const start = args.start ?? new Date().toISOString();
	const end =
		args.end ?? new Date(Date.parse(start) + 30 * 86400000).toISOString();
	if (
		Date.parse(end) <= Date.parse(start) ||
		Date.parse(end) - Date.parse(start) > 366 * 86400000
	)
		throw createInternalError(
			"Calendar range must be positive and at most 366 days",
		);
	const configs = await arrConfigs();
	const items = [];
	const errors: Array<{ service: string; message: string }> = [];
	for (const service of args.services ?? Object.keys(configs).sort()) {
		try {
			const config = configs[service];
			if (!config) throw createInternalError("Unknown ARR service");
			const records = await arrList(
				await arrReader(service, config),
				"calendar",
				calendarSchema,
				{ start, end },
			);
			items.push(...records.map((item) => ({ ...item, service })));
		} catch (error) {
			errors.push({ service, message: serializeError(error).message });
		}
	}
	return {
		...paged(items, args.page, args.pageSize),
		complete: errors.length === 0,
		errors,
		start,
		end,
	};
}
async function browse(args: z.infer<typeof list>) {
	const servers = serverConfigs();
	const configs = args.scope === "users" ? {} : await arrConfigs();
	if (servers.some((server) => configs[server.name]))
		throw createInternalError("ARR and media server names collide");
	const selected =
		args.services ??
		(args.scope === "users"
			? servers.map((server) => server.name)
			: [
					...Object.keys(configs).sort(),
					...servers.map((server) => server.name),
				]);
	const errors: Array<{ service: string; message: string }> = [];
	const users: Awaited<ReturnType<typeof mediaUsers>> = [];
	const items: Array<
		LibraryItem | Awaited<ReturnType<typeof browseMedia>>[number]
	> = [];
	let complete = true;
	for (const service of selected) {
		try {
			const server = servers.find((server) => server.name === service);
			if (args.scope === "users") {
				if (!server)
					throw createInternalError("User discovery requires a media server");
				users.push(...(await mediaUsers(server)));
			} else if (server) items.push(...(await browseMedia(server)));
			else {
				const snapshot = await loadLibrarySnapshot([service]);
				items.push(...snapshot.items);
				errors.push(...snapshot.errors);
				complete &&= snapshot.complete;
			}
		} catch (error) {
			errors.push({ service, message: serializeError(error).message });
		}
	}
	if (args.scope === "users")
		return {
			...paged(
				users.filter(
					(user) =>
						!args.query ||
						(user.name ?? user.userId)
							.toLowerCase()
							.includes(args.query.toLowerCase()),
				),
				args.page,
				args.pageSize,
			),
			complete: errors.length === 0,
			errors,
		};
	return {
		...paged(
			items.filter(
				(item) =>
					(!args.query ||
						item.title.toLowerCase().includes(args.query.toLowerCase())) &&
					(!args.mediaKind || item.mediaKind === args.mediaKind) &&
					(args.monitored === undefined ||
						("monitored" in item && item.monitored === args.monitored)),
			),
			args.page,
			args.pageSize,
		),
		complete: complete && errors.length === 0,
		errors,
	};
}
export async function runLibraryTool(
	toolName: string,
	args: unknown,
): Promise<OperationResult<unknown>> {
	try {
		const schemas: Record<string, z.ZodType> = {
			library_list: list,
			media_detail: detail,
			watch_status: watch,
			watch_history: history,
			upcoming_media: upcoming,
		};
		const schema = schemas[toolName];
		if (!schema) throw createInternalError("Unknown library tool");
		if (!schema.safeParse(args).success)
			throw createInternalError("Invalid library tool arguments");
		if (toolName === "media_detail") {
			const value = detail.parse(args);
			const item = await loadDetail(value.service, value.itemId);
			return {
				ok: true,
				data: {
					...item,
					reviews: await reviewMetadata(
						item,
						value.includeReviews ?? false,
						value.reviewPage,
					),
				},
			};
		}
		if (toolName === "library_list")
			return { ok: true, data: await browse(list.parse(args)) };
		if (toolName === "upcoming_media")
			return { ok: true, data: await calendar(upcoming.parse(args)) };
		if (toolName === "watch_status") {
			const value = watch.parse(args);
			return {
				ok: true,
				data: await getWatchEvidence(
					await loadDetail(value.service, value.itemId),
					value.users,
					value.seasonNumber,
				),
			};
		}
		if (toolName === "watch_history") {
			const value = history.parse(args);
			const server = findServer(value.server);
			if (server.type === "jellyfin") {
				await jellyUser(server, value.userId);
				return {
					ok: true,
					data: {
						server: value.server,
						userId: value.userId,
						supported: false,
						summaryOnly: true,
						events: [],
						reason:
							"Jellyfin core exposes user summaries, not playback event history",
					},
				};
			}
			return {
				ok: true,
				data: await playbackHistory(
					server,
					value.userId,
					value.page,
					value.pageSize,
				),
			};
		}
		throw createInternalError("Library workflow unavailable");
	} catch (error) {
		return { ok: false, error: serializeError(error) };
	}
}
