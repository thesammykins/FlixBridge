import type { Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import type {
	LibraryItem,
	LibrarySnapshot,
	ViewerScope,
	WatchEvidence,
} from "../library/model.js";
import { evaluateSnapshot, evidenceKey } from "./evaluator.js";
import {
	createRule,
	createRuleSchema,
	evaluateRule,
	evaluateRuleSchema,
	getRule,
	listRules,
	reviseRule,
	reviseRuleSchema,
} from "./rules.js";
import {
	type RetentionRuleInput,
	evaluationTimeSchema,
	ruleSchema,
} from "./schema.js";

export interface RetentionDependencies {
	loadLibrarySnapshot(services?: string[]): Promise<LibrarySnapshot>;
	getWatchEvidence(
		item: LibraryItem,
		users: ViewerScope[],
		seasonNumber?: number,
	): Promise<WatchEvidence>;
}
export const cleanupCandidatesSchema = z
	.object({ rule: ruleSchema, evaluationTime: evaluationTimeSchema })
	.strict();
const getRuleSchema = evaluateRuleSchema.omit({ evaluationTime: true });
const ruleOperationsSchema = z.union([
	z.object({ operation: z.literal("list") }).strict(),
	getRuleSchema.extend({ operation: z.literal("get") }).strict(),
	createRuleSchema.extend({ operation: z.literal("create") }).strict(),
	z
		.object({
			operation: z.literal("revise"),
			id: z.string(),
			expectedVersion: z.number(),
			name: z.string().optional(),
			rule: ruleSchema.optional(),
			enabled: z.boolean().optional(),
			evaluationTime: evaluationTimeSchema,
		})
		.strict(),
]);

export async function cleanupCandidates(
	input: z.input<typeof cleanupCandidatesSchema>,
	dependencies: RetentionDependencies,
) {
	const { rule, evaluationTime } = cleanupCandidatesSchema.parse(input);
	const snapshot = await dependencies.loadLibrarySnapshot(rule.services);
	const evidence: Record<string, WatchEvidence> = {};
	for (const item of snapshot.items) {
		if (
			!rule.services.includes(item.service) ||
			(rule.target === "movie"
				? item.mediaKind !== "movie"
				: item.mediaKind !== "series")
		)
			continue;
		const seasons =
			rule.target === "completed-season"
				? [...new Set(item.seasons.map((s) => s.seasonNumber))].sort(
						(a, b) => a - b,
					)
				: [undefined];
		for (const seasonNumber of seasons) {
			try {
				evidence[evidenceKey(item, seasonNumber)] =
					await dependencies.getWatchEvidence(item, rule.users, seasonNumber);
			} catch {
				evidence[evidenceKey(item, seasonNumber)] = {
					complete: false,
					activePlayback: null,
					favourite: null,
					viewers: [],
					blockers: ["Watch evidence unavailable"],
				};
			}
		}
	}
	return evaluateSnapshot({
		snapshot,
		rule,
		watchEvidence: evidence,
		evaluationTime,
	});
}
export async function runRetentionTool(
	name: string,
	args: unknown,
	dependencies: RetentionDependencies,
) {
	if (name === "cleanup_candidates")
		return cleanupCandidates(cleanupCandidatesSchema.parse(args), dependencies);
	if (name === "retention_evaluate")
		return evaluateRule(evaluateRuleSchema.parse(args), (rule, context) =>
			cleanupCandidates(
				{ rule, evaluationTime: context.evaluationTime },
				dependencies,
			),
		);
	if (name === "retention_rules") {
		const parsed = ruleOperationsSchema.parse(args);
		if (parsed.operation === "list") return listRules();
		const { operation, ...input } = parsed;
		if (operation === "get") {
			const target = getRuleSchema.parse(input);
			return getRule(target.id, target.version);
		}
		if (operation === "create")
			return createRule(createRuleSchema.parse(input));
		return reviseRule(reviseRuleSchema.parse(input));
	}
	throw new Error("Unknown retention tool");
}

const bytes = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const days = { type: "number", minimum: 0, maximum: 36500 };
const time = {
	type: "string",
	format: "date-time",
	description: "Explicit RFC3339 evaluation time; no implicit wall clock",
};
const id = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const version = {
	type: "integer",
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
};
export const ruleJsonSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		services: {
			type: "array",
			minItems: 1,
			maxItems: 100,
			uniqueItems: true,
			items: { type: "string", minLength: 1, maxLength: 200 },
		},
		users: {
			type: "array",
			minItems: 1,
			maxItems: 100,
			uniqueItems: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					server: { type: "string", minLength: 1, maxLength: 200 },
					userId: { type: "string", minLength: 1, maxLength: 200 },
				},
				required: ["server", "userId"],
			},
		},
		watchedPolicy: {
			type: "string",
			enum: ["all-selected", "any-selected"],
			default: "all-selected",
		},
		watchState: {
			type: "string",
			enum: ["watched", "unwatched"],
			default: "watched",
		},
		target: { type: "string", enum: ["movie", "show", "completed-season"] },
		action: {
			type: "string",
			enum: ["unmonitor-delete-files", "remove-title"],
		},
		minSizeBytes: bytes,
		minAddedAgeDays: days,
		watchGraceDays: days,
		minInactiveDays: days,
		rating: {
			type: "object",
			additionalProperties: false,
			properties: {
				source: { type: "string", minLength: 1, maxLength: 100 },
				scale: { type: "number", exclusiveMinimum: 0 },
				maxValue: { type: "number", minimum: 0 },
				minVotes: bytes,
			},
			required: ["source", "scale", "maxValue", "minVotes"],
		},
		protectedTags: {
			type: "array",
			maxItems: 100,
			items: { type: "string", minLength: 1, maxLength: 200 },
		},
		includeSpecials: { type: "boolean", default: false },
		allowUnsupportedFavourites: { type: "boolean", default: false },
		maxCount: { type: "integer", minimum: 1, maximum: 10000 },
		maxBytes: bytes,
		intervalHours: { type: "number", exclusiveMinimum: 0, maximum: 87600 },
	},
	required: [
		"services",
		"users",
		"target",
		"action",
		"minSizeBytes",
		"minAddedAgeDays",
		"watchGraceDays",
		"minInactiveDays",
		"protectedTags",
		"maxCount",
		"maxBytes",
	] satisfies Array<keyof RetentionRuleInput>,
	allOf: [
		{
			if: {
				properties: { target: { const: "completed-season" } },
				required: ["target"],
			},
			// biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
			then: {
				properties: {
					watchState: { const: "watched" },
					action: { const: "unmonitor-delete-files" },
				},
			},
		},
	],
};
export const cleanup_candidates: Tool = {
	name: "cleanup_candidates",
	description:
		"Read-only deterministic cleanup proposals with exact files, evidence and blockers. All selected users watched by default. Never deletes or unmonitors.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		properties: { rule: ruleJsonSchema, evaluationTime: time },
		required: ["rule", "evaluationTime"],
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
};
export const retention_rules: Tool = {
	name: "retention_rules",
	description:
		"List/get/create/revise durable retention rules under explicit FLIX_BRIDGE_STATE_DIR. New rules disabled. Revisions require expectedVersion; only local rule state changes, never live media.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		properties: {
			operation: { type: "string", enum: ["list", "get", "create", "revise"] },
			id,
			name: { type: "string", minLength: 1, maxLength: 200 },
			rule: ruleJsonSchema,
			enabled: { type: "boolean" },
			expectedVersion: version,
			version,
			evaluationTime: time,
		},
		required: ["operation"],
		oneOf: [
			{
				properties: { operation: { const: "list" } },
				required: ["operation"],
				maxProperties: 1,
			},
			{
				properties: { operation: { const: "get" } },
				required: ["operation", "id"],
				not: {
					anyOf: [
						"name",
						"rule",
						"enabled",
						"expectedVersion",
						"evaluationTime",
					].map((key) => ({ required: [key] })),
				},
			},
			{
				properties: { operation: { const: "create" } },
				required: ["operation", "id", "name", "rule", "evaluationTime"],
				not: {
					anyOf: ["enabled", "expectedVersion", "version"].map((key) => ({
						required: [key],
					})),
				},
			},
			{
				properties: { operation: { const: "revise" } },
				required: ["operation", "id", "expectedVersion", "evaluationTime"],
				anyOf: ["name", "rule", "enabled"].map((key) => ({ required: [key] })),
				not: { required: ["version"] },
			},
		],
	},
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
};
export const retention_evaluate: Tool = {
	name: "retention_evaluate",
	description:
		"Evaluate an exact stored rule revision, including disabled-rule previews. Creates recommendations only; no approval, deletion, monitoring writes or schedule changes.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		properties: { id, version, evaluationTime: time },
		required: ["id", "evaluationTime"],
	},
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
};
export const retentionTools: Tool[] = [
	cleanup_candidates,
	retention_rules,
	retention_evaluate,
];
