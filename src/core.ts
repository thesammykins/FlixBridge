import type { ServiceError, InternalError } from "./services/base.js";
import { debugHttp } from "./debug.js";

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
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...fetchOptions,
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				...fetchOptions.headers,
			},
		});

		const elapsed = Date.now() - startTime;
		debugHttp(method, url, response.status, elapsed);
		clearTimeout(timeoutId);

		if (!response.ok) {
			let errorMessage = `HTTP ${response.status}`;
			let errorCode: string | undefined;
			let rawError: unknown;

			try {
				const errorBody = await response.json();
				if (errorBody.message) errorMessage = errorBody.message;
				if (errorBody.code) errorCode = errorBody.code;
				rawError = errorBody;
			} catch {
				// Ignore JSON parsing errors for error responses
			}

			throw {
				service: "unknown",
				status: response.status,
				code: errorCode,
				message: errorMessage,
				raw: rawError,
			} as ServiceError;
		}

		return await response.json();
	} catch (error) {
		const elapsed = Date.now() - startTime;
		debugHttp(method, url, undefined, elapsed);
		clearTimeout(timeoutId);

		if (error && typeof error === "object" && "service" in error) {
			throw error; // Re-throw ServiceError
		}

		if (error instanceof Error && error.name === "AbortError") {
			throw {
				service: "unknown",
				status: 0,
				message: `Request timeout after ${timeoutMs}ms`,
			} as ServiceError;
		}

		throw {
			kind: "internal",
			message: error instanceof Error ? error.message : "Unknown error",
			cause: error,
		} as InternalError;
	}
}

export function createServiceError(
	service: string,
	status: number,
	message: string,
	code?: string,
): ServiceError {
	return { service, status, message, code };
}

export function createInternalError(
	message: string,
	cause?: unknown,
): InternalError {
	return { kind: "internal", message, cause };
}

export function handleError(
	error: unknown,
	serviceName: string,
): { ok: false; error: ServiceError | InternalError } {
	if (error && typeof error === "object") {
		if ("service" in error || "kind" in error) {
			return { ok: false, error: error as ServiceError | InternalError };
		}
	}

	return {
		ok: false,
		error: createInternalError(`Unexpected error in ${serviceName}`, error),
	};
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
