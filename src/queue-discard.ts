import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import { hashPlan } from "./approval/hash.js";
import { type ApprovalRecord, ApprovalStore } from "./approval/store.js";
import { immutablePreview, instanceBindings } from "./approval-plans.js";
import { loadConfigFromEnvOnly } from "./config.js";
import { createInternalError, isTrustedError, serializeError } from "./core.js";
import { arrList, arrReader } from "./library/arr.js";
import { withQueueDiscardAuthority } from "./removal-authority.js";
import type {
	ManualImportPreviewData,
	QueueItem,
	RemovalPreparationData,
	RemovalResultData,
	ServiceImplementation,
} from "./services/base.js";
import { serviceRegistry } from "./services/registry.js";

function absolutePath(value: string): boolean {
	return (
		value.startsWith("/") &&
		value !== "/" &&
		!value.includes("\\") &&
		![...value].some((character) => character.charCodeAt(0) < 32) &&
		posix.normalize(value) === value &&
		!value.split("/").some((part) => part === "." || part === "..")
	);
}
const policySchema = z
	.object({
		version: z.literal(1),
		services: z
			.array(z.string().regex(/^[a-z][a-z0-9_-]{0,255}$/))
			.min(1)
			.max(100),
		downloadRoots: z
			.array(z.string().max(4096).refine(absolutePath))
			.min(1)
			.max(100),
		maxItems: z.number().int().min(1).max(1000),
		allowDirectExecution: z.boolean().optional(),
	})
	.strict()
	.refine(
		(p) =>
			new Set(p.services).size === p.services.length &&
			new Set(p.downloadRoots).size === p.downloadRoots.length,
	);
export type QueueDiscardPolicy = z.infer<typeof policySchema>;

export function parseQueueDiscardPolicy(
	value = process.env.FLIX_BRIDGE_QUEUE_DISCARD_POLICY,
): QueueDiscardPolicy | undefined {
	try {
		const result = policySchema.safeParse(
			value === undefined ? undefined : JSON.parse(value),
		);
		return result.success ? result.data : undefined;
	} catch {
		return undefined;
	}
}

export function queueDiscardInputAllowed(
	input: Record<string, unknown>,
): boolean {
	const policy = parseQueueDiscardPolicy();
	return (
		!!policy &&
		(input.bypassApproval !== true || policy.allowDirectExecution === true) &&
		typeof input.service === "string" &&
		policy.services.includes(input.service) &&
		input.target === "queue" &&
		input.dryRun === false &&
		input.manualImport === false &&
		input.allowManualRemoval === true &&
		input.removeFromClient === true &&
		input.deleteFiles === false &&
		input.blocklist === false &&
		input.addImportExclusion === false &&
		input.removeFromDownloader === false &&
		![
			"approvalId",
			"downloader",
			"users",
			"retentionRuleId",
			"retentionRuleVersion",
			"seasonNumbers",
			"episodeIds",
		].some((key) => input[key] !== undefined) &&
		Array.isArray(input.ids) &&
		input.ids.length > 0 &&
		input.ids.length <= policy.maxItems &&
		new Set(input.ids.map(String)).size === input.ids.length
	);
}
export function directQueueDiscardInputAllowed(
	input: Record<string, unknown>,
): boolean {
	return (
		input.bypassApproval === true &&
		input.confirmationToken === undefined &&
		parseQueueDiscardPolicy()?.allowDirectExecution === true &&
		queueDiscardInputAllowed({ ...input, dryRun: false })
	);
}
function fail(message: string, cause?: unknown): never {
	if (isTrustedError(cause)) throw cause;
	throw createInternalError(`Queue discard policy: ${message}`);
}
function snapshot<T>(value: T): T {
	return immutablePreview(value) as T;
}
function under(path: string, root: string): boolean {
	return path.replace(/\/$/, "").startsWith(`${root.replace(/\/$/, "")}/`);
}
function sharesDownload(row: QueueItem, other: QueueItem): boolean {
	return (
		(!!row.downloadId &&
			row.downloadId.toLowerCase() === other.downloadId?.toLowerCase()) ||
		(!!row.outputPath &&
			!!other.outputPath &&
			(row.outputPath.replace(/\/$/, "") ===
				other.outputPath.replace(/\/$/, "") ||
				under(row.outputPath, other.outputPath) ||
				under(other.outputPath, row.outputPath)))
	);
}
function eligible(row: QueueItem): boolean {
	const status = row.status.toLowerCase();
	const state = row.trackedDownloadState?.toLowerCase();
	const tracking = row.trackedDownloadStatus?.toLowerCase();
	if (!["warning", "error"].includes(tracking ?? "")) return false;
	return (
		(["failed", "rejected"].includes(status) &&
			["failed", "downloadfailed", "importfailed", "importblocked"].includes(
				state ?? "",
			)) ||
		(status === "completed" &&
			row.size !== undefined &&
			row.size > 0 &&
			row.sizeleft === 0 &&
			["importblocked", "importpending", "importfailed"].includes(state ?? ""))
	);
}
export interface QueueDiscardEvidence {
	policy: QueueDiscardPolicy;
	instances: Awaited<ReturnType<typeof instanceBindings>>;
	preparation: RemovalPreparationData;
	rows: QueueItem[];
	protectedLibraryPaths: string[];
	imports: ManualImportPreviewData;
}

/** Original preview plus fresh authoritative reads; diagnostic prose is never authority. */
export async function prepareQueueDiscard(
	service: ServiceImplementation,
	input: Record<string, unknown>,
	original: RemovalPreparationData,
): Promise<QueueDiscardEvidence> {
	if (!queueDiscardInputAllowed({ ...input, dryRun: false }))
		fail("explicit bounded discard options required");
	const policy = parseQueueDiscardPolicy();
	if (
		!policy ||
		service.serviceName !== input.service ||
		original.kind !== "queue" ||
		original.service !== input.service ||
		original.missingIds.length
	)
		fail("scope mismatch");
	const ids = (input.ids as Array<string | number>).map(Number);
	if (
		ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
		new Set(ids).size !== ids.length ||
		original.requestedIds.length !== ids.length ||
		original.targets.length !== ids.length ||
		!ids.every((id) => original.requestedIds.includes(id))
	)
		fail("exact selected IDs required");
	const fresh = await service.prepareRemoval("queue", ids);
	if (
		!fresh.ok ||
		!fresh.data ||
		hashPlan(snapshot(fresh.data)) !== hashPlan(snapshot(original))
	)
		fail("original preparation changed", fresh.error);
	const queue = await service.queueList({
		page: 1,
		pageSize: 1000,
		includeUnknown: true,
	});
	if (
		!queue.ok ||
		!queue.data ||
		queue.data.truncated ||
		queue.data.total !== queue.data.items.length ||
		new Set(queue.data.items.map((row) => row.id)).size !==
			queue.data.items.length
	)
		fail("complete unambiguous queue required", queue.error);
	const rows = queue.data.items.filter((row) => ids.includes(row.id));
	if (rows.length !== ids.length) fail("selected queue IDs missing");
	const protectedLibraryPaths: string[] = [];
	const configs = (await loadConfigFromEnvOnly()).services;
	for (const configured of serviceRegistry.getAll()) {
		const roots = await configured.rootFolderList();
		if (
			!roots.ok ||
			!roots.data?.folders.length ||
			roots.data.total !== roots.data.folders.length ||
			roots.data.folders.some((root) => !absolutePath(root.path))
		)
			fail("authoritative library roots required", roots.error);
		protectedLibraryPaths.push(...roots.data.folders.map((root) => root.path));
		const config = configs[configured.serviceName];
		if (!config) fail("configured library instance binding missing");
		const titles = await arrList(
			await arrReader(configured.serviceName, config),
			configured.id === "sonarr" ? "series" : "movie",
			z.object({
				id: z.number().int().positive().safe(),
				path: z.string().refine(absolutePath),
			}),
		);
		protectedLibraryPaths.push(...titles.map((title) => title.path));
		if (configured.serviceName !== service.serviceName) {
			const other = await configured.queueList({
				page: 1,
				pageSize: 1000,
				includeUnknown: true,
			});
			if (
				!other.ok ||
				!other.data ||
				other.data.truncated ||
				other.data.total !== other.data.items.length ||
				new Set(other.data.items.map((row) => row.id)).size !==
					other.data.items.length
			)
				fail("other configured queue coverage unknown", other.error);
			if (
				rows.some((row) =>
					other.data?.items.some((sibling) => sharesDownload(row, sibling)),
				)
			)
				fail("physical download also belongs to another instance");
		}
	}
	if (!protectedLibraryPaths.length)
		fail("authoritative library roots required");
	protectedLibraryPaths.sort();
	for (const row of rows) {
		const path = row.outputPath;
		if (
			!eligible(row) ||
			!row.downloadId?.trim() ||
			!row.downloadClient?.trim() ||
			!path ||
			!absolutePath(path) ||
			!policy.downloadRoots.some((root) => under(path, root)) ||
			protectedLibraryPaths.some(
				(root) =>
					path.replace(/\/$/, "") === root.replace(/\/$/, "") ||
					under(path, root) ||
					under(root, path),
			)
		)
			fail("healthy, unknown or uncontained download protected");
		const siblings = queue.data.items.filter((other) =>
			sharesDownload(row, other),
		);
		if (
			siblings.some(
				(other) =>
					!ids.includes(other.id) ||
					!eligible(other) ||
					other.downloadClient !== row.downloadClient ||
					other.downloadId !== row.downloadId,
			)
		)
			fail(
				"all physical download siblings must be explicitly eligible and selected",
			);
	}
	const imports = await service.previewManualImport(ids);
	if (
		!imports.ok ||
		!imports.data ||
		imports.data.missingIds.length ||
		imports.data.items.length !== ids.length ||
		new Set(imports.data.items.map((item) => item.id)).size !== ids.length ||
		imports.data.items.some(
			(item) => !ids.includes(item.id) || item.safeToImport,
		)
	)
		fail(
			"manual import inspection unknown or safe import available",
			imports.error,
		);
	return snapshot({
		policy,
		instances: await instanceBindings(),
		preparation: original,
		rows: rows
			.map(({ estimatedCompletionTime: _eta, ...row }) => row)
			.sort((a, b) => a.id - b.id),
		protectedLibraryPaths,
		imports: imports.data,
	});
}

export async function executeQueueDiscard(
	service: ServiceImplementation,
	input: Record<string, unknown>,
	original: RemovalPreparationData,
	evidence?: QueueDiscardEvidence,
) {
	if (!evidence)
		fail(
			"original preview has no eligible policy evidence; human authority required",
		);
	const fresh = await prepareQueueDiscard(service, input, original);
	if (hashPlan(fresh) !== hashPlan(evidence))
		fail("policy, configuration or original evidence changed");
	const config = await loadConfigFromEnvOnly();
	const c = config.services[service.serviceName];
	if (!c) fail("service no longer configured");
	const store = new ApprovalStore(undefined, "queue-discard");
	// Conservatively share reservations across aliases until client identity is proven.
	const jobKey = (id: string) =>
		hashPlan(["queue-discard-job-v1", id.toLowerCase()]);
	const executionId = randomUUID();
	const manifest = snapshot({
		authority: "queue-discard-policy",
		executionId,
		policyFingerprint: hashPlan(evidence.policy),
		input: { ...input, confirmationToken: undefined },
		policy: evidence.policy,
		instances: evidence.instances,
		evidenceHash: hashPlan(evidence),
		protectedLibraryPathsHash: hashPlan(evidence.protectedLibraryPaths),
	});
	const claims = new Map<
		string,
		{ record: ApprovalRecord; rows: QueueItem[]; finished: boolean }
	>();
	const attempted = new Set<string>();
	const failures: unknown[] = [];
	let claimAttempts = 0;
	const claimState = () =>
		claims.size !== claimAttempts
			? "unknown"
			: claims.size
				? "consumed"
				: "none";
	let result: RemovalResultData | undefined;
	let queueReadback: { complete: boolean; absentIds: number[] } | undefined;
	let queueRemovalVerified = false;
	try {
		const allowed = original.targets.map((target) => {
			const url = new URL(
				`${c.baseUrl.replace(/\/$/, "")}/api/v3/queue/${target.id}`,
			);
			return { origin: url.origin, path: url.pathname };
		});
		const execution = await withQueueDiscardAuthority(
			{
				kind: "queue-discard-policy",
				executionId,
				planHash: hashPlan(manifest),
				allowed,
				onFailure: (error) => {
					failures.push(error);
				},
				beforeRemoval: async (url) => {
					const row = evidence.rows.find(
						(item) => String(item.id) === url.pathname.split("/").at(-1),
					);
					if (!row?.downloadId) fail("DELETE outside original evidence");
					const key = jobKey(row.downloadId);
					if (attempted.has(key))
						fail("physical download already attempted; no payload retry");
					const jobRows = evidence.rows.filter(
						(item) => item.downloadId === row.downloadId,
					);
					const ids = jobRows.map((item) => item.id);
					const preparation = {
						...original,
						requestedIds: ids,
						targets: original.targets.filter((item) => ids.includes(item.id)),
					};
					const current = await prepareQueueDiscard(
						service,
						{ ...input, ids },
						preparation,
					);
					const importEvidence = evidence.imports;
					const expected = {
						...evidence,
						preparation,
						rows: jobRows,
						imports: {
							...importEvidence,
							requestedIds: ids,
							items: importEvidence.items.filter((item) =>
								ids.includes(item.id),
							),
							summary: { total: ids.length, safe: 0, unsafe: ids.length },
						},
					};
					if (hashPlan(current) !== hashPlan(snapshot(expected)))
						fail("original job evidence changed before DELETE");
					// Reserve only this physical job immediately before its first write.
					// Unattempted independent jobs must not inherit another job's uncertainty.
					claimAttempts++;
					const record = await store.claimPolicy(
						snapshot({
							manifest,
							job: key,
							preparation,
							rows: jobRows,
							imports: current.imports,
						}),
						[key],
					);
					claims.set(key, { record, rows: jobRows, finished: false });
					attempted.add(key);
				},
			},
			() =>
				service.executeRemoval(original, {
					deleteFiles: false,
					addImportExclusion: false,
					removeFromClient: true,
					blocklist: false,
					attemptManualImport: false,
					queueTimeoutMs:
						typeof input.queueTimeoutMs === "number"
							? input.queueTimeoutMs
							: 60000,
				}),
		);
		result = execution.data;
		const readback = await service.queueList({
			page: 1,
			pageSize: 1000,
			includeUnknown: true,
		});
		if (!readback.ok)
			failures.push(
				serializeError(
					readback.error ??
						createInternalError("Queue discard final readback failed"),
				),
			);
		const complete =
			readback.ok &&
			!!readback.data &&
			!readback.data.truncated &&
			readback.data.total === readback.data.items.length &&
			new Set(readback.data.items.map((row) => row.id)).size ===
				readback.data.items.length;
		const absent = evidence.rows.filter(
			(row) =>
				complete &&
				!readback.data?.items.some(
					(current) => sharesDownload(row, current) || row.id === current.id,
				),
		);
		queueReadback = { complete, absentIds: absent.map((row) => row.id) };
		const verified =
			execution.ok &&
			!!execution.data &&
			execution.data.failed === 0 &&
			execution.data.skipped === 0 &&
			execution.data.removed === original.targets.length &&
			absent.length === original.targets.length;
		queueRemovalVerified = verified;
		const state = verified
			? "completed"
			: absent.length
				? "partial"
				: "uncertain";
		const data = {
			mode: "execute",
			service: service.serviceName,
			target: "queue",
			authority: "queue-discard-policy",
			executionId,
			policyClaimIds: [...claims.values()].map(({ record }) => record.id),
			policyClaimState: claimState(),
			failureCauses: failures.map(serializeError),
			executionState: state,
			result: execution.data,
			queueReadback,
			queueRemovalRequested: true,
			queueRemovalVerified: verified,
			sourceCleanupRequested: true,
			sourceCleanupVerified: false,
			filesDeletionRequested: false,
			filesDeletionVerified: false,
			removeFromDownloader: false,
		};
		for (const claim of claims.values()) {
			const absentCount = claim.rows.filter((row) =>
				absent.some((item) => item.id === row.id),
			).length;
			const items = execution.data?.details.filter((item) =>
				claim.rows.some((row) => row.id === item.id),
			);
			const successful =
				absentCount === claim.rows.length &&
				items?.length === claim.rows.length &&
				items.every((item) => item.status === "removed");
			await store.finish(
				claim.record.id,
				successful ? "completed" : absentCount ? "partial" : "uncertain",
				snapshot(data),
			);
			claim.finished = true;
		}
		return {
			ok: verified,
			data,
			...(!verified && {
				error: serializeError(
					execution.error ??
						failures[0] ??
						readback.error ??
						createInternalError(
							claimState() === "consumed"
								? "Queue discard incomplete; policy claims consumed, reconcile without replay"
								: claimState() === "unknown"
									? "Queue discard incomplete; claim persistence unknown, reconcile without replay"
									: "Queue discard not executed; no policy claim established",
						),
				),
			}),
		};
	} catch (error) {
		failures.push(serializeError(error));
		let finalizationVerified = true;
		for (const claim of claims.values()) {
			if (claim.finished) continue;
			try {
				await store.finish(claim.record.id, "uncertain");
			} catch (finishError) {
				// Never release a consumed reservation when recording its outcome fails.
				failures.push(serializeError(finishError));
				finalizationVerified = false;
			}
		}
		return {
			ok: false,
			data: {
				authority: "queue-discard-policy",
				executionId,
				policyClaimIds: [...claims.values()].map(({ record }) => record.id),
				policyClaimState: claimState(),
				failureCauses: failures.map(serializeError),
				policyResultFinalizationVerified: finalizationVerified,
				result,
				queueReadback,
				executionState: "uncertain",
				queueRemovalRequested: true,
				queueRemovalVerified,
				sourceCleanupRequested: true,
				sourceCleanupVerified: false,
				filesDeletionRequested: false,
				filesDeletionVerified: false,
			},
			error: serializeError(error),
		};
	}
}
