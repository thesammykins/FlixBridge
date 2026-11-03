import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createInternalError } from "../core.js";

function code(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String(error.code)
		: undefined;
}

/** PID reuse/EPERM is considered alive: uncertainty must block, never steal. */
export function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return code(error) !== "ESRCH";
	}
}

async function deadLock(path: string): Promise<boolean> {
	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		if (code(error) === "ENOENT") return false;
		throw error;
	}
	try {
		const info = await file.stat();
		if (
			!info.isFile() ||
			info.size > 1024 ||
			(info.mode & 0o777) !== 0o600 ||
			info.uid !== process.getuid?.()
		)
			throw createInternalError("Invalid approval lock");
		const owner = JSON.parse(await file.readFile("utf8"));
		if (
			!Number.isSafeInteger(owner.pid) ||
			owner.pid <= 0 ||
			owner.host !== hostname()
		)
			throw createInternalError("Approval lock owner cannot be verified");
		return !processAlive(owner.pid);
	} finally {
		await file.close();
	}
}

/** Local POSIX filesystem only. A hard link publishes a completely written owner atomically. */
export async function lockDirectory(
	directory: string,
): Promise<() => Promise<void>> {
	const candidate = join(directory, `.owner-${randomUUID()}`);
	const lock = join(directory, ".lock");
	const recovery = join(directory, ".lock-recovery");
	const file = await open(
		candidate,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await file.writeFile(
			JSON.stringify({ pid: process.pid, host: hostname() }),
		);
		await file.sync();
	} finally {
		await file.close();
	}
	const deadline = Date.now() + 5000;
	try {
		for (;;) {
			try {
				await link(candidate, lock);
				return async () => {
					await unlink(lock);
				};
			} catch (error) {
				if (code(error) !== "EEXIST") throw error;
			}
			if (await deadLock(lock)) {
				let acquired = false;
				try {
					await mkdir(recovery, { mode: 0o700 });
					acquired = true;
				} catch (error) {
					if (code(error) !== "EEXIST") throw error;
				}
				if (acquired) {
					try {
						if (await deadLock(lock)) await unlink(lock);
					} finally {
						await rmdir(recovery);
					}
				}
			}
			if (Date.now() >= deadline)
				throw createInternalError(
					"Approval state locked; recovery may require operator inspection",
				);
			await setTimeout(10);
		}
	} finally {
		await unlink(candidate).catch(() => {});
	}
}
