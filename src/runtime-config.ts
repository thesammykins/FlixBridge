import { validateAccessEnv } from "./access.js";
import { loadConfigFromEnvOnly } from "./config.js";
import { mediaServers } from "./library/intelligence.js";

export async function loadRuntimeConfig(
	allowEmpty = false,
): Promise<Awaited<ReturnType<typeof loadConfigFromEnvOnly>>> {
	// Access settings must fail before serving even when ARR would mask media config.
	if (validateAccessEnv()) mediaServers();
	try {
		return await loadConfigFromEnvOnly();
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("No services configured.") &&
			(allowEmpty || mediaServers().length > 0)
		)
			return { services: {} };
		throw error;
	}
}
