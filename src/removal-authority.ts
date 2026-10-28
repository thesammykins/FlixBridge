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

export interface QueueDiscardAuthority {
	kind: "queue-discard-policy";
	executionId: string;
	planHash: string;
	allowed: Array<{ origin: string; path: string }>;
	beforeRemoval: (url: URL, method: string) => Promise<void>;
}
const queuePolicy = new AsyncLocalStorage<QueueDiscardAuthority>();
export function withQueueDiscardAuthority<T>(
	permit: QueueDiscardAuthority,
	operation: () => Promise<T>,
): Promise<T> {
	return queuePolicy.run(permit, operation);
}

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
	body?: unknown,
): Promise<void> {
	const policy = queuePolicy.getStore();
	if (policy && isRemovalRequest(url, method)) {
		if (body !== undefined && body !== null)
			throw new Error("Policy removal cannot contain a body");
		await policy.beforeRemoval(url, method);
		return;
	}
	if (isRemovalRequest(url, method))
		await authority.getStore()?.beforeRemoval?.(url, method);
}

export function removalRequestAllowed(url: URL, method: string): boolean {
	const policy = queuePolicy.getStore();
	if (policy) {
		if (["GET", "HEAD"].includes(method)) return !isRemovalRequest(url, method);
		const flags = {
			removeFromClient: "true",
			blocklist: "false",
			skipRedownload: "false",
			changeCategory: "false",
		};
		return (
			policy.kind === "queue-discard-policy" &&
			!!policy.executionId &&
			/^[a-f0-9]{64}$/.test(policy.planHash) &&
			method === "DELETE" &&
			[...url.searchParams].length === 4 &&
			Object.entries(flags).every(
				([key, value]) => url.searchParams.get(key) === value,
			) &&
			policy.allowed.some(
				(target) =>
					target.origin === url.origin && target.path === url.pathname,
			)
		);
	}
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
