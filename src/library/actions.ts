import { z } from "zod";
import { loadConfigFromEnvOnly } from "../config.js";
import { createInternalError, fetchJson } from "../core.js";
import type {
	LibraryItem,
	LibrarySnapshot,
	ViewerScope,
	WatchEvidence,
} from "./model.js";

export interface LibraryActionInput {
	service?: string;
	target?: string;
	ids?: Array<number | string>;
	itemId?: number;
	seasonNumbers?: number[];
	episodeIds?: number[];
	monitored?: boolean;
	deleteFiles?: boolean;
	users?: ViewerScope[];
	allowUnsupportedFavourites?: boolean;
	watchedPolicy?: "all-selected" | "any-selected";
}
export interface LibraryDependencies {
	loadLibrarySnapshot(services?: string[]): Promise<LibrarySnapshot>;
	getWatchEvidence(
		item: LibraryItem,
		users: ViewerScope[],
		season?: number,
	): Promise<WatchEvidence>;
}
export function favouriteProtected(
	watch: WatchEvidence,
	input: Pick<LibraryActionInput, "allowUnsupportedFavourites">,
): boolean {
	return (
		watch.favourite !== false &&
		!(
			input.allowUnsupportedFavourites === true &&
			watch.favourite === null &&
			"favouriteSupported" in watch &&
			watch.favouriteSupported === false
		)
	);
}

export function planLibraryAction(
	item: LibraryItem,
	input: LibraryActionInput,
) {
	if (!item.complete || !Object.values(item.providerIds).some(Boolean))
		throw createInternalError("Complete exact provider identity is required");
	if (item.apiFamily !== 3)
		throw createInternalError(
			"This library mutation requires a verified v3 contract; no family fallback is allowed",
		);
	const seasons = [...new Set(input.seasonNumbers ?? [])].sort((a, b) => a - b);
	if (
		seasons.some((n) => !Number.isSafeInteger(n) || n < 0) ||
		(input.target === "season" && seasons.length === 0)
	)
		throw createInternalError("Explicit valid season numbers required");
	if (seasons.some((n) => !item.seasons.some((s) => s.seasonNumber === n)))
		throw createInternalError("Requested season is outside the library scope");
	if (
		(seasons.length || input.episodeIds?.length) &&
		item.mediaKind !== "series"
	)
		throw createInternalError("Season and episode scope requires a series");
	const episodes = item.episodes.filter((e) =>
		input.episodeIds
			? input.episodeIds.includes(e.id)
			: seasons.length
				? seasons.includes(e.seasonNumber)
				: true,
	);
	if (input.episodeIds?.some((id) => !episodes.some((e) => e.id === id)))
		throw createInternalError("Episode outside item scope");
	const selectedIds = new Set(episodes.map((e) => e.id));
	const selectedFiles =
		input.target === "files"
			? item.files.filter((f) => input.ids?.includes(f.id))
			: seasons.length || input.episodeIds?.length
				? item.files.filter((f) =>
						f.episodeIds.some((id) => selectedIds.has(id)),
					)
				: item.files;
	if (
		input.target === "files" &&
		input.ids?.some((id) => !selectedFiles.some((f) => f.id === id))
	)
		throw createInternalError("File outside item scope");
	for (const file of selectedFiles) {
		if (
			input.deleteFiles === true &&
			item.mediaKind === "series" &&
			(!file.episodeIds.length ||
				file.episodeIds.some((id) => !selectedIds.has(id)))
		)
			throw createInternalError(
				"Shared file contains episodes outside the approved scope",
			);
	}
	if (
		(input.target === "season" || input.target === "files") &&
		!selectedFiles.length
	)
		throw createInternalError("No exact files in the requested scope");
	if (input.target === "files" && input.episodeIds === undefined) {
		// Explicit file cleanup unmonitors only the episodes contained in those files.
		const fileEpisodeIds = new Set(selectedFiles.flatMap((f) => f.episodeIds));
		return {
			item: identity(item),
			target: input.target,
			seasons,
			episodeIds: item.episodes
				.filter((e) => fileEpisodeIds.has(e.id))
				.map((e) => e.id)
				.sort((a, b) => a - b),
			files: selectedFiles,
			monitored: input.monitored ?? false,
			deleteFiles: input.deleteFiles === true,
		};
	}
	return {
		item: identity(item),
		target: input.target ?? "monitoring",
		seasons,
		episodeIds: episodes.map((e) => e.id).sort((a, b) => a - b),
		files: selectedFiles,
		monitored: input.monitored ?? false,
		deleteFiles: input.deleteFiles === true,
	};
}
function retentionIdentity(
	item: Pick<
		LibraryItem,
		| "service"
		| "id"
		| "mediaKind"
		| "title"
		| "providerIds"
		| "path"
		| "status"
		| "addedAt"
		| "tags"
		| "ratings"
		| "apiFamily"
	>,
) {
	return {
		service: item.service,
		id: item.id,
		mediaKind: item.mediaKind,
		title: item.title,
		providerIds: item.providerIds,
		path: item.path,
		status: item.status,
		addedAt: item.addedAt,
		tags: item.tags,
		ratings: item.ratings,
		apiFamily: item.apiFamily,
	};
}
function identity(item: LibraryItem) {
	return {
		...retentionIdentity(item),
		monitored: item.monitored,
		seasons: item.seasons,
		episodes: item.episodes,
	};
}

function actionWatchEvidence(
	item: LibraryItem,
	plan: ReturnType<typeof planLibraryAction>,
	users: ViewerScope[],
	deps: LibraryDependencies,
	deletedFileIds: Set<number> = new Set(),
) {
	if (item.mediaKind !== "series") return deps.getWatchEvidence(item, users);
	// Exclude only files whose deletion and absence this execution already verified.
	const deletedEpisodes = new Set(
		plan.files
			.filter((file) => deletedFileIds.has(file.id))
			.flatMap((file) => file.episodeIds),
	);
	const episodeIds = plan.episodeIds.filter((id) => !deletedEpisodes.has(id));
	const episodes = item.episodes.filter((episode) =>
		episodeIds.includes(episode.id),
	);
	const seasonNumbers = new Set([
		...plan.seasons,
		...plan.item.episodes
			.filter((episode) => plan.episodeIds.includes(episode.id))
			.map((episode) => episode.seasonNumber),
	]);
	if (
		!episodes.length ||
		episodes.length !== episodeIds.length ||
		episodes.some(
			(episode) =>
				!plan.item.episodes.some(
					(approved) =>
						approved.id === episode.id &&
						approved.seasonNumber === episode.seasonNumber &&
						approved.episodeNumber === episode.episodeNumber &&
						approved.airDate === episode.airDate &&
						approved.title === episode.title &&
						approved.fileId === episode.fileId,
				),
		) ||
		[...seasonNumbers].some(
			(number) =>
				!item.seasons.some((season) => season.seasonNumber === number),
		)
	)
		throw createInternalError("Approved watch scope is missing during cleanup");
	return deps.getWatchEvidence(
		{
			...item,
			episodes,
			seasons: item.seasons.filter((season) =>
				seasonNumbers.has(season.seasonNumber),
			),
			// Keep all fresh files: physical-copy alias detection must not lose siblings.
			// Multi-season session protection is deliberately broader than watch scope.
		},
		users,
		seasonNumbers.size === 1 ? [...seasonNumbers][0] : undefined,
	);
}

export async function prepareLibraryAction(
	input: LibraryActionInput,
	deps: LibraryDependencies,
) {
	if (!input.service) throw createInternalError("Explicit service required");
	const snapshot = await deps.loadLibrarySnapshot([input.service]);
	const itemId =
		input.itemId ??
		(input.target === "season" && input.ids?.length === 1
			? input.ids[0]
			: undefined);
	if (!snapshot.complete || typeof itemId !== "number")
		throw createInternalError(
			"Complete library snapshot and exact itemId required",
		);
	const matches = snapshot.items.filter(
		(i) => i.service === input.service && i.id === itemId,
	);
	const item = matches[0];
	if (matches.length !== 1 || !item)
		throw createInternalError("Unique exact library item required");
	const plan = planLibraryAction(item, input);
	if (input.target === "season" && !input.deleteFiles)
		throw createInternalError(
			"Season cleanup requires explicit deleteFiles:true",
		);
	let watch: WatchEvidence | undefined;
	if (input.target === "season" || input.target === "files") {
		if (!input.users?.length)
			throw createInternalError(
				"Explicit users and servers required for playback protection",
			);
		watch = await actionWatchEvidence(item, plan, input.users, deps);
		if (
			input.users.some(
				(user) =>
					watch?.viewers.filter(
						(viewer) =>
							viewer.server === user.server && viewer.userId === user.userId,
					).length !== 1,
			)
		)
			throw createInternalError(
				"Every selected user requires unique complete viewer evidence",
			);
		if (
			!watch.complete ||
			watch.activePlayback !== false ||
			favouriteProtected(watch, input)
		)
			throw createInternalError(
				"Playback/favourite evidence incomplete or protected",
			);
		if (input.target === "season") {
			if (item.status.toLowerCase() !== "ended")
				throw createInternalError(
					"Season completion cannot be established for a continuing series; cleanup blocked",
				);
			const watchedByViewer = watch.viewers.map((viewer) =>
				plan.episodeIds.every((episodeId) => {
					const episode = item.episodes.find((e) => e.id === episodeId);
					return (
						!!episode &&
						viewer.episodes.some(
							(e) =>
								e.seasonNumber === episode.seasonNumber &&
								e.episodeNumber === episode.episodeNumber &&
								e.status === "watched",
						)
					);
				}),
			);
			if (
				input.watchedPolicy === "any-selected"
					? !watchedByViewer.some(Boolean)
					: !watchedByViewer.every(Boolean)
			)
				throw createInternalError(
					"Selected users have not watched every approved episode",
				);
		}
	}
	return { plan, watch: watch ?? null };
}

export async function executeLibraryAction(
	input: LibraryActionInput,
	prepared: Awaited<ReturnType<typeof prepareLibraryAction>>,
	deps: LibraryDependencies,
) {
	const refreshed = await prepareLibraryAction(input, deps);
	if (JSON.stringify(refreshed) !== JSON.stringify(prepared))
		throw createInternalError(
			"Exact library/watch plan changed before monitoring; approval consumed without execution",
		);
	const { plan } = prepared;
	const config = await loadConfigFromEnvOnly();
	const service = config.services[plan.item.service];
	if (!service) throw createInternalError("Service configuration changed");
	if (service.apiVersion === 5 || service.apiVersion === "auto")
		throw createInternalError(
			"Library mutation requires explicit/legacy v3; no downgrade from auto or v5",
		);
	const base = `${service.baseUrl.replace(/\/$/, "")}/api/v3`;
	const headers = {
		"X-Api-Key": service.apiKey,
		"Content-Type": "application/json",
	};
	const route = plan.item.mediaKind === "series" ? "series" : "movie";
	const endpoint = `${base}/${route}/${plan.item.id}`;
	const object = z
		.object({
			id: z.literal(plan.item.id),
			path: z.literal(plan.item.path),
			title: z.literal(plan.item.title),
			monitored: z.boolean(),
			seasons: z
				.array(
					z
						.object({
							seasonNumber: z.number().int().nonnegative(),
							monitored: z.boolean(),
						})
						.passthrough(),
				)
				.optional(),
		})
		.passthrough()
		.parse(await fetchJson(endpoint, { headers }));
	const changes: Array<{ step: string; id: number }> = [];
	const itemMonitoringChange =
		!plan.seasons.length &&
		!input.episodeIds?.length &&
		(input.target !== "files" ||
			plan.item.mediaKind === "movie" ||
			plan.episodeIds.length === plan.item.episodes.length);
	if (plan.seasons.length) {
		if (
			!object.seasons ||
			plan.seasons.some(
				(n) => !object.seasons?.some((s) => s.seasonNumber === n),
			)
		)
			throw createInternalError("Season membership changed");
		object.seasons = object.seasons.map((s) =>
			plan.seasons.includes(s.seasonNumber)
				? { ...s, monitored: plan.monitored }
				: s,
		);
	} else if (itemMonitoringChange) object.monitored = plan.monitored;
	await fetchJson(endpoint, {
		method: "PUT",
		headers,
		body: JSON.stringify(object),
	});
	const readback = z
		.object({
			id: z.literal(plan.item.id),
			monitored: z.boolean(),
			seasons: z
				.array(z.object({ seasonNumber: z.number(), monitored: z.boolean() }))
				.optional(),
		})
		.parse(await fetchJson(endpoint, { headers }));
	if (
		plan.seasons.length
			? plan.seasons.some(
					(n) =>
						!readback.seasons?.some(
							(s) => s.seasonNumber === n && s.monitored === plan.monitored,
						),
				)
			: itemMonitoringChange && readback.monitored !== plan.monitored
	)
		throw createInternalError(
			"Monitoring mutation may have succeeded but readback failed; do not retry deletion",
		);
	changes.push({ step: "monitoring_verified", id: plan.item.id });
	if (
		plan.item.mediaKind === "series" &&
		plan.episodeIds.length &&
		(plan.seasons.length ||
			input.episodeIds?.length ||
			input.target === "files")
	) {
		await fetchJson(`${base}/episode/monitor`, {
			method: "PUT",
			headers,
			body: JSON.stringify({
				episodeIds: plan.episodeIds,
				monitored: plan.monitored,
			}),
		});
		const episodes = z
			.array(z.object({ id: z.number(), monitored: z.boolean() }))
			.parse(
				await fetchJson(`${base}/episode?seriesId=${plan.item.id}`, {
					headers,
				}),
			);
		if (
			plan.episodeIds.some(
				(id) =>
					!episodes.some((e) => e.id === id && e.monitored === plan.monitored),
			)
		)
			throw createInternalError(
				"Episode monitoring readback failed; deletion not attempted",
			);
	}
	if (!plan.deleteFiles) return { ok: true, data: { changes, verified: true } };
	const deletedFileIds = new Set<number>();
	for (const file of plan.files) {
		try {
			const fresh = await deps.loadLibrarySnapshot([plan.item.service]);
			const item = fresh.items.find(
				(i) => i.id === plan.item.id && i.service === plan.item.service,
			);
			if (
				!fresh.complete ||
				!item ||
				!item.complete ||
				JSON.stringify(retentionIdentity(item)) !==
					JSON.stringify(retentionIdentity(plan.item))
			)
				throw createInternalError("Library identity changed during cleanup");
			const watch = await actionWatchEvidence(
				item,
				plan,
				input.users ?? [],
				deps,
				deletedFileIds,
			);
			if (
				!watch.complete ||
				watch.activePlayback !== false ||
				favouriteProtected(watch, input)
			)
				throw createInternalError("Playback protection changed during cleanup");
			const current = item.files.find((f) => f.id === file.id);
			if (!current || JSON.stringify(current) !== JSON.stringify(file))
				throw createInternalError("File identity changed during cleanup");
			const fileEndpoint = `${base}/${plan.item.mediaKind === "series" ? "episodefile" : "moviefile"}/${file.id}`;
			await fetchJson(fileEndpoint, { method: "DELETE", headers });
			const after = await deps.loadLibrarySnapshot([plan.item.service]);
			const exact = after.items.find(
				(i) => i.id === plan.item.id && i.service === plan.item.service,
			);
			if (
				!after.complete ||
				!exact ||
				exact.files.some((f) => f.id === file.id)
			)
				throw createInternalError("Deletion accepted but absence not verified");
			deletedFileIds.add(file.id);
			changes.push({ step: "file_absence_verified", id: file.id });
		} catch {
			return {
				ok: false,
				data: { changes, partial: true, uncertain: true },
				error: createInternalError(
					"Cleanup stopped after monitoring or file changes; reconcile exact state before any new approval",
				),
			};
		}
	}
	return {
		ok: true,
		data: {
			changes,
			verified: true,
			estimatedRemovedBytes: plan.files.reduce((n, f) => n + f.sizeBytes, 0),
		},
	};
}
