#!/usr/bin/env node
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createApprovalBridge } from "./approval/bridge.js";
import { ApprovalStore } from "./approval/store.js";
import { createInternalError, serializeError } from "./core.js";
import { ArrMcpServer } from "./index.js";
import {
	getWatchEvidence,
	loadLibrarySnapshot,
	mediaServers,
} from "./library/intelligence.js";
import { recommendationArguments } from "./retention-requests.js";
import { evaluateRule, getRule, runDueRules } from "./retention/rules.js";
import { evaluationTimeSchema } from "./retention/schema.js";
import { cleanupCandidates } from "./retention/tools.js";
import { loadRuntimeConfig } from "./runtime-config.js";

const help = `FlixBridge retention — opt-in local operation
Commands:
  bridge --port <1..65535>                  Authenticated loopback callback listener
  evaluate --rule <id> [--version <n>]      Evaluate a versioned rule
  run-due                                 Evaluate enabled due rules once; exits
  execute --request <uuid>                 Execute one already human-approved plan
Options:
  --at <RFC3339>                          Evaluation time (default now)
  --request-approval                      Request human decisions for eligible proposals
State/credentials are configured only through the documented environment.
No command grants human approval or installs a schedule.
`;
export async function runCli(
	argv: string[] = process.argv.slice(2),
): Promise<void> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		strict: true,
		options: {
			help: { type: "boolean", short: "h" },
			port: { type: "string" },
			rule: { type: "string" },
			version: { type: "string" },
			at: { type: "string" },
			request: { type: "string" },
			"request-approval": { type: "boolean" },
		},
	});
	if (values.help) {
		process.stdout.write(help);
		return;
	}
	const command = positionals[0];
	if (
		positionals.length !== 1 ||
		!["bridge", "evaluate", "run-due", "execute"].includes(command ?? "")
	)
		throw createInternalError(
			"Unknown or invalid retention command; use --help",
		);
	const allowed: Record<string, string[]> = {
		bridge: ["port"],
		evaluate: ["rule", "version", "at", "request-approval"],
		"run-due": ["at", "request-approval"],
		execute: ["request"],
	};
	if (Object.keys(values).some((key) => !allowed[command ?? ""]?.includes(key)))
		throw createInternalError("Invalid option for this command");
	if (command === "bridge") {
		if (!values.port || !/^[1-9]\d*$/.test(values.port))
			throw createInternalError("Explicit valid bridge port required");
		const port = z.number().int().min(1).max(65535).parse(Number(values.port));
		const server = createApprovalBridge(new ApprovalStore());
		server.listen(port, "127.0.0.1");
		await once(server, "listening");
		process.stdout.write(
			`${JSON.stringify({ listening: true, host: "127.0.0.1", port })}\n`,
		);
		const stop = () => server.close();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		await once(server, "close");
		return;
	}
	const server = new ArrMcpServer();
	const config = await loadRuntimeConfig(command === "run-due");
	server.initialize(config);
	if (command === "execute") {
		const id = z.string().uuid().parse(values.request);
		const record = await new ApprovalStore().get(id);
		const plan = z
			.object({
				tool: z.enum([
					"remove_content",
					"remediate_reported_issue",
					"update_monitoring",
				]),
				arguments: z.record(z.unknown()),
			})
			.passthrough()
			.parse(record.plan);
		const result = await server.callTool(plan.tool, {
			...plan.arguments,
			dryRun: false,
			approvalId: id,
		});
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (!z.object({ ok: z.boolean() }).parse(result).ok) process.exitCode = 1;
		return;
	}
	const evaluationTime = evaluationTimeSchema.parse(
		values.at ?? new Date().toISOString(),
	);
	const evaluate = async (
		rule: Parameters<typeof cleanupCandidates>[0]["rule"],
		context: { ruleId: string; version: number; evaluationTime: string },
	) => {
		const result = await cleanupCandidates(
			{ rule, evaluationTime: context.evaluationTime },
			{ loadLibrarySnapshot, getWatchEvidence },
		);
		const requests = [];
		if (values["request-approval"]) {
			const revision = await getRule(context.ruleId, context.version);
			for (const candidate of result.recommendations) {
				requests.push(
					await server.callTool("request_approval", {
						tool: "remove_content",
						arguments: recommendationArguments(candidate, revision),
					}),
				);
			}
		}
		return { ...result, requests };
	};
	const result =
		command === "run-due"
			? await runDueRules({ evaluationTime }, evaluate)
			: await evaluateRule(
					{
						id: z.string().min(1).parse(values.rule),
						version: values.version
							? z.number().int().positive().safe().parse(Number(values.version))
							: undefined,
						evaluationTime,
					},
					evaluate,
				);
	process.stdout.write(`${JSON.stringify({ ok: true, data: result })}\n`);
	if (
		Array.isArray(result) &&
		result.some((entry) => entry.status === "failed")
	)
		process.exitCode = 1;
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	runCli().catch((error) => {
		process.stderr.write(
			`${JSON.stringify({ ok: false, error: serializeError(error) })}\n`,
		);
		process.exitCode = 1;
	});
}
