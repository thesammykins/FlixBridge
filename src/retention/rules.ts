import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { createInternalError } from "../core.js";
import {
	evaluationTimeSchema,
	type RetentionRule,
	ruleSchema,
} from "./schema.js";

const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nameSchema = z.string().trim().min(1).max(200);
const revisionSchema = z
	.object({
		id: idSchema,
		version: versionSchema,
		name: nameSchema,
		enabled: z.boolean(),
		rule: ruleSchema,
		createdAt: evaluationTimeSchema,
	})
	.strict();
export type RuleRevision = z.infer<typeof revisionSchema>;
const attemptSchema = z
	.object({
		ruleId: idSchema,
		version: versionSchema,
		evaluationTime: evaluationTimeSchema,
		status: z.enum(["reserved", "completed", "failed"]),
	})
	.strict();
const stateSchema = z
	.object({
		schemaVersion: z.literal(1),
		revisions: z.array(revisionSchema),
		attempts: z.array(attemptSchema),
	})
	.strict()
	.superRefine((state, ctx) => {
		const versions = new Map<string, number>();
		for (const revision of state.revisions) {
			if (revision.version !== (versions.get(revision.id) ?? 0) + 1)
				ctx.addIssue({ code: "custom", message: "Invalid revision sequence" });
			versions.set(revision.id, revision.version);
		}
		const attempts = new Set<string>();
		for (const attempt of state.attempts) {
			const key = JSON.stringify([
				attempt.ruleId,
				attempt.version,
				attempt.evaluationTime,
			]);
			if (
				attempts.has(key) ||
				!state.revisions.some(
					(r) => r.id === attempt.ruleId && r.version === attempt.version,
				)
			)
				ctx.addIssue({ code: "custom", message: "Invalid scheduler attempt" });
			attempts.add(key);
		}
	});
type State = z.infer<typeof stateSchema>;
export interface StateOptions {
	stateDir?: string;
}
const MAX_STATE_BYTES = 16 * 1024 * 1024;

async function directory(options: StateOptions): Promise<string> {
	const root = options.stateDir ?? process.env.FLIX_BRIDGE_STATE_DIR;
	if (!root || !isAbsolute(root))
		throw createInternalError(
			"Explicit absolute FLIX_BRIDGE_STATE_DIR required",
		);
	const path = join(root, "retention");
	await mkdir(path, { recursive: true, mode: 0o700 });
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink())
		throw createInternalError("Retention state must be a real directory");
	return path;
}
async function readState(path: string): Promise<State> {
	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(
			join(path, "rules.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { schemaVersion: 1, revisions: [], attempts: [] };
		throw error;
	}
	try {
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > MAX_STATE_BYTES)
			throw createInternalError("Invalid or oversized retention state");
		return stateSchema.parse(JSON.parse(await file.readFile("utf8")));
	} finally {
		await file.close();
	}
}
async function writeState(path: string, state: State): Promise<void> {
	const text = JSON.stringify(stateSchema.parse(state));
	if (Buffer.byteLength(text) > MAX_STATE_BYTES)
		throw createInternalError(
			"Retention state limit reached; archive state offline",
		);
	const temporary = join(path, `.rules-${randomUUID()}.tmp`);
	try {
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(text);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, join(path, "rules.json"));
		const dir = await open(path, "r");
		try {
			await dir.sync();
		} finally {
			await dir.close();
		}
	} finally {
		await rm(temporary, { force: true });
	}
}
async function mutate<T>(
	options: StateOptions,
	action: (state: State) => T,
): Promise<T> {
	const path = await directory(options);
	const lock = join(path, ".lock");
	// ponytail: one local-filesystem directory lock; partition only if rule writes become a bottleneck.
	for (let attempt = 0; ; attempt++) {
		try {
			await mkdir(lock, { mode: 0o700 });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (attempt >= 100)
				throw createInternalError(
					"Retention state locked; inspect crashed writers before removing retention/.lock",
				);
			await delay(50);
		}
	}
	try {
		const state = await readState(path);
		const result = action(state);
		await writeState(path, state);
		return result;
	} finally {
		await rm(lock, { recursive: true });
	}
}
function latest(state: State, id: string, version?: number): RuleRevision {
	const revision = [...state.revisions]
		.reverse()
		.find(
			(r) => r.id === id && (version === undefined || r.version === version),
		);
	if (!revision) throw createInternalError("Retention rule/version not found");
	return revision;
}
export async function listRules(
	options: StateOptions = {},
): Promise<RuleRevision[]> {
	const state = await readState(await directory(options));
	const revisions = new Map<string, RuleRevision>();
	for (const revision of state.revisions) revisions.set(revision.id, revision);
	return [...revisions.values()].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
}
export async function getRule(
	id: string,
	version?: number,
	options: StateOptions = {},
): Promise<RuleRevision> {
	idSchema.parse(id);
	if (version !== undefined) versionSchema.parse(version);
	return latest(await readState(await directory(options)), id, version);
}
export const createRuleSchema = z
	.object({
		id: idSchema,
		name: nameSchema,
		rule: ruleSchema,
		evaluationTime: evaluationTimeSchema,
	})
	.strict();
export async function createRule(
	input: z.input<typeof createRuleSchema>,
	options: StateOptions = {},
): Promise<RuleRevision> {
	const parsed = createRuleSchema.parse(input);
	return mutate(options, (state) => {
		if (state.revisions.some((r) => r.id === parsed.id))
			throw createInternalError("Retention rule already exists");
		const revision = {
			id: parsed.id,
			name: parsed.name,
			rule: parsed.rule,
			version: 1,
			enabled: false,
			createdAt: parsed.evaluationTime,
		};
		state.revisions.push(revision);
		return revision;
	});
}
export const reviseRuleSchema = z
	.object({
		id: idSchema,
		expectedVersion: versionSchema,
		name: nameSchema.optional(),
		rule: ruleSchema.optional(),
		enabled: z.boolean().optional(),
		evaluationTime: evaluationTimeSchema,
	})
	.strict()
	.refine(
		(r) =>
			r.name !== undefined || r.rule !== undefined || r.enabled !== undefined,
		"Revision requires a change",
	);
export async function reviseRule(
	input: z.input<typeof reviseRuleSchema>,
	options: StateOptions = {},
): Promise<RuleRevision> {
	const parsed = reviseRuleSchema.parse(input);
	return mutate(options, (state) => {
		const previous = latest(state, parsed.id);
		if (previous.version !== parsed.expectedVersion)
			throw createInternalError("Retention rule version conflict");
		if (Date.parse(parsed.evaluationTime) < Date.parse(previous.createdAt))
			throw createInternalError("Revision time precedes current revision");
		const revision = {
			...previous,
			name: parsed.name ?? previous.name,
			rule: parsed.rule ?? previous.rule,
			enabled: parsed.enabled ?? previous.enabled,
			version: previous.version + 1,
			createdAt: parsed.evaluationTime,
		};
		state.revisions.push(revision);
		return revision;
	});
}
export const evaluateRuleSchema = z
	.object({
		id: idSchema,
		version: versionSchema.optional(),
		evaluationTime: evaluationTimeSchema,
	})
	.strict();
export interface EvaluationContext {
	ruleId: string;
	version: number;
	evaluationTime: string;
}
export type RuleEvaluator<T> = (
	rule: RetentionRule,
	context: EvaluationContext,
) => Promise<T>;
export async function evaluateRule<T>(
	input: z.input<typeof evaluateRuleSchema>,
	evaluate: RuleEvaluator<T>,
	options: StateOptions = {},
) {
	const parsed = evaluateRuleSchema.parse(input);
	const revision = await getRule(parsed.id, parsed.version, options);
	if (Date.parse(parsed.evaluationTime) < Date.parse(revision.createdAt))
		throw createInternalError("Evaluation time precedes rule revision");
	const context = {
		ruleId: revision.id,
		version: revision.version,
		evaluationTime: parsed.evaluationTime,
	};
	return { ...context, result: await evaluate(revision.rule, context) };
}
export const runDueRulesSchema = z
	.object({ evaluationTime: evaluationTimeSchema })
	.strict();
export async function runDueRules<T>(
	input: z.input<typeof runDueRulesSchema>,
	evaluate: RuleEvaluator<T>,
	options: StateOptions = {},
) {
	const { evaluationTime } = runDueRulesSchema.parse(input);
	const now = Date.parse(evaluationTime);
	const due = await mutate(options, (state) => {
		const current = new Map<string, RuleRevision>();
		for (const revision of state.revisions) current.set(revision.id, revision);
		return [...current.values()]
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
			.filter((revision) => {
				if (
					!revision.enabled ||
					!revision.rule.intervalHours ||
					now < Date.parse(revision.createdAt)
				)
					return false;
				const outstanding = state.attempts.find(
					(attempt) =>
						attempt.ruleId === revision.id && attempt.status === "reserved",
				);
				if (outstanding) {
					if (
						now - Date.parse(outstanding.evaluationTime) >=
						revision.rule.intervalHours * 3600000
					)
						throw createInternalError(
							"Retention rule has an outstanding evaluation; inspect the reserved attempt before resuming, never replay deletion",
						);
					return false;
				}
				const times = state.attempts
					.filter((a) => a.ruleId === revision.id)
					.map((a) => Date.parse(a.evaluationTime));
				if (
					times.length &&
					now - Math.max(...times) < revision.rule.intervalHours * 3600000
				)
					return false;
				state.attempts.push({
					ruleId: revision.id,
					version: revision.version,
					evaluationTime,
					status: "reserved",
				});
				return true;
			});
	});
	const results: Array<
		EvaluationContext &
			({ status: "completed"; result: T } | { status: "failed"; error: string })
	> = [];
	for (const revision of due) {
		const context = {
			ruleId: revision.id,
			version: revision.version,
			evaluationTime,
		};
		let outcome: (typeof results)[number];
		try {
			outcome = {
				...context,
				status: "completed",
				result: await evaluate(revision.rule, context),
			};
		} catch {
			outcome = {
				...context,
				status: "failed",
				error:
					"Retention evaluation failed; inspect evaluator without disclosing credentials",
			};
		}
		await mutate(options, (state) => {
			const attempt = state.attempts.find(
				(a) =>
					a.ruleId === context.ruleId &&
					a.version === context.version &&
					a.evaluationTime === evaluationTime,
			);
			if (attempt?.status !== "reserved")
				throw createInternalError("Scheduler reservation changed");
			attempt.status = outcome.status;
		});
		results.push(outcome);
	}
	return results;
}
