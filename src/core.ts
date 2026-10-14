import { debugHttp } from "./debug.js";
import { requestSignal } from "./request-context.js";
import type { InternalError, ServiceError } from "./services/base.js";

export interface HttpOptions extends globalThis.RequestInit {
	timeoutMs?: number;
}

export async function fetchJson<T>(
	url: string,
	options: HttpOptions = {},
): Promise<T> {
	const { timeoutMs = 5000, ...fetchOptions } = options;
	const method = fetchOptions.method || "GET";
	const startTime = Date.now();

	const controller = new AbortController();
	const cancel = () =>
		controller.abort(createServiceError("unknown", 0, "Request cancelled"));
	const sources = [fetchOptions.signal, requestSignal.getStore()].filter(
		(signal): signal is AbortSignal => !!signal,
	);
	for (const signal of sources) {
		if (signal.aborted) cancel();
		else signal.addEventListener("abort", cancel, { once: true });
	}
	const timeoutId = setTimeout(
		() =>
			controller.abort(
				createServiceError(
					"unknown",
					0,
					`Request timeout after ${timeoutMs}ms`,
				),
			),
		timeoutMs,
	);
	const aborted = new Promise<never>((_, reject) => {
		if (controller.signal.aborted) reject(controller.signal.reason);
		else
			controller.signal.addEventListener(
				"abort",
				() => reject(controller.signal.reason),
				{ once: true },
			);
	});

	try {
		if (controller.signal.aborted) await aborted;
		let target = new URL(url);
		if (
			!["http:", "https:"].includes(target.protocol) ||
			target.username ||
			target.password
		)
			throw createInternalError("Invalid HTTP URL");
		const origin = target.origin;
		const headers = new Headers(fetchOptions.headers);
		if (!headers.has("Accept")) headers.set("Accept", "application/json");
		let requestMethod = method;
		let body = fetchOptions.body;
		let response: Response;
		for (let hop = 0; ; hop++) {
			if (controller.signal.aborted) await aborted;
			response = await Promise.race([
				fetch(target.toString(), {
					...fetchOptions,
					method: requestMethod,
					body,
					headers,
					redirect: "manual",
					signal: controller.signal,
				}),
				aborted,
			]);
			if (![301, 302, 303, 307, 308].includes(response.status)) break;
			const location = response.headers.get("location");
			await response.body?.cancel();
			if (!location || hop >= 5)
				throw createInternalError("Invalid or excessive HTTP redirect");
			const next = new URL(location, target);
			if (next.origin !== origin || next.username || next.password)
				throw createInternalError("Unsafe HTTP redirect rejected");
			if (
				(response.status === 303 && requestMethod !== "HEAD") ||
				([301, 302].includes(response.status) && requestMethod === "POST")
			) {
				requestMethod = "GET";
				body = undefined;
				headers.delete("content-type");
				headers.delete("content-length");
			}
			target = next;
		}

		const elapsed = Date.now() - startTime;
		debugHttp(method, url, response.status, elapsed);

		let text = "";
		let bytes = 0;
		const reader = response.body?.getReader();
		if (reader) {
			const decoder = new TextDecoder();
			try {
				for (;;) {
					const { done, value } = await Promise.race([reader.read(), aborted]);
					if (done) break;
					bytes += value.byteLength;
					if (bytes > 8 * 1024 * 1024)
						throw createInternalError("HTTP response exceeds size limit");
					text += decoder.decode(value, { stream: true });
				}
				text += decoder.decode();
			} finally {
				void reader.cancel().catch(() => {});
				reader.releaseLock();
			}
		}
		if (!response.ok)
			throw createServiceError(
				"unknown",
				response.status,
				`HTTP ${response.status}`,
			);
		if (!text) {
			return undefined as T;
		}

		try {
			return JSON.parse(text) as T;
		} catch {
			throw createInternalError("Failed to parse JSON response");
		}
	} catch (error) {
		const elapsed = Date.now() - startTime;
		debugHttp(method, url, undefined, elapsed);

		if (error && typeof error === "object" && trustedErrors.has(error)) {
			throw error; // Re-throw ServiceError
		}

		if (error instanceof Error && error.name === "AbortError") {
			throw {
				service: "unknown",
				status: 0,
				message: `Request timeout after ${timeoutMs}ms`,
			} as ServiceError;
		}

		throw createInternalError("HTTP request failed");
	} finally {
		clearTimeout(timeoutId);
		for (const signal of sources) signal.removeEventListener("abort", cancel);
	}
}

const trustedErrors = new WeakSet<object>();

export function serializeError(error: unknown): ServiceError | InternalError {
	let result: ServiceError | InternalError;
	if (error && typeof error === "object" && trustedErrors.has(error)) {
		if ("service" in error) {
			const value = error as ServiceError;
			result = {
				service: value.service,
				status: value.status,
				message: value.message,
				code: value.code,
			};
		} else
			result = { kind: "internal", message: (error as InternalError).message };
	} else if (
		error &&
		typeof error === "object" &&
		"status" in error &&
		typeof error.status === "number"
	) {
		result = {
			service: "unknown",
			status: error.status,
			message: `HTTP ${error.status}`,
		};
	} else result = { kind: "internal", message: "Unexpected internal error" };
	// Re-serialization stays safe and preserves our own normalized diagnostic messages.
	trustedErrors.add(result);
	return result;
}

export function createServiceError(
	service: string,
	status: number,
	message: string,
	code?: string,
): ServiceError {
	const error = { service, status, message, code };
	trustedErrors.add(error);
	return error;
}

export function createInternalError(
	message: string,
	cause?: unknown,
): InternalError {
	void cause;
	const error: InternalError = { kind: "internal", message };
	trustedErrors.add(error);
	return error;
}

export function handleError(
	error: unknown,
	serviceName: string,
): { ok: false; error: ServiceError | InternalError } {
	void serviceName;
	return { ok: false, error: serializeError(error) };
}

export function buildUrl(
	baseUrl: string,
	path: string,
	params: Record<string, string | number> = {},
): string {
	const url = new URL(path, baseUrl);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, String(value));
	}
	return url.toString();
}
