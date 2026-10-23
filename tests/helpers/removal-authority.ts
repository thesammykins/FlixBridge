import { createHash } from "node:crypto";
import { withRemovalAuthority } from "../../src/removal-authority.js";

// Synthetic authority for post-approval service tests only. Targets are explicit
// fixture URLs, never learned from requests; real dispatch must claim approval.
export function withFixtureRemovalAuthority<T>(
	targets: Array<string | { url: string; ids: string[] }>,
	operation: () => Promise<T>,
): Promise<T> {
	const allowed = targets.map((target) => {
		const url = new URL(typeof target === "string" ? target : target.url);
		return {
			origin: url.origin,
			path: url.pathname,
			...(typeof target === "string" ? {} : { ids: target.ids }),
		};
	});
	return withRemovalAuthority(
		{
			approvalId: "synthetic-post-approval-fixture",
			planHash: createHash("sha256")
				.update(JSON.stringify(allowed))
				.digest("hex"),
			allowed,
		},
		operation,
	);
}
