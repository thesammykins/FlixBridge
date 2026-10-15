import { AsyncLocalStorage } from "node:async_hooks";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";

// Thread cancellation through existing adapters without changing every operation signature.
export const requestSignal = new AsyncLocalStorage<AbortSignal>();

export class ToolAdmission {
	private active = 0;
	private waiting: Array<{ start: () => void }> = [];

	async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
		signal.throwIfAborted();
		if (this.active < 4) this.active++;
		else {
			if (this.waiting.length >= 16)
				throw new ProtocolError(
					ProtocolErrorCode.InvalidParams,
					"Server busy: tool queue is full; try again later",
				);
			await new Promise<void>((resolve, reject) => {
				const entry = {
					start: () => {
						signal.removeEventListener("abort", cancel);
						resolve();
					},
				};
				const cancel = () => {
					const index = this.waiting.indexOf(entry);
					if (index !== -1) this.waiting.splice(index, 1);
					reject(signal.reason);
				};
				signal.addEventListener("abort", cancel, { once: true });
				this.waiting.push(entry);
			});
		}
		try {
			signal.throwIfAborted();
			return await requestSignal.run(signal, operation);
		} finally {
			const next = this.waiting.shift();
			if (next) next.start();
			else this.active--;
		}
	}
}
