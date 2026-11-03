// Test-only fault injection at the product dispatch boundary, never a live service.
import { ArrMcpServer } from "../../dist/index.js";

const app = new ArrMcpServer();
app.executeTool = async (name) => {
	if (name === "system_status") throw new Error("private-marker");
	if (name === "list_services")
		return {
			ok: false,
			error: {
				kind: "internal",
				message: "private-marker",
				raw: { token: "private-marker" },
			},
			data: {
				details: [
					{
						error: {
							status: 500,
							message: "private-marker",
							cause: "private-marker",
						},
					},
				],
			},
		};
	return { ok: "invalid-envelope" };
};
await app.run();
