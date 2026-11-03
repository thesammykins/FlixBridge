import {
	type JSONRPCRequest,
	PROTOCOL_VERSION_META_KEY,
	type Result,
	Server,
	type ServerContext,
	UnsupportedProtocolVersionError,
} from "@modelcontextprotocol/server";

// Remove when a published SDK passes unsupported-version-after-pin wire tests.
export class VersionCheckedServer extends Server {
	protected override _wrapHandler(
		method: string,
		handler: (request: JSONRPCRequest, ctx: ServerContext) => Promise<Result>,
	): (request: JSONRPCRequest, ctx: ServerContext) => Promise<Result> {
		const wrapped = super._wrapHandler(method, handler);
		return async (request, ctx) => {
			// Keep metadata access runtime-checked across SDK declaration revisions.
			const envelope = ctx.mcpReq.envelope as
				| Record<string, unknown>
				| undefined;
			const claimed = envelope?.[PROTOCOL_VERSION_META_KEY];
			const requested = typeof claimed === "string" ? claimed : "unknown";
			if (requested !== "2026-07-28")
				throw new UnsupportedProtocolVersionError({
					supported: ["2026-07-28"],
					requested,
				});
			return wrapped(request, ctx);
		};
	}
}
