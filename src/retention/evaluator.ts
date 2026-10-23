import { isAbsolute, win32 } from "node:path";
import type {
	LibraryItem,
	LibrarySnapshot,
	WatchEvidence,
} from "../library/model.js";
import {
	type RetentionRuleInput,
	evaluationTimeSchema,
	ruleSchema,
} from "./schema.js";

export function evidenceKey(
	item: Pick<LibraryItem, "service" | "id">,
	seasonNumber?: number,
): string {
	return JSON.stringify([item.service, item.id, seasonNumber ?? null]);
}
export interface CandidateInput {
	snapshot: LibrarySnapshot;
	item: LibraryItem;
	rule: RetentionRuleInput;
	watchEvidence?: WatchEvidence;
	evaluationTime: string;
	seasonNumber?: number;
}
export function evaluateCandidate(input: CandidateInput) {
	const rule = ruleSchema.parse(input.rule);
	evaluationTimeSchema.parse(input.evaluationTime);
	const { item, seasonNumber, watchEvidence: watch, snapshot } = input;
	const now = Date.parse(input.evaluationTime);
	const blockers: string[] = [];
	let usesAddedResidency = false;
	const block = (condition: boolean, reason: string) => {
		if (condition) blockers.push(reason);
	};
	const ageDays = (value?: string) => {
		const validDate =
			value !== undefined &&
			(evaluationTimeSchema.safeParse(value).success ||
				(/^\d{4}-\d{2}-\d{2}$/.test(value) &&
					Number.isFinite(Date.parse(value)) &&
					new Date(Date.parse(value)).toISOString().slice(0, 10) === value));
		const time = validDate ? Date.parse(value) : Number.NaN;
		return Number.isFinite(time) && time <= now
			? (now - time) / 86400000
			: null;
	};
	const absolutePath = (value: string) =>
		isAbsolute(value) || win32.isAbsolute(value);
	block(
		!Number.isSafeInteger(item.id) ||
			item.id < 1 ||
			!absolutePath(item.path) ||
			![3, 5].includes(item.apiFamily),
		"Invalid item identity, path or API family",
	);
	block(
		item.apiFamily !== 3,
		"Retention removal requires a verified v3 mutation contract; no family fallback",
	);
	block(
		!snapshot.complete || snapshot.errors.length > 0,
		"Library snapshot incomplete",
	);
	// Reads finish after the caller's evaluation time; only observation clocks get this bound.
	block(
		!evaluationTimeSchema.safeParse(snapshot.observedAt).success ||
			Date.parse(snapshot.observedAt) > now + 300_000,
		"Snapshot timestamp unknown or beyond five-minute observation tolerance",
	);
	block(!item.complete, "Item metadata incomplete");
	block(!rule.services.includes(item.service), "Service not selected");
	block(
		rule.target === "movie"
			? item.mediaKind !== "movie" || seasonNumber !== undefined
			: item.mediaKind !== "series" ||
					(rule.target === "completed-season"
						? !Number.isInteger(seasonNumber) || (seasonNumber ?? -1) < 0
						: seasonNumber !== undefined),
		"Target scope mismatch",
	);
	const scopedEpisodes = item.episodes.filter(
		(e) => seasonNumber === undefined || e.seasonNumber === seasonNumber,
	);
	if (item.mediaKind === "series") {
		// No per-season completion evidence exists in the shared model. Do not infer it from a series watch flag.
		block(
			item.status.toLowerCase() !== "ended",
			"Season completion not established: series is not ended",
		);
		block(scopedEpisodes.length === 0, "No episodes establish completion");
		block(
			item.seasons
				.filter(
					(s) => seasonNumber === undefined || s.seasonNumber === seasonNumber,
				)
				.some(
					(s) => !scopedEpisodes.some((e) => e.seasonNumber === s.seasonNumber),
				),
			"Season episode inventory missing",
		);
		block(
			!rule.includeSpecials && scopedEpisodes.some((e) => e.seasonNumber === 0),
			"Specials require explicit opt-in",
		);
		block(
			scopedEpisodes.some(
				(e) =>
					ageDays(e.airDate) === null ||
					e.fileId === undefined ||
					!item.seasons.some((s) => s.seasonNumber === e.seasonNumber),
			),
			"Episode release/file/season completion unknown",
		);
		block(
			new Set(item.episodes.map((e) => e.id)).size !== item.episodes.length ||
				new Set(
					item.episodes.map((e) =>
						JSON.stringify([e.seasonNumber, e.episodeNumber]),
					),
				).size !== item.episodes.length,
			"Duplicate episode metadata",
		);
		block(
			new Set(item.seasons.map((s) => s.seasonNumber)).size !==
				item.seasons.length,
			"Duplicate season metadata",
		);
	}
	block(
		!Object.values(item.providerIds).some(
			(id) => typeof id === "string" && id.length > 0,
		),
		"Provider identity missing",
	);
	block(
		item.tags.some((tag) => rule.protectedTags.includes(tag)),
		"Protected tag",
	);
	const addedAgeDays = ageDays(item.addedAt);
	block(
		addedAgeDays === null || addedAgeDays < rule.minAddedAgeDays,
		"Added age unknown or below minimum days",
	);
	const files = item.files
		.filter(
			(f) =>
				seasonNumber === undefined ||
				scopedEpisodes.some((e) => e.fileId === f.id) ||
				f.episodeIds.some((id) => scopedEpisodes.some((e) => e.id === id)),
		)
		.map((f) => ({ ...f, episodeIds: [...f.episodeIds].sort((a, b) => a - b) }))
		.sort((a, b) => a.id - b.id);
	block(
		new Set(item.files.map((f) => f.id)).size !== item.files.length ||
			new Set(item.files.map((f) => f.path)).size !== item.files.length,
		"Duplicate file metadata",
	);
	block(
		snapshot.items.filter(
			(other) => other.service === item.service && other.id === item.id,
		).length !== 1,
		"Snapshot item identity missing or ambiguous",
	);
	block(
		snapshot.items.some(
			(other) =>
				(other.service !== item.service || other.id !== item.id) &&
				other.files.some((f) =>
					files.some(
						(selected) =>
							selected.path === f.path ||
							(other.service === item.service && selected.id === f.id),
					),
				),
		),
		"File shared with another library item",
	);
	if (item.mediaKind === "series") {
		block(
			scopedEpisodes.some(
				(e) =>
					!files.some((f) => f.id === e.fileId && f.episodeIds.includes(e.id)),
			),
			"Episode file identity missing",
		);
		block(
			files.some(
				(f) =>
					f.episodeIds.length === 0 ||
					new Set(f.episodeIds).size !== f.episodeIds.length ||
					f.episodeIds.some(
						(id) =>
							!scopedEpisodes.some((e) => e.id === id && e.fileId === f.id),
					) ||
					item.episodes.some(
						(e) => e.fileId === f.id && !scopedEpisodes.includes(e),
					),
			),
			"File includes episodes outside selected scope or unknown identity",
		);
	}
	block(files.length === 0, "No exact files");
	block(
		files.some(
			(f) =>
				!Number.isSafeInteger(f.id) ||
				f.id < 1 ||
				!absolutePath(f.path) ||
				!Number.isSafeInteger(f.sizeBytes) ||
				f.sizeBytes < 0,
		),
		"Invalid file identity or bytes",
	);
	const estimatedReclaimedBytes = files.reduce(
		(sum, f) => sum + f.sizeBytes,
		0,
	);
	block(
		!Number.isSafeInteger(item.sizeBytes) ||
			item.sizeBytes !==
				item.files.reduce((sum, file) => sum + file.sizeBytes, 0),
		"Item footprint inconsistent with exact files",
	);
	block(
		estimatedReclaimedBytes > rule.maxBytes,
		"Maximum bytes bound exceeded",
	);
	block(
		!Number.isSafeInteger(estimatedReclaimedBytes) ||
			estimatedReclaimedBytes < rule.minSizeBytes,
		"Footprint below minimum bytes or invalid",
	);
	block(!watch?.complete, "Watch evidence incomplete or missing");
	block(
		watch?.activePlayback !== false,
		"Active playback or unknown session evidence",
	);
	block(
		watch?.favourite !== false &&
			!(
				rule.allowUnsupportedFavourites &&
				watch?.favouriteSupported === false &&
				watch.favourite === null &&
				watch.complete
			),
		"Favourite or unknown favourite evidence",
	);
	if (watch) {
		blockers.push(...watch.blockers);
		const selected = rule.users.map((user) =>
			watch.viewers.filter(
				(v) => v.server === user.server && v.userId === user.userId,
			),
		);
		block(
			selected.some((matches) => matches.length !== 1),
			"Selected viewer missing or ambiguous",
		);
		const viewers = selected.flat();
		block(
			item.mediaKind === "series" &&
				viewers.some((v) =>
					scopedEpisodes.some(
						(e) =>
							v.episodes.filter(
								(seen) =>
									seen.seasonNumber === e.seasonNumber &&
									seen.episodeNumber === e.episodeNumber,
							).length !== 1,
					),
				),
			"Selected viewer episode evidence missing or ambiguous",
		);
		block(
			viewers.some((v) => v.status !== "watched" && v.status !== "unwatched"),
			"Unknown or partial viewing evidence",
		);
		const hasRequestedScope = (v: WatchEvidence["viewers"][number]) =>
			v.status === rule.watchState &&
			(item.mediaKind === "movie" ||
				scopedEpisodes.every((e) => {
					const matches = v.episodes.filter(
						(seen) =>
							seen.seasonNumber === e.seasonNumber &&
							seen.episodeNumber === e.episodeNumber,
					);
					return matches.length === 1 && matches[0]?.status === rule.watchState;
				}));
		block(
			viewers.some((v) =>
				scopedEpisodes.some((e) =>
					v.episodes.some(
						(seen) =>
							seen.seasonNumber === e.seasonNumber &&
							seen.episodeNumber === e.episodeNumber &&
							seen.status !== "watched" &&
							seen.status !== "unwatched",
					),
				),
			),
			"Unknown or in-progress episode viewing",
		);
		block(
			rule.watchState === "unwatched" || rule.watchedPolicy === "all-selected"
				? viewers.some((v) => !hasRequestedScope(v))
				: !viewers.some(hasRequestedScope),
			rule.watchState === "unwatched"
				? "Selected users are not all explicitly unwatched for scope"
				: "Selected users have not watched scope",
		);
		const inactivityDays = Math.max(rule.watchGraceDays, rule.minInactiveDays);
		for (const viewer of viewers) {
			if (
				viewer.status === "unwatched" &&
				(viewer.lastWatchedAt === undefined || viewer.lastWatchedAt === null)
			) {
				usesAddedResidency = true;
				block(
					addedAgeDays === null || addedAgeDays < inactivityDays,
					"Added-age residency unknown or below grace/inactivity days for unwatched viewer",
				);
				continue;
			}
			const days = ageDays(viewer.lastWatchedAt);
			block(
				days === null || days < inactivityDays,
				"Last watch unknown or below grace/inactivity days",
			);
		}
	}
	const matchingRatings = rule.rating
		? item.ratings.filter(
				(r) =>
					r.source === rule.rating?.source && r.scale === rule.rating.scale,
			)
		: [];
	if (rule.rating) {
		const rating = matchingRatings[0];
		block(
			matchingRatings.length !== 1 ||
				!rating ||
				!Number.isFinite(rating.value) ||
				rating.value < 0 ||
				rating.value > rule.rating.maxValue ||
				rating.votes === undefined ||
				!Number.isSafeInteger(rating.votes) ||
				rating.votes < rule.rating.minVotes,
			"Rating source/scale/value/votes threshold not established",
		);
	}
	const eligible = blockers.length === 0;
	return {
		key: evidenceKey(item, seasonNumber),
		service: item.service,
		itemId: item.id,
		seasonNumber: seasonNumber ?? null,
		title: item.title,
		eligible,
		files,
		estimatedReclaimedBytes,
		reclaimedBytesGuaranteed: false as const,
		reasons: eligible
			? [
					rule.watchState === "unwatched"
						? "All selected users are currently unwatched for the selected scope"
						: rule.watchedPolicy === "all-selected"
							? "All selected users watched the selected scope"
							: "At least one selected user watched the selected scope",
					usesAddedResidency
						? "Added-age residency meets grace/inactivity day thresholds for explicitly unwatched users without last playback; this is not proof of never-watched history"
						: "Age, inactivity, protection and footprint conditions satisfied",
				]
			: [],
		blockers,
		evidence: {
			rule,
			watch: input.watchEvidence ?? null,
			observedAt: snapshot.observedAt,
			evaluationTime: input.evaluationTime,
			addedAgeDays,
			ratings: matchingRatings,
		},
		plan: !eligible
			? null
			: {
					service: item.service,
					itemId: item.id,
					apiFamily: item.apiFamily,
					providerIds: item.providerIds,
					path: item.path,
					mediaKind: item.mediaKind,
					files,
					seasonNumber: seasonNumber ?? null,
					steps:
						rule.action === "remove-title"
							? [{ operation: "remove-title", deleteFiles: true }]
							: [
									{ operation: "unmonitor" },
									{
										operation: "delete-files",
										fileIds: files.map((f) => f.id),
									},
								],
				},
	};
}
export type Recommendation = ReturnType<typeof evaluateCandidate>;
export interface SnapshotInput {
	snapshot: LibrarySnapshot;
	rule: RetentionRuleInput;
	watchEvidence: Readonly<Record<string, WatchEvidence | undefined>>;
	evaluationTime: string;
}
export function evaluateSnapshot(input: SnapshotInput) {
	const rule = ruleSchema.parse(input.rule);
	evaluationTimeSchema.parse(input.evaluationTime);
	const candidates = input.snapshot.items
		.filter(
			(item) =>
				rule.services.includes(item.service) &&
				(rule.target === "movie"
					? item.mediaKind === "movie"
					: item.mediaKind === "series"),
		)
		.flatMap((item) => {
			const scopes =
				rule.target === "completed-season"
					? [...new Set(item.seasons.map((s) => s.seasonNumber))].sort(
							(a, b) => a - b,
						)
					: [undefined];
			return scopes.map((seasonNumber) =>
				evaluateCandidate({
					...input,
					item,
					seasonNumber,
					watchEvidence: input.watchEvidence[evidenceKey(item, seasonNumber)],
				}),
			);
		})
		.sort((a, b) =>
			a.service < b.service
				? -1
				: a.service > b.service
					? 1
					: a.itemId - b.itemId ||
						(a.seasonNumber ?? -1) - (b.seasonNumber ?? -1),
		);
	let count = 0;
	let bytes = 0;
	for (const candidate of candidates) {
		if (!candidate.eligible) continue;
		if (
			count >= rule.maxCount ||
			candidate.estimatedReclaimedBytes > rule.maxBytes - bytes
		) {
			candidate.eligible = false;
			candidate.blockers.push("Maximum count/bytes bound exceeded");
			candidate.plan = null;
		} else {
			count++;
			bytes += candidate.estimatedReclaimedBytes;
		}
	}
	return {
		evaluationTime: input.evaluationTime,
		candidates,
		recommendations: candidates.filter((c) => c.eligible),
	};
}
