import { createHash } from "node:crypto";
import { z } from "zod";
import { loadConfigFromEnvOnly } from "./config.js";
import { createInternalError } from "./core.js";
import type { RemovalAuthority } from "./removal-authority.js";

export function immutablePreview(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value, (key, field: unknown) =>
			["confirmationToken", "nextAction", "observedAt"].includes(key)
				? undefined
				: field,
		),
	);
}

export async function instanceBindings() {
	const config = await loadConfigFromEnvOnly();
	const digest = (value: unknown) =>
		createHash("sha256").update(JSON.stringify(value)).digest("hex");
	return {
		services: Object.entries(config.services)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, c]) => ({
				name,
				fingerprint: digest([c.baseUrl, c.apiKey, c.apiVersion ?? null]),
			})),
		downloaders: Object.entries(config.downloaders ?? {})
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, c]) => ({
				name,
				fingerprint: digest([c.baseUrl, c.apiKey]),
			})),
	};
}

export async function removalPermit(
	approvalId: string,
	planHash: string,
	tool: string,
	input: Record<string, unknown>,
	preview: unknown,
): Promise<RemovalAuthority> {
	const config = await loadConfigFromEnvOnly();
	const permit: RemovalAuthority = { approvalId, planHash, allowed: [] };
	const add = (base: string, path: string, ids?: string[]) => {
		const url = new URL(`${base.replace(/\/$/, "")}${path}`);
		permit.allowed.push({ origin: url.origin, path: url.pathname, ids });
	};
	const data = z
		.object({
			preview: z.unknown().optional(),
			plan: z.unknown().optional(),
			downloadIds: z.array(z.string()).optional(),
		})
		.passthrough()
		.parse(preview);
	if (tool === "remediate_reported_issue") {
		const p = z
			.object({
				service: z.string(),
				episodeFileId: z.number().int().positive().optional(),
				item: z
					.object({ movieFileId: z.number().int().positive().optional() })
					.passthrough()
					.optional(),
			})
			.parse(data.preview);
		const c = config.services[p.service];
		if (!c)
			throw createInternalError("Approval service is no longer configured");
		const fileId = p.episodeFileId ?? p.item?.movieFileId;
		if (!fileId)
			throw createInternalError(
				"Exact file identity missing from approved remediation",
			);
		add(
			c.baseUrl,
			`/api/v3/${p.episodeFileId ? "episodefile" : "moviefile"}/${fileId}`,
		);
	} else if (input.target === "season" || input.target === "files") {
		const p = z
			.object({
				item: z.object({
					service: z.string(),
					mediaKind: z.enum(["series", "movie"]),
				}),
				files: z.array(z.object({ id: z.number().int().positive() })),
			})
			.parse(data.plan);
		const c = config.services[p.item.service];
		if (!c)
			throw createInternalError("Approval service is no longer configured");
		for (const f of p.files)
			add(
				c.baseUrl,
				`/api/v3/${p.item.mediaKind === "series" ? "episodefile" : "moviefile"}/${f.id}`,
			);
	} else if (tool === "remove_content" && typeof input.service === "string") {
		const c = config.services[input.service];
		if (!c)
			throw createInternalError("Approval service is no longer configured");
		const kind =
			input.target === "library"
				? input.service.includes("sonarr")
					? "series"
					: "movie"
				: "queue";
		const ids = z
			.array(
				z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]),
			)
			.parse(input.ids);
		for (const id of ids) add(c.baseUrl, `/api/v3/${kind}/${id}`);
	}
	if (
		typeof input.downloader === "string" &&
		(!input.service || input.removeFromDownloader === true)
	) {
		const c = config.downloaders?.[input.downloader];
		if (!c)
			throw createInternalError("Approval downloader is no longer configured");
		const ids = input.service
			? data.downloadIds
			: z.array(z.string()).parse(input.ids);
		add(c.baseUrl, "/api", ids ?? []);
	}
	return permit;
}
