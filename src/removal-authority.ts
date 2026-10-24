import { AsyncLocalStorage } from "node:async_hooks";

export interface RemovalAuthority {
	approvalId: string;
	planHash: string;
	// Only the orchestrator constructs authority after a durable approval claim.
	allowed: Array<{ origin: string; path: string; ids?: string[] }>;
	// Revalidate authoritative evidence at the final shared HTTP removal boundary.
	beforeRemoval?: (url: URL, method: string) => Promise<void>;
}

const authority = new AsyncLocalStorage<RemovalAuthority>();

export function withRemovalAuthority<T>(
	permit: RemovalAuthority,
	operation: () => Promise<T>,
): Promise<T> {
	return authority.run(permit, operation);
}

export function isRemovalRequest(url: URL, method: string): boolean {
	return (
		method.toUpperCase() === "DELETE" ||
		(["queue", "history"].includes(url.searchParams.get("mode") ?? "") &&
			["delete", "delete_all", "purge"].includes(
				url.searchParams.get("name") ?? "",
			))
	);
}

export async function revalidateRemovalRequest(
	url: URL,
	method: string,
): Promise<void> {
	if (isRemovalRequest(url, method))
		await authority.getStore()?.beforeRemoval?.(url, method);
}

export function removalRequestAllowed(url: URL, method: string): boolean {
	const sabRemoval =
		["queue", "history"].includes(url.searchParams.get("mode") ?? "") &&
		["delete", "delete_all", "purge"].includes(
			url.searchParams.get("name") ?? "",
		);
	if (method.toUpperCase() !== "DELETE" && !sabRemoval) return true;
	const permit = authority.getStore();
	if (!permit?.approvalId || !/^[a-f0-9]{64}$/.test(permit.planHash))
		return false;
	return permit.allowed.some(
		(target) =>
			target.origin === url.origin &&
			target.path === url.pathname &&
			(!sabRemoval ||
				(url.searchParams.get("name") === "delete" &&
					target.ids?.includes(url.searchParams.get("value") ?? ""))),
	);
}
