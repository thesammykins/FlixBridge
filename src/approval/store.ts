import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { createInternalError } from "../core.js";
import { canonicalPlan, hashPlan } from "./hash.js";
import { lockDirectory, processAlive } from "./lock.js";
import { redact } from "./redact.js";

export type ApprovalState =
	| "pending"
	| "approved"
	| "rejected"
	| "cancelled"
	| "invalidated"
	| "expired"
	| "claimed"
	| "completed"
	| "partial"
	| "uncertain"
	| "failed";
export interface ApprovalRecord {
	id: string;
	planHash: string;
	plan: unknown;
	state: ApprovalState;
	createdAt: number;
	expiresAt: number;
	actor?: string;
	decidedAt?: number;
	claimedAt?: number;
	finishedAt?: number;
	result?: unknown;
}
export interface ApprovalDecision {
	requestId: string;
	planHash: string;
	actor: string;
	decision: "yes" | "no";
	nonce: string;
}
interface StoredRecord extends ApprovalRecord {
	owner?: { pid: number; instance: string };
}
interface Ledger {
	version: 1;
	records: StoredRecord[];
	nonces: string[];
}
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const approvalDecisionSchema = z
	.object({
		requestId: z.string().regex(UUID),
		planHash: z.string().regex(/^[0-9a-f]{64}$/),
		actor: z.string().min(1).max(128),
		decision: z.enum(["yes", "no"]),
		nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
	})
	.strict();
const time = z.number().int().safe().nonnegative();
const recordSchema = z
	.object({
		id: z.string().regex(UUID),
		planHash: z.string().regex(/^[0-9a-f]{64}$/),
		plan: z.unknown(),
		state: z.enum([
			"pending",
			"approved",
			"rejected",
			"cancelled",
			"invalidated",
			"expired",
			"claimed",
			"completed",
			"partial",
			"uncertain",
			"failed",
		]),
		createdAt: time,
		expiresAt: time,
		actor: z.string().min(1).max(128).optional(),
		decidedAt: time.optional(),
		claimedAt: time.optional(),
		finishedAt: time.optional(),
		result: z.unknown().optional(),
		owner: z
			.object({
				pid: z.number().int().positive(),
				instance: z.string().regex(UUID),
			})
			.strict()
			.optional(),
	})
	.strict()
	.refine(
		(record) =>
			record.expiresAt > record.createdAt &&
			(![
				"approved",
				"rejected",
				"claimed",
				"completed",
				"partial",
				"failed",
			].includes(record.state) ||
				(!!record.actor && record.decidedAt !== undefined)) &&
			(record.state !== "claimed" || !!record.owner),
	);
const ledgerSchema = z
	.object({
		version: z.literal(1),
		records: z.array(recordSchema),
		nonces: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
	})
	.strict();

function fail(message: string): never {
	throw createInternalError(message);
}
function code(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String(error.code)
		: undefined;
}

export class ApprovalStore {
	readonly #directory: string;
	readonly #instance = randomUUID();
	constructor(directory = process.env.FLIX_BRIDGE_STATE_DIR) {
		if (!directory || !isAbsolute(directory))
			fail("Explicit absolute approval state directory required");
		this.#directory = resolve(directory);
	}

	async #prepare(): Promise<void> {
		try {
			await mkdir(this.#directory, { mode: 0o700 });
		} catch (error) {
			if (code(error) !== "EEXIST") throw error;
		}
		const info = await lstat(this.#directory);
		if (
			!info.isDirectory() ||
			info.isSymbolicLink() ||
			(info.mode & 0o777) !== 0o700 ||
			info.uid !== process.getuid?.() ||
			(await realpath(this.#directory)) !== this.#directory
		)
			fail(
				"Approval state directory must be private and owned without symlinks",
			);
		// Flush the directory entry even if another process won its creation race.
		const parent = await open(
			dirname(this.#directory),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			await parent.sync();
		} finally {
			await parent.close();
		}
	}

	async #read(): Promise<Ledger> {
		let file: Awaited<ReturnType<typeof open>>;
		try {
			file = await open(
				join(this.#directory, "approvals.json"),
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
		} catch (error) {
			if (code(error) === "ENOENT")
				return { version: 1, records: [], nonces: [] };
			throw error;
		}
		try {
			const info = await file.stat();
			if (
				!info.isFile() ||
				info.nlink !== 1 ||
				(info.mode & 0o777) !== 0o600 ||
				info.uid !== process.getuid?.() ||
				info.size > MAX_STATE_BYTES
			)
				fail("Approval state file is not private or exceeds limits");
			const ledger = ledgerSchema.parse(
				JSON.parse(await file.readFile("utf8")),
			) as Ledger;
			if (
				new Set(ledger.records.map((record) => record.id)).size !==
					ledger.records.length ||
				new Set(ledger.nonces).size !== ledger.nonces.length ||
				ledger.records.some(
					(record) => hashPlan(record.plan) !== record.planHash,
				)
			)
				fail("Invalid approval state");
			return ledger;
		} finally {
			await file.close();
		}
	}

	async #write(ledger: Ledger): Promise<void> {
		const data = JSON.stringify(ledger);
		if (Buffer.byteLength(data) > MAX_STATE_BYTES)
			fail("Approval state exceeds limits");
		const temporary = join(this.#directory, `.write-${randomUUID()}`);
		try {
			const file = await open(
				temporary,
				constants.O_WRONLY |
					constants.O_CREAT |
					constants.O_EXCL |
					constants.O_NOFOLLOW,
				0o600,
			);
			try {
				await file.writeFile(data);
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temporary, join(this.#directory, "approvals.json"));
			const directory = await open(this.#directory, constants.O_RDONLY);
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} finally {
			await unlink(temporary).catch(() => {});
		}
	}

	async #transaction(
		action: (ledger: Ledger) => StoredRecord,
	): Promise<ApprovalRecord> {
		let release: (() => Promise<void>) | undefined;
		try {
			await this.#prepare();
			// ponytail: one host-wide ledger lock; shard only if proposal throughput requires it.
			release = await lockDirectory(this.#directory);
			const ledger = await this.#read();
			for (const entry of ledger.records) {
				if (
					["pending", "approved"].includes(entry.state) &&
					Date.now() >= entry.expiresAt
				)
					entry.state = "expired";
				if (
					entry.state === "claimed" &&
					(!entry.owner || !processAlive(entry.owner.pid))
				) {
					entry.state = "uncertain";
					entry.finishedAt = Date.now();
				}
			}
			let record: StoredRecord | undefined;
			let failure: unknown;
			try {
				record = action(ledger);
			} catch (error) {
				failure = error;
			}
			await this.#write(ledger);
			if (failure) throw failure;
			if (!record) fail("Approval operation failed");
			const { owner: _owner, ...result } = record;
			return redact(structuredClone(result)) as ApprovalRecord;
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"kind" in error &&
				error.kind === "internal"
			)
				throw error;
			return fail("Approval storage operation failed");
		} finally {
			try {
				await release?.();
			} catch {
				fail("Approval storage lock release failed");
			}
		}
	}

	#find(ledger: Ledger, id: string): StoredRecord {
		if (!UUID.test(id)) fail("Invalid approval request ID");
		const record = ledger.records.find((entry) => entry.id === id);
		if (!record) fail("Approval request not found");
		return record;
	}

	async create(
		plan: unknown,
		opts: { ttlMs?: number } = {},
	): Promise<ApprovalRecord & { newRequest: boolean }> {
		const serialized = canonicalPlan(plan);
		const snapshot: unknown = JSON.parse(serialized);
		if (canonicalPlan(redact(snapshot)) !== serialized)
			fail("Approval plans must not contain credentials or credential URLs");
		const planHash = hashPlan(snapshot);
		const ttl = opts.ttlMs ?? 30 * 60 * 1000;
		if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 24 * 60 * 60 * 1000)
			fail("Invalid approval expiry");
		let newRequest = false;
		const result = await this.#transaction((ledger) => {
			const existing = ledger.records.find(
				(entry) =>
					entry.planHash === planHash &&
					["pending", "approved", "claimed", "rejected", "uncertain"].includes(
						entry.state,
					),
			);
			if (existing) return existing;
			newRequest = true;
			const now = Date.now();
			const record: ApprovalRecord = {
				id: randomUUID(),
				planHash,
				plan: snapshot,
				state: "pending",
				createdAt: now,
				expiresAt: now + ttl,
			};
			ledger.records.push(record);
			return record;
		});
		return { ...result, newRequest };
	}

	async get(id: string): Promise<ApprovalRecord> {
		return this.#transaction((ledger) => this.#find(ledger, id));
	}

	/** Trusted bridge only: authentication must be established before calling. Never expose through MCP. */
	async decide(
		value: ApprovalDecision,
		authenticated = false,
	): Promise<ApprovalRecord> {
		const parsed = approvalDecisionSchema.safeParse(value);
		if (!parsed.success) fail("Invalid approval decision");
		const input = parsed.data;
		const actors = (process.env.FLIX_BRIDGE_APPROVAL_ACTORS ?? "")
			.split(",")
			.map((actor) => actor.trim())
			.filter(Boolean);
		if (authenticated !== true || !actors.includes(input.actor))
			fail("Authenticated allowlisted human actor required");
		return this.#transaction((ledger) => {
			const record = this.#find(ledger, input.requestId);
			const nonce = hashPlan(input.nonce);
			if (
				record.state !== "pending" ||
				record.planHash !== input.planHash ||
				Date.now() >= record.expiresAt ||
				ledger.nonces.includes(nonce)
			)
				fail("Approval decision expired, mismatched or already used");
			ledger.nonces.push(nonce);
			record.state = input.decision === "yes" ? "approved" : "rejected";
			record.actor = input.actor;
			record.decidedAt = Date.now();
			return record;
		});
	}

	async claim(id: string, plan: unknown): Promise<ApprovalRecord> {
		const planHash = hashPlan(plan);
		return this.#transaction((ledger) => {
			const record = this.#find(ledger, id);
			if (record.state === "approved" && record.planHash !== planHash) {
				record.state = "invalidated";
				fail("Approval plan drifted; consent invalidated");
			}
			if (
				record.state !== "approved" ||
				!record.actor ||
				Date.now() >= record.expiresAt
			)
				fail("Approval is not executable");
			record.state = "claimed";
			record.owner = { pid: process.pid, instance: this.#instance };
			record.claimedAt = Date.now();
			return record;
		});
	}

	async finish(
		id: string,
		status: "completed" | "partial" | "uncertain" | "failed",
		result?: unknown,
	): Promise<ApprovalRecord> {
		if (!["completed", "partial", "uncertain", "failed"].includes(status))
			fail("Invalid approval outcome");
		const snapshot =
			result === undefined
				? undefined
				: redact(JSON.parse(canonicalPlan(result)));
		return this.#transaction((ledger) => {
			const record = this.#find(ledger, id);
			if (
				record.state !== "claimed" ||
				record.owner?.pid !== process.pid ||
				record.owner.instance !== this.#instance
			)
				fail("Approval is not claimed by this executor");
			record.state = status;
			record.finishedAt = Date.now();
			if (snapshot !== undefined) record.result = snapshot;
			return record;
		});
	}

	async cancel(id: string): Promise<ApprovalRecord> {
		return this.#transaction((ledger) => {
			const record = this.#find(ledger, id);
			if (!["pending", "approved"].includes(record.state))
				fail("Approval cannot be cancelled in current state");
			record.state = "cancelled";
			return record;
		});
	}
}
