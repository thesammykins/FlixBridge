import { createHash } from "node:crypto";
import { createInternalError } from "../core.js";

export const MAX_PLAN_BYTES = 256 * 1024;

export function canonicalPlan(plan: unknown): string {
	const seen = new Set<object>();
	let nodes = 0;
	function encode(value: unknown, depth: number): string {
		if (++nodes > 50000 || depth > 64)
			throw createInternalError("Approval JSON exceeds limits");
		if (value === null) return "null";
		if (typeof value === "string" || typeof value === "boolean")
			return JSON.stringify(value);
		if (typeof value === "number" && Number.isFinite(value))
			return JSON.stringify(value);
		if (typeof value !== "object" || seen.has(value))
			throw createInternalError("Approval plan must be strict JSON");
		const array = Array.isArray(value);
		const prototype = Object.getPrototypeOf(value);
		if (
			(array && prototype !== Array.prototype) ||
			(!array && prototype !== Object.prototype && prototype !== null)
		)
			throw createInternalError("Approval plan must be strict JSON");
		seen.add(value);
		const keys = Reflect.ownKeys(value);
		if (keys.some((key) => typeof key !== "string"))
			throw createInternalError("Approval plan must be strict JSON");
		const entries = keys.filter(
			(key) => !(array && key === "length"),
		) as string[];
		for (const key of entries) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor))
				throw createInternalError("Approval plan must be strict JSON");
		}
		let result: string;
		if (array) {
			if (
				entries.length !== value.length ||
				entries.some((key, i) => key !== String(i))
			)
				throw createInternalError("Approval plan must be strict JSON");
			result = `[${value.map((entry) => encode(entry, depth + 1)).join(",")}]`;
		} else {
			const object = value as Record<string, unknown>;
			result = `{${entries
				.sort()
				.map(
					(key) => `${JSON.stringify(key)}:${encode(object[key], depth + 1)}`,
				)
				.join(",")}}`;
		}
		seen.delete(value);
		if (Buffer.byteLength(result) > MAX_PLAN_BYTES)
			throw createInternalError("Approval JSON exceeds limits");
		return result;
	}
	const encoded = encode(plan, 0);
	if (Buffer.byteLength(encoded) > MAX_PLAN_BYTES)
		throw createInternalError("Approval JSON exceeds limits");
	return encoded;
}

/** SHA-256 over UTF-8 strict JSON with lexicographically sorted object keys. */
export function hashPlan(plan: unknown): string {
	return createHash("sha256").update(canonicalPlan(plan)).digest("hex");
}
