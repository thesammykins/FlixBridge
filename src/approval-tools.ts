import type { Tool } from "@modelcontextprotocol/server";
import { z } from "zod";

const id = { type: "string", format: "uuid", minLength: 1, maxLength: 256 };
export const approvalInput = z
	.object({
		tool: z.enum([
			"remove_content",
			"remediate_reported_issue",
			"update_monitoring",
		]),
		arguments: z.record(z.string(), z.unknown()),
	})
	.strict();
export const approvalIdInput = z
	.object({ requestId: z.string().uuid() })
	.strict();
export const monitoringInput = z
	.object({
		service: z.string().min(1).max(256),
		itemId: z.number().int().positive().safe(),
		seasonNumbers: z
			.array(z.number().int().nonnegative().safe())
			.min(1)
			.max(100)
			.optional(),
		episodeIds: z
			.array(z.number().int().positive().safe())
			.min(1)
			.max(1000)
			.optional(),
		monitored: z.boolean(),
		dryRun: z.boolean().optional(),
		approvalId: z.string().uuid().optional(),
	})
	.strict()
	.refine(
		(x) => !(x.seasonNumbers && x.episodeIds),
		"Choose season or episode scope, not both",
	);
export const approvalTools: Tool[] = [
	{
		name: "request_approval",
		description:
			"Prepare an exact fresh removal/monitoring plan and request authenticated human approval. This tool cannot approve its own request.",
		inputSchema: {
			type: "object",
			properties: {
				tool: {
					type: "string",
					enum: [
						"remove_content",
						"remediate_reported_issue",
						"update_monitoring",
					],
				},
				arguments: { type: "object", additionalProperties: true },
			},
			required: ["tool", "arguments"],
		},
	},
	{
		name: "approval_status",
		description:
			"Read a durable approval and execution record. Reading an approval never grants authority.",
		inputSchema: {
			type: "object",
			properties: { requestId: id },
			required: ["requestId"],
		},
	},
	{
		name: "cancel_approval",
		description:
			"Cancel an unexecuted approval request and revoke its authority.",
		inputSchema: {
			type: "object",
			properties: { requestId: id },
			required: ["requestId"],
		},
	},
	{
		name: "update_monitoring",
		description:
			"Preview or human-approved update of exact movie, show, season or episode monitoring; no file deletion.",
		inputSchema: {
			type: "object",
			properties: {
				service: { type: "string" },
				itemId: {
					type: "integer",
					minimum: 1,
					maximum: Number.MAX_SAFE_INTEGER,
				},
				seasonNumbers: {
					type: "array",
					minItems: 1,
					maxItems: 100,
					items: {
						type: "integer",
						minimum: 0,
						maximum: Number.MAX_SAFE_INTEGER,
					},
				},
				episodeIds: {
					type: "array",
					minItems: 1,
					maxItems: 1000,
					items: {
						type: "integer",
						minimum: 1,
						maximum: Number.MAX_SAFE_INTEGER,
					},
				},
				monitored: { type: "boolean" },
				dryRun: { type: "boolean" },
				approvalId: id,
			},
			required: ["service", "itemId", "monitored"],
		},
	},
];
