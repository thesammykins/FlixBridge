import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { z } from "zod";
import { createInternalError, fetchJson } from "../core.js";
import { canonicalPlan, hashPlan } from "./hash.js";
import {
	type ApprovalStore,
	approvalDecisionSchema as decisionSchema,
} from "./store.js";

const MAX_CALLBACK_BYTES = 16 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;

function secret(): string {
	const value = process.env.FLIX_BRIDGE_APPROVAL_SECRET;
	if (!value || Buffer.byteLength(value) < 32)
		throw createInternalError(
			"Approval secret must be configured with at least 32 bytes",
		);
	return value;
}

function signature(body: string, timestamp: string, purpose: string): string {
	return `sha256=${createHmac("sha256", secret()).update(`flixbridge.approval.${purpose}.v1\n${timestamp}\n${body}`).digest("hex")}`;
}

/** Verify exact raw UTF-8 bytes. Timestamp is decimal Unix milliseconds, not seconds. */
export function verifyApprovalSignature(
	body: string,
	timestamp: string,
	supplied: string,
): boolean {
	if (
		!/^\d{13}$/.test(timestamp) ||
		Math.abs(Date.now() - Number(timestamp)) > MAX_SKEW_MS ||
		!/^sha256=[0-9a-f]{64}$/.test(supplied) ||
		Buffer.byteLength(body) > MAX_CALLBACK_BYTES
	)
		return false;
	try {
		return timingSafeEqual(
			Buffer.from(supplied),
			Buffer.from(signature(body, timestamp, "decision")),
		);
	} catch {
		return false;
	}
}

/** Optional notification only; no mutation, no retry, and no secret or upstream response in its result. */
export async function sendApprovalRequest(
	store: ApprovalStore,
	id: string,
): Promise<{ sent: boolean }> {
	const target = process.env.FLIX_BRIDGE_APPROVAL_WEBHOOK_URL;
	if (!target) return { sent: false };
	secret();
	let url: URL;
	try {
		url = new URL(target);
		const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			throw new Error();
	} catch {
		throw createInternalError(
			"Invalid approval webhook URL; require HTTPS or literal loopback HTTP without credentials or query",
		);
	}
	const record = await store.get(id);
	if (
		record.state !== "pending" ||
		Date.now() >= record.expiresAt ||
		hashPlan(record.plan) !== record.planHash
	)
		throw createInternalError(
			"Only pending immutable approval requests can be notified",
		);
	const buttons = (["yes", "no"] as const).map((decision) => {
		const reference = {
			requestId: record.id,
			planHash: record.planHash,
			expiresAt: record.expiresAt,
			decision,
		};
		return {
			label: decision === "yes" ? "Approve" : "Reject",
			reference,
			signature: signature(
				canonicalPlan(reference),
				String(record.expiresAt),
				"reference",
			),
		};
	});
	const body = JSON.stringify({
		event: "approval.requested",
		requestId: record.id,
		planHash: record.planHash,
		plan: record.plan,
		createdAt: record.createdAt,
		expiresAt: record.expiresAt,
		buttons,
	});
	if (Buffer.byteLength(body) > 300 * 1024)
		throw createInternalError("Approval notification exceeds limits");
	const timestamp = String(Date.now());
	try {
		await fetchJson(url.toString(), {
			method: "POST",
			redirect: "error",
			timeoutMs: 5000,
			headers: {
				"Content-Type": "application/json",
				"X-FlixBridge-Timestamp": timestamp,
				"X-FlixBridge-Signature": signature(body, timestamp, "request"),
			},
			body,
		});
	} catch {
		throw createInternalError("Approval notification failed; not retried");
	}
	return { sent: true };
}

export interface ApprovalBridgeOptions {
	host?: string;
	unsafeAllowExternalBinding?: boolean;
}

export function createApprovalBridge(
	store: ApprovalStore,
	options: ApprovalBridgeOptions = {},
): Server {
	const checkHost = (host: string) => {
		if (
			!["127.0.0.1", "::1"].includes(host) &&
			options.unsafeAllowExternalBinding !== true
		)
			throw createInternalError(
				"External approval binding requires explicit unsafe opt-in",
			);
	};
	const host = options.host ?? "127.0.0.1";
	checkHost(host);
	secret();
	if (
		!(process.env.FLIX_BRIDGE_APPROVAL_ACTORS ?? "")
			.split(",")
			.some((actor) => actor.trim())
	)
		throw createInternalError("Explicit approval actor allowlist required");
	const server = createServer(
		{ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 },
		async (request, response) => {
			const reply = (status: number, body: unknown) => {
				response.writeHead(status, {
					"content-type": "application/json",
					"cache-control": "no-store",
					connection: "close",
				});
				response.end(JSON.stringify(body));
			};
			if (request.url !== "/approvals/decision") {
				reply(404, { error: "Not found" });
				return;
			}
			if (request.method !== "POST") {
				reply(405, { error: "POST required" });
				return;
			}
			if (
				request.headers["content-type"]?.split(";", 1)[0]?.trim() !==
				"application/json"
			) {
				reply(415, { error: "JSON required" });
				return;
			}
			try {
				const chunks: Buffer[] = [];
				let bytes = 0;
				for await (const chunk of request) {
					bytes += chunk.length;
					if (bytes > MAX_CALLBACK_BYTES) {
						reply(413, { error: "Request exceeds limits" });
						return;
					}
					chunks.push(Buffer.from(chunk));
				}
				const body = new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true,
				}).decode(Buffer.concat(chunks));
				const timestamp = request.headers["x-flixbridge-timestamp"];
				const supplied = request.headers["x-flixbridge-signature"];
				if (
					typeof timestamp !== "string" ||
					typeof supplied !== "string" ||
					!verifyApprovalSignature(body, timestamp, supplied)
				) {
					reply(401, { error: "Invalid authentication" });
					return;
				}
				let input: z.infer<typeof decisionSchema>;
				try {
					input = decisionSchema.parse(JSON.parse(body));
				} catch {
					reply(400, { error: "Invalid decision" });
					return;
				}
				try {
					const record = await store.decide(input, true);
					reply(200, { requestId: record.id, state: record.state });
				} catch {
					reply(409, { error: "Decision not accepted" });
				}
			} catch {
				if (!response.headersSent) reply(400, { error: "Invalid request" });
			}
		},
	);
	// The returned server is intentionally not listening; omitted host must never mean 0.0.0.0.
	const listen = server.listen.bind(server);
	server.listen = ((...args: unknown[]) => {
		const first = args[0];
		const supplied =
			typeof first === "object" && first !== null
				? (first as Record<string, unknown>)
				: { port: first, host: typeof args[1] === "string" ? args[1] : host };
		const selectedHost = supplied.host ?? host;
		if (
			typeof selectedHost !== "string" ||
			typeof supplied.port !== "number" ||
			!Number.isInteger(supplied.port) ||
			supplied.port < 0 ||
			supplied.port > 65535 ||
			"path" in supplied ||
			"fd" in supplied ||
			"handle" in supplied
		)
			throw createInternalError(
				"Approval bridge requires a TCP port and explicit safe host",
			);
		checkHost(selectedHost);
		const last = args.at(-1);
		const callback =
			typeof last === "function" ? (last as () => void) : undefined;
		return listen({ port: supplied.port, host: selectedHost }, callback);
	}) as Server["listen"];
	return server;
}
