/**
 * Debug logging utility for Flix-Bridge MCP Server
 * Lightweight logging controlled by FLIX_BRIDGE_DEBUG environment variable
 */

const DEBUG_ENABLED = process.env.FLIX_BRIDGE_DEBUG === "1";

interface DebugContext {
	tool?: string;
	service?: string;
	operation?: string;
	[key: string]: unknown;
}

/**
 * Debug log function - only outputs when FLIX_BRIDGE_DEBUG=1
 */
export function debug(message: string, context?: DebugContext): void {
	if (!DEBUG_ENABLED) return;

	const timestamp = new Date().toISOString();
	const contextStr = context ? ` ${JSON.stringify(context)}` : "";
	console.error(`[${timestamp}] FLIX_BRIDGE: ${message}${contextStr}`);
}

/**
 * Tool execution timing wrapper
 */
export function debugToolTiming<T>(
	toolName: string,
	service: string,
	operation: () => Promise<T>,
): Promise<T> {
	if (!DEBUG_ENABLED) return operation();

	const startTime = Date.now();
	debug("tool.invoke start", { tool: toolName, service, t0: startTime });

	return operation()
		.then((result) => {
			const elapsed = Date.now() - startTime;
			debug("tool.invoke end", {
				tool: toolName,
				service,
				ms: elapsed,
				ok: true,
			});
			return result;
		})
		.catch((error) => {
			const elapsed = Date.now() - startTime;
			debug("tool.invoke end", {
				tool: toolName,
				service,
				ms: elapsed,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		});
}

/**
 * HTTP request timing and logging
 */
export function debugHttp(
	method: string,
	url: string,
	status?: number,
	ms?: number,
): void {
	if (!DEBUG_ENABLED) return;

	debug(`http.${method.toLowerCase()}`, { url, status, ms });
}

/**
 * Service operation logging
 */
export function debugOperation(
	service: string,
	operation: string,
	details?: Record<string, unknown>,
): void {
	if (!DEBUG_ENABLED) return;

	debug(`${service}.${operation}`, details);
}
