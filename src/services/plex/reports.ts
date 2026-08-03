// Plex Reported Issues client — reads the user→server "Report Issue" feed and
// posts comments back. Two hosts are involved:
//   - community.plex.tv  GraphQL API (account token) — the reports themselves
//   - the PMS              REST API (X-Plex-Token)    — resolving report URLs
// The report `url` embeds the metadata key; resolve it against the PMS to learn
// what title/type the user complained about, then match to arr services.

import { z } from "zod";
import { fetchJson, handleError } from "../../core.js";
import type { OperationResult, ServiceError } from "../base.js";

export interface PlexConfig {
	baseUrl: string;
	token: string;
}

const GRAPHQL_URL = "https://community.plex.tv/api";

function gqlHeaders(
	token: string,
	clientIdentifier = "flixbridge",
): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Accept: "application/json",
		"X-Plex-Token": token,
		"X-Plex-Client-Identifier": clientIdentifier,
	};
}

function parseGraphql<T>(payload: unknown): T {
	if (
		payload &&
		typeof payload === "object" &&
		"errors" in payload &&
		Array.isArray((payload as { errors?: unknown[] }).errors) &&
		((payload as { errors: unknown[] }).errors.length ?? 0) > 0
	) {
		const message = (payload as { errors: Array<{ message?: string }> }).errors
			.map((e) => e.message ?? "unknown error")
			.join("; ");
		throw {
			service: "plex",
			status: 0,
			message: `Plex GraphQL error: ${message}`,
		} as ServiceError;
	}
	return (payload as { data: T }).data;
}

// Report node — field set mirrors the web app's getReportedIssues query.
const ReportNodeSchema = z.object({
	id: z.string(),
	message: z.string(),
	url: z.string(),
	date: z.string(),
	commentCount: z.number().optional(),
	user: z
		.object({
			id: z.string(),
			username: z.string().optional(),
			displayName: z.string().optional(),
		})
		.optional(),
});

const CommentNodeSchema = z.object({
	id: z.string(),
	message: z.string().optional(),
	date: z.string().optional(),
	user: z
		.object({
			id: z.string().optional(),
			username: z.string().optional(),
			displayName: z.string().optional(),
		})
		.optional(),
});

export interface PlexReport {
	id: string;
	message: string;
	url: string;
	date: string;
	commentCount: number;
	user?: { id: string; username?: string; displayName?: string };
	comments: PlexComment[];
}

export interface PlexComment {
	id: string;
	message?: string;
	date?: string;
	user?: { id?: string; username?: string; displayName?: string };
}

const METADATA_KEY_RE = /library\/metadata\/(\d+)/;

export interface PlexMetadataItem {
	key: string;
	type: string; // movie | show | season | episode
	title: string;
	year?: number;
	grandparentTitle?: string;
	parentTitle?: string;
	parentIndex?: number;
	index?: number;
}

export class PlexReportsClient {
	private readonly baseUrl: string;
	private readonly token: string;

	constructor(config: PlexConfig) {
		this.baseUrl = config.baseUrl.replace(/\/+$/, "");
		this.token = config.token;
	}

	async listReports(limit = 25): Promise<OperationResult<PlexReport[]>> {
		try {
			const payload = await fetchJson<unknown>(GRAPHQL_URL, {
				method: "POST",
				timeoutMs: 15000,
				headers: gqlHeaders(this.token),
				body: JSON.stringify({
					query: `query getReportedIssues($first: PaginationInt!, $after: String) {
						reports(after: $after, first: $first) {
							nodes { __typename id message user { id username displayName } url date commentCount }
							pageInfo { hasNextPage endCursor }
						}
					}`,
					variables: { first: limit, after: null },
				}),
			});
			const data = parseGraphql<{
				reports: {
					nodes: unknown[];
					pageInfo: { hasNextPage: boolean; endCursor?: string };
				};
			}>(payload);

			const reports: PlexReport[] = [];
			for (const raw of data.reports.nodes) {
				const node = ReportNodeSchema.parse(raw);
				const comments = await this.listReportComments(node.id);
				reports.push({
					id: node.id,
					message: node.message,
					url: node.url,
					date: node.date,
					commentCount: node.commentCount ?? comments.length,
					user: node.user,
					comments,
				});
			}
			return { ok: true, data: reports };
		} catch (error) {
			return handleError(error, "plex");
		}
	}

	async listReportComments(reportId: string): Promise<PlexComment[]> {
		const payload = await fetchJson<unknown>(GRAPHQL_URL, {
			method: "POST",
			timeoutMs: 15000,
			headers: gqlHeaders(this.token),
			body: JSON.stringify({
				query: `query reportComments($id: ID!, $first: PaginationInt) {
					reportComments(first: $first, id: $id) {
						nodes { __typename date id message user { id username displayName } }
					}
				}`,
				variables: { id: reportId, first: 20 },
			}),
		});
		const data = parseGraphql<{ reportComments: { nodes: unknown[] } }>(
			payload,
		);
		return data.reportComments.nodes.map((raw) => {
			const node = CommentNodeSchema.parse(raw);
			return {
				id: node.id,
				message: node.message,
				date: node.date,
				user: node.user,
			};
		});
	}

	async createReportComment(
		reportId: string,
		message: string,
	): Promise<OperationResult<PlexComment>> {
		try {
			const payload = await fetchJson<unknown>(GRAPHQL_URL, {
				method: "POST",
				timeoutMs: 15000,
				headers: gqlHeaders(this.token),
				body: JSON.stringify({
					query: `mutation createReportComment($input: CreateReportCommentInput!) {
						createReportComment(input: $input) {
							__typename date id message user { id username displayName }
						}
					}`,
					variables: { input: { report: reportId, message } },
				}),
			});
			const data = parseGraphql<{ createReportComment: unknown }>(payload);
			const node = CommentNodeSchema.parse(data.createReportComment);
			return {
				ok: true,
				data: {
					id: node.id,
					message: node.message,
					date: node.date,
					user: node.user,
				},
			};
		} catch (error) {
			return handleError(error, "plex");
		}
	}

	// Resolve a report URL to its Plex metadata item. Returns null when the
	// key can't be extracted or the item no longer exists (deleted since the
	// report — common for stale reports).
	async resolveReportUrl(url: string): Promise<PlexMetadataItem | null> {
		const match = METADATA_KEY_RE.exec(url);
		if (!match?.[1]) {
			return null;
		}
		const key = match[1];
		try {
			const payload = await fetchJson<unknown>(
				`${this.baseUrl}/library/metadata/${key}`,
				{
					timeoutMs: 10000,
					headers: {
						Accept: "application/json",
						"X-Plex-Token": this.token,
					},
				},
			);
			const container = payload as {
				MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
			};
			const meta = container.MediaContainer?.Metadata?.[0];
			if (!meta) {
				return null;
			}
			return {
				key,
				type: String(meta.type ?? ""),
				title: String(meta.title ?? ""),
				year: typeof meta.year === "number" ? meta.year : undefined,
				grandparentTitle:
					typeof meta.grandparentTitle === "string"
						? meta.grandparentTitle
						: undefined,
				parentTitle:
					typeof meta.parentTitle === "string" ? meta.parentTitle : undefined,
				parentIndex:
					typeof meta.parentIndex === "number" ? meta.parentIndex : undefined,
				index: typeof meta.index === "number" ? meta.index : undefined,
			};
		} catch (error) {
			// 404 = item deleted since the report; anything else is a real error.
			const err = error as { status?: number };
			if (err.status === 404) {
				return null;
			}
			throw error;
		}
	}
}

export function plexConfigFromEnv(): PlexConfig | null {
	const baseUrl = process.env.PLEX_BASE_URL ?? process.env.PLEX_URL;
	const token = process.env.PLEX_TOKEN;
	if (!baseUrl || !token) {
		return null;
	}
	return { baseUrl, token };
}
