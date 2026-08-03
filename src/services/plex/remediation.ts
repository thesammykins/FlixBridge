// Plex reported-issues remediation orchestration.
//
// Flow: list reports (community.plex.tv GraphQL) → resolve each report URL to a
// Plex metadata item (PMS) → match the item against every arr service of the
// right media kind → act (comment / re-search / regrab) and comment back on the
// report. The harness (cron agent) decides which action per report; this module
// does the mechanics and keeps contracts explicit.

import { randomUUID } from "node:crypto";
import type {
	LibraryItemMatch,
	OperationResult,
	ServiceImplementation,
} from "../base.js";
import type {
	PlexComment,
	PlexMetadataItem,
	PlexReport,
	PlexReportsClient,
} from "./reports.js";

export interface ServiceMatch {
	service: string;
	mediaKind: "series" | "movie";
	matchType: "exact" | "title" | "none";
	item?: LibraryItemMatch;
}

export interface ResolvedReport extends PlexReport {
	item: PlexMetadataItem | null;
	matches: ServiceMatch[];
	resolved: boolean;
	resolutionState: ResolutionState;
}

export type RemediationAction =
	| "comment_only"
	| "re_search"
	| "remove_and_regrab"
	| "add_or_upgrade";

export interface RemediateInput {
	reportId?: string;
	action?: RemediationAction;
	service?: string;
	comment?: string;
	dryRun?: boolean;
	confirmationToken?: string;
}

// Fixed markers: a comment only counts as "fixed" when the user/our side
// explicitly says it's resolved. Negated phrases ("not fixed", "still broken")
// must NOT be treated as fixed — that would suppress still-open reports.
const FIXED_MARKERS = /\b(fixed|resolved|regrabb?ed|replaced|upgraded|done)\b/i;
const FIXED_NEGATIONS =
	/\b(not\s+(fixed|resolved|done)|still\s+(broken|freezing|cutting|cut|failing|glitch)|never\s+fixed|doesn'?t\s+work|unresolved)\b/i;
const CLARIFY_MARKERS =
	/\b(more specific|clarif|what exactly|which device|user-side)\b/i;

export type ResolutionState =
	| "unresolved"
	| "clarification_requested"
	| "fixed";

export function resolutionState(comments: PlexComment[]): ResolutionState {
	// Newest signal wins. Sort newest-first (comments without a parseable date
	// sort last) and return on the first recognized resolution signal; an older
	// "not fixed" must not override a newer "Fixed".
	const ordered = [...comments].sort((a, b) => {
		const da = Date.parse(a.date ?? "");
		const db = Date.parse(b.date ?? "");
		if (Number.isNaN(da) && Number.isNaN(db)) return 0;
		if (Number.isNaN(da)) return 1;
		if (Number.isNaN(db)) return -1;
		return db - da;
	});
	for (const c of ordered) {
		if (!c.message) continue;
		const negated = FIXED_NEGATIONS.test(c.message);
		if (FIXED_MARKERS.test(c.message) && !negated) {
			return "fixed";
		}
		if (negated) return "unresolved";
		if (CLARIFY_MARKERS.test(c.message)) {
			return "clarification_requested";
		}
	}
	return "unresolved";
}

// A Plex episode reports its series via grandparentTitle; seasons via parentTitle.
function titleForMatch(item: PlexMetadataItem): string {
	return item.type === "episode"
		? (item.grandparentTitle ?? item.parentTitle ?? item.title)
		: item.title;
}

function mediaKindFor(id: "sonarr" | "radarr"): "series" | "movie" {
	return id === "sonarr" ? "series" : "movie";
}

export async function resolveReportMatches(
	client: PlexReportsClient,
	report: PlexReport,
	services: ServiceImplementation[],
): Promise<ServiceMatch[]> {
	const item = await client.resolveReportUrl(report.url);
	if (!item) return [];

	const wantSonarr = item.type !== "movie";
	const candidates = services.filter((s) =>
		wantSonarr ? s.id === "sonarr" : s.id === "radarr",
	);

	const matches: ServiceMatch[] = [];
	for (const service of candidates) {
		const title = titleForMatch(item);
		const result = await service.lookupLibraryItem(title, item.year);
		if (!result.ok || !result.data) {
			matches.push({
				service: service.serviceName,
				mediaKind: mediaKindFor(service.id),
				matchType: "none",
			});
			continue;
		}
		const best = result.data.matches[0];
		if (!best) {
			matches.push({
				service: service.serviceName,
				mediaKind: mediaKindFor(service.id),
				matchType: "none",
			});
			continue;
		}
		const exact =
			best.title.trim().toLowerCase() === title.trim().toLowerCase() &&
			(item.year === undefined || best.year === item.year);
		matches.push({
			service: service.serviceName,
			mediaKind: mediaKindFor(service.id),
			matchType: exact ? "exact" : "title",
			item: best,
		});
	}
	return matches;
}

export async function resolveReports(
	client: PlexReportsClient,
	reports: PlexReport[],
	services: ServiceImplementation[],
): Promise<ResolvedReport[]> {
	const out: ResolvedReport[] = [];
	for (const report of reports) {
		const item = await client.resolveReportUrl(report.url);
		const matches = item
			? await resolveReportMatches(client, report, services)
			: [];
		out.push({
			...report,
			item,
			matches,
			resolved: resolutionState(report.comments) === "fixed",
			resolutionState: resolutionState(report.comments),
		});
	}
	return out;
}

// The one best service for remediation: exact match wins, then title-only,
// then (for adds) the first service of the right kind.
export function bestMatch(matches: ServiceMatch[]): ServiceMatch | undefined {
	return (
		matches.find((m) => m.matchType === "exact" && m.item) ??
		matches.find((m) => m.matchType === "title" && m.item) ??
		matches.find((m) => m.matchType !== "none")
	);
}

export interface RemediationPreview {
	reportId: string;
	action: RemediationAction;
	service: string;
	matchType: ServiceMatch["matchType"];
	item?: LibraryItemMatch;
	episodeFileId?: number;
	// Title as resolved from Plex (used for add_or_upgrade when not in library).
	resolvedTitle: string;
	note: string;
}

// Confirmation tokens for destructive actions, keyed by report id. The dry-run
// mints a token; execute must present it. TTL keeps stale tokens from lingering.
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const removeTokens = new Map<string, { token: string; expiresAt: number }>();

export function mintRemoveToken(reportId: string): string {
	const token = randomUUID();
	removeTokens.set(reportId, {
		token,
		expiresAt: Date.now() + CONFIRMATION_TTL_MS,
	});
	return token;
}

export function verifyRemoveToken(
	reportId: string,
	token: string | undefined,
): boolean {
	const entry = removeTokens.get(reportId);
	if (!entry || entry.expiresAt < Date.now()) {
		removeTokens.delete(reportId);
		return false;
	}
	if (entry.token !== token) return false;
	removeTokens.delete(reportId);
	return true;
}

// Compute the concrete plan for an action without executing it. Shared by the
// dry-run path and the execute path (which re-derives it and compares tokens).
export async function planRemediation(
	client: PlexReportsClient,
	report: PlexReport,
	action: RemediationAction,
	serviceName: string | undefined,
	services: ServiceImplementation[],
): Promise<OperationResult<RemediationPreview>> {
	const item = await client.resolveReportUrl(report.url);
	if (!item) {
		return {
			ok: false,
			error: {
				kind: "internal",
				message:
					"Report item could not be resolved (deleted from Plex or unknown key). Nothing to remediate.",
			},
		};
	}

	const matches = await resolveReportMatches(client, report, services);
	const rightKind = item.type === "movie" ? "radarr" : "sonarr";
	const rightKindService = (name: string | undefined) =>
		name !== undefined &&
		services.some((s) => s.serviceName === name && s.id === rightKind);

	// Explicitly named wrong-kind services are a caller mistake, not a hint to
	// silently substitute — reject loudly so the harness can fix its input.
	if (serviceName !== undefined) {
		const named = services.find((s) => s.serviceName === serviceName);
		if (named && named.id !== rightKind) {
			return {
				ok: false,
				error: {
					kind: "internal",
					message: `Service ${serviceName} is a ${named.id} service but this report needs ${rightKind}. Pass a ${rightKind} service.`,
				},
			};
		}
		if (!named) {
			return {
				ok: false,
				error: {
					kind: "internal",
					message: `Service ${serviceName} is not registered.`,
				},
			};
		}
	}

	const explicitMatch: ServiceMatch | undefined =
		serviceName && rightKindService(serviceName)
			? matches.find((m) => m.service === serviceName)
			: undefined;
	const chosen = explicitMatch ?? bestMatch(matches);

	// For add_or_upgrade a missing match is expected: no service holds the item
	// yet, so fall back to the first service of the right kind (or the explicit
	// service, only if it's the right kind) with matchType "none" so the caller
	// can add it. A movie report must never fall back to Sonarr, or an episode
	// report to Radarr.
	const fallbackChosen: ServiceMatch | undefined =
		!chosen && action === "add_or_upgrade"
			? (() => {
					const service =
						serviceName && rightKindService(serviceName)
							? serviceName
							: (services.find((s) => s.id === rightKind)?.serviceName ?? "");
					if (!service) return undefined;
					return {
						service,
						mediaKind: rightKind === "sonarr" ? "series" : "movie",
						matchType: "none",
					};
				})()
			: undefined;

	const target: ServiceMatch | undefined = chosen ?? fallbackChosen;

	if (!target) {
		return {
			ok: false,
			error: {
				kind: "internal",
				message: `No ${item.type === "movie" ? "radarr" : "sonarr"} service matched "${titleForMatch(item)}". Available: ${services.map((s) => s.serviceName).join(", ")}`,
			},
		};
	}

	const service = services.find((s) => s.serviceName === target.service);
	if (!service) {
		return {
			ok: false,
			error: {
				kind: "internal",
				message: `Service ${target.service} not registered`,
			},
		};
	}

	const title = titleForMatch(item);
	const base: RemediationPreview = {
		reportId: report.id,
		action,
		service: target.service,
		matchType: target.matchType,
		item: target.item,
		resolvedTitle: title,
		note: "",
	};

	switch (action) {
		case "comment_only":
			return {
				ok: true,
				data: {
					...base,
					note: `Post comment only${report.comments.length > 0 ? " (thread has comments)" : ""}.`,
				},
			};
		case "re_search":
			if (!target.item) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: `"${title}" is not in ${target.service}; use add_or_upgrade instead.`,
					},
				};
			}
			return {
				ok: true,
				data: {
					...base,
					note: `Trigger ${service.id === "sonarr" ? "SeriesSearch" : "MoviesSearch"} for "${title}" in ${target.service}.`,
				},
			};
		case "add_or_upgrade": {
			if (target.item) {
				return {
					ok: true,
					data: {
						...base,
						note: `"${title}" exists in ${target.service}; trigger search to upgrade quality.`,
					},
				};
			}
			return {
				ok: true,
				data: {
					...base,
					note: `"${title}" not in ${target.service}; add with standard quality profile, then search.`,
				},
			};
		}
		case "remove_and_regrab": {
			if (!target.item) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: `"${title}" is not in ${target.service}; nothing to remove.`,
					},
				};
			}
			let episodeFileId: number | undefined;
			if (service.id === "sonarr" && item.type === "episode") {
				const epResult = await service.lookupEpisodeFile(
					target.item.id,
					item.parentIndex,
					item.index,
				);
				const ep = epResult.ok
					? epResult.data?.matches.find((m) => m.hasFile)
					: undefined;
				episodeFileId = ep?.episodeFileId;
				if (episodeFileId === undefined) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `Episode S${item.parentIndex ?? "?"}E${item.index ?? "?"} of "${title}" has no file to remove in ${target.service}.`,
						},
					};
				}
			} else if (service.id === "radarr" && !target.item.movieFileId) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: `"${title}" has no movie file to remove in ${target.service}.`,
					},
				};
			}
			return {
				ok: true,
				data: {
					...base,
					episodeFileId,
					note: `Delete ${service.id === "sonarr" ? (item.type === "episode" ? `episode file ${episodeFileId}` : "series files") : `movie file ${target.item.movieFileId}`} in ${target.service}, then trigger search to regrab.`,
				},
			};
		}
	}
}

export function buildComment(
	action: RemediationAction,
	preview: RemediationPreview,
	extra?: string,
): string {
	const title = preview.item?.title ?? preview.resolvedTitle;
	switch (action) {
		case "re_search":
			return `Fixed: triggered a fresh search for "${title}" in ${preview.service}.`;
		case "add_or_upgrade":
			if (preview.note.includes("exists")) {
				return `Fixed: triggered a quality upgrade search for "${title}" in ${preview.service}.`;
			}
			return `Fixed: added "${title}" to ${preview.service} with the standard quality profile and triggered a search.`;
		case "remove_and_regrab":
			return `Fixed: removed the broken file for "${title}" in ${preview.service} and triggered a re-grab.`;
		case "comment_only":
			return (
				extra ??
				"Could you be more specific about what's wrong (which device, what happens, which episode/time)? That helps me pinpoint the issue."
			);
	}
}

export async function executeRemediation(
	client: PlexReportsClient,
	report: PlexReport,
	input: RemediateInput,
	services: ServiceImplementation[],
): Promise<OperationResult<unknown>> {
	if (input.action === "comment_only") {
		const message =
			input.comment ??
			"Could you be more specific about what's wrong (which device, what happens, which episode/time)? That helps me pinpoint the issue.";
		return await client.createReportComment(report.id, message);
	}

	if (input.action === undefined) {
		return {
			ok: false,
			error: { kind: "internal", message: "No action provided." },
		};
	}
	const action = input.action;

	const plan = await planRemediation(
		client,
		report,
		action,
		input.service,
		services,
	);
	if (!plan.ok || !plan.data) return plan;
	const preview = plan.data;

	const service = services.find((s) => s.serviceName === preview.service);
	if (!service) {
		return {
			ok: false,
			error: {
				kind: "internal",
				message: `Service ${preview.service} not registered`,
			},
		};
	}

	const actions: string[] = [];
	const failures: string[] = [];

	try {
		if (action === "add_or_upgrade") {
			if (!preview.item) {
				// Add as new entry with the standard (recommended) quality profile.
				const search = await service.search(preview.resolvedTitle);
				if (!search.ok || !search.data || search.data.results.length === 0) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `Could not find "${preview.resolvedTitle}" on ${preview.service} to add.`,
						},
					};
				}
				const candidate = search.data.results[0];
				if (!candidate) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `No candidate for "${preview.resolvedTitle}" on ${preview.service}.`,
						},
					};
				}
				if (candidate.foreignId === undefined) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `Candidate "${candidate.title}" on ${preview.service} has no foreignId to add.`,
						},
					};
				}
				const profiles = await service.listQualityProfiles();
				const profileId = profiles.ok ? profiles.data?.recommended : undefined;
				if (profileId === undefined) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `No recommended quality profile on ${preview.service}.`,
						},
					};
				}
				const add = await service.addNew({
					title: candidate.title,
					foreignId: candidate.foreignId,
					qualityProfileId: profileId,
					monitored: true,
				});
				if (!add.ok) return add;
				const id = add.data?.id;
				if (id === undefined) {
					return {
						ok: false,
						error: {
							kind: "internal",
							message: `Added "${candidate.title}" but got no item id back from ${preview.service}.`,
						},
					};
				}
				const addSearch = await service.triggerSearch(id);
				if (addSearch.ok) {
					actions.push(
						`added "${candidate.title}" (id ${id}) with standard profile + search`,
					);
				} else {
					failures.push("add succeeded but triggerSearch failed");
				}
			} else {
				const res = await service.triggerSearch(preview.item.id);
				if (res.ok)
					actions.push(`triggered upgrade search (${res.data?.command})`);
				else failures.push("triggerSearch failed");
			}
		} else if (action === "re_search") {
			if (!preview.item)
				return {
					ok: false,
					error: { kind: "internal", message: "No library item to search." },
				};
			const res = await service.triggerSearch(preview.item.id);
			if (res.ok) actions.push(`triggered search (${res.data?.command})`);
			else failures.push("triggerSearch failed");
		} else if (action === "remove_and_regrab") {
			// Destructive: only with a token minted by the dry-run.
			if (!verifyRemoveToken(report.id, input.confirmationToken)) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message:
							"Confirmation token missing or invalid for remove_and_regrab. Run with dryRun first, then pass the returned token.",
					},
				};
			}
			let deletedFile = false;
			if (service.id === "sonarr" && preview.episodeFileId !== undefined) {
				const del = await service.deleteFile(preview.episodeFileId);
				if (del.ok) {
					actions.push(`deleted episode file ${preview.episodeFileId}`);
					deletedFile = true;
				} else {
					failures.push("deleteFile failed");
				}
			} else if (
				service.id === "radarr" &&
				preview.item?.movieFileId !== undefined
			) {
				const del = await service.deleteFile(preview.item.movieFileId);
				if (del.ok) {
					actions.push(`deleted movie file ${preview.item.movieFileId}`);
					deletedFile = true;
				} else {
					failures.push("deleteFile failed");
				}
			} else {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: "No file id available to remove.",
					},
				};
			}
			if (!deletedFile) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: `File deletion failed on ${preview.service}; not re-searching (partial mutation guard).`,
					},
				};
			}
			const itemId = preview.item?.id;
			if (itemId === undefined) {
				return {
					ok: false,
					error: {
						kind: "internal",
						message: "No library item id available to re-search.",
					},
				};
			}
			const res = await service.triggerSearch(itemId);
			if (res.ok) actions.push(`triggered re-grab (${res.data?.command})`);
			else failures.push("triggerSearch failed");
		}

		if (failures.length > 0) {
			return {
				ok: false,
				error: {
					kind: "internal",
					message: `Partial failure: ${failures.join("; ")} (${actions.join("; ")})`,
				},
			};
		}

		// Comment back explaining what was done.
		const comment = buildComment(action, preview, actions.join("; "));
		const commentResult = await client.createReportComment(report.id, comment);
		return {
			ok: true,
			data: {
				preview,
				actions,
				commentPosted: commentResult.ok,
				comment,
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				kind: "internal",
				message:
					error instanceof Error
						? error.message
						: "Unexpected remediation error",
				cause: error,
			},
		};
	}
}
