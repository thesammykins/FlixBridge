import { createInternalError } from "./core.js";
import type { Recommendation } from "./retention/evaluator.js";
import type { RuleRevision } from "./retention/rules.js";

export function recommendationArguments(
	candidate: Recommendation,
	revision: RuleRevision,
): Record<string, unknown> {
	if (!candidate.eligible || !candidate.plan)
		throw createInternalError(
			"Only an eligible exact recommendation can request approval",
		);
	const common = {
		service: candidate.service,
		deleteFiles: true,
		users: revision.rule.users,
		allowUnsupportedFavourites:
			"allowUnsupportedFavourites" in revision.rule &&
			revision.rule.allowUnsupportedFavourites === true,
		watchedPolicy: revision.rule.watchedPolicy,
		retentionRuleId: revision.id,
		retentionRuleVersion: revision.version,
	};
	if (revision.rule.action === "remove-title")
		return {
			...common,
			target: "library",
			ids: [candidate.itemId],
			addImportExclusion: false,
			removeFromDownloader: false,
		};
	if (candidate.seasonNumber !== null)
		return {
			...common,
			target: "season",
			ids: [candidate.itemId],
			seasonNumbers: [candidate.seasonNumber],
		};
	return {
		...common,
		target: "files",
		itemId: candidate.itemId,
		ids: candidate.files.map((file) => file.id),
	};
}
