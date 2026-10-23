import { z } from "zod";

const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const days = z.number().min(0).max(36500);
export const evaluationTimeSchema = z.string().datetime({ offset: true });
export const viewerSchema = z
	.object({
		server: z
			.string()
			.min(1)
			.max(200)
			.refine(
				(value) => value === value.trim(),
				"Server identifier cannot contain edge whitespace",
			),
		userId: z.string().min(1).max(200),
	})
	.strict();
export const ruleSchema = z
	.object({
		services: z.array(z.string().min(1).max(200)).min(1).max(100),
		users: z.array(viewerSchema).min(1).max(100),
		watchedPolicy: z
			.enum(["all-selected", "any-selected"])
			.default("all-selected"),
		target: z.enum(["movie", "show", "completed-season"]),
		action: z.enum(["unmonitor-delete-files", "remove-title"]),
		minSizeBytes: bytes,
		minAddedAgeDays: days,
		watchGraceDays: days,
		minInactiveDays: days,
		rating: z
			.object({
				source: z.string().min(1).max(100),
				scale: z.number().positive().finite(),
				maxValue: z.number().nonnegative().finite(),
				minVotes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
			})
			.strict()
			.refine((r) => r.maxValue <= r.scale, "Rating exceeds scale")
			.optional(),
		protectedTags: z.array(z.string().min(1).max(200)).max(100),
		includeSpecials: z.boolean().default(false),
		maxCount: z.number().int().min(1).max(10000),
		maxBytes: bytes,
		intervalHours: z.number().positive().max(87600).optional(),
	})
	.strict()
	.superRefine((rule, ctx) => {
		if (new Set(rule.services).size !== rule.services.length)
			ctx.addIssue({ code: "custom", message: "Duplicate services" });
		if (
			new Set(rule.users.map((u) => JSON.stringify([u.server, u.userId])))
				.size !== rule.users.length
		)
			ctx.addIssue({ code: "custom", message: "Duplicate users" });
		if (rule.target === "completed-season" && rule.action === "remove-title")
			ctx.addIssue({
				code: "custom",
				message: "Season rules cannot remove a whole title",
			});
	});
export type RetentionRule = z.infer<typeof ruleSchema>;
export type RetentionRuleInput = z.input<typeof ruleSchema>;
