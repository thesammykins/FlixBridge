import { z } from "zod";
import { loadConfigFromEnvOnly } from "./config.js";
import { fetchJson } from "./core.js";

export function classifyExecution(
	tool: string,
	result: unknown,
): { state: "completed" | "partial" | "uncertain"; verified: boolean } {
	const outcome = z
		.object({ ok: z.boolean(), data: z.unknown().optional() })
		.parse(result);
	const data = z.record(z.unknown()).safeParse(outcome.data);
	if (data.success && data.data.uncertain === true)
		return { state: "uncertain", verified: false };
	if (!outcome.ok || !data.success || tool === "remediate_reported_issue")
		return { state: "partial", verified: false };
	if (data.data.verified === true)
		return { state: "completed", verified: true };
	const removal = z
		.object({
			removed: z.number().int().nonnegative(),
			failed: z.literal(0),
			skipped: z.literal(0).optional(),
			details: z.array(z.object({ status: z.literal("removed") })).min(1),
		})
		.safeParse(data.data.result);
	const verified =
		removal.success && removal.data.removed === removal.data.details.length;
	return { state: verified ? "completed" : "partial", verified };
}

export async function verifyRemediationAbsence(
	preview: unknown,
): Promise<boolean> {
	const value = z
		.object({
			preview: z.object({
				service: z.string(),
				episodeFileId: z.number().int().positive().optional(),
				item: z
					.object({ movieFileId: z.number().int().positive().optional() })
					.passthrough()
					.optional(),
			}),
		})
		.parse(preview).preview;
	const service = (await loadConfigFromEnvOnly()).services[value.service];
	const fileId = value.episodeFileId ?? value.item?.movieFileId;
	if (!service || !fileId) return false;
	try {
		await fetchJson(
			`${service.baseUrl.replace(/\/$/, "")}/api/v3/${value.episodeFileId ? "episodefile" : "moviefile"}/${fileId}`,
			{ headers: { "X-Api-Key": service.apiKey } },
		);
		return false;
	} catch (error) {
		return (
			typeof error === "object" &&
			error !== null &&
			"status" in error &&
			error.status === 404
		);
	}
}
