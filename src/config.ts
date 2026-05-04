// Centralized slug-based environment configuration loader for Flix-Bridge
// Replaces all file-based and JSON mapping configuration with pure environment variable discovery.
// Supported sources (in precedence order):
// 1) Slug-based discovery: SONARR_<SLUG>_* or FLIX_BRIDGE_SONARR_<SLUG>_*
// 2) Single-instance fallbacks: SONARR_URL or FLIX_BRIDGE_SONARR_URL (with API keys)

import type { ServiceConfig } from "./services/base.js";
import type { SabnzbdConfig } from "./services/downloaders/sabnzbd.js";

export interface SlugConfig {
	url?: string;
	apiKey?: string;
	name?: string;
}

export async function loadConfigFromEnvOnly(): Promise<{
	services: Record<string, ServiceConfig>;
	downloaders?: Record<string, SabnzbdConfig>;
}> {
	const slugConfig = buildConfigFromSlugBasedEnvVars();
	const fallbackConfig = buildConfigFromSingleInstanceFallbacks();
	const services = {
		...(fallbackConfig?.services ?? {}),
		...(slugConfig?.services ?? {}),
	};
	const downloaders = {
		...(fallbackConfig?.downloaders ?? {}),
		...(slugConfig?.downloaders ?? {}),
	};

	if (Object.keys(services).length > 0) {
		const result: {
			services: Record<string, ServiceConfig>;
			downloaders?: Record<string, SabnzbdConfig>;
		} = { services };
		if (Object.keys(downloaders).length > 0) {
			result.downloaders = downloaders;
		}
		return result;
	}

	throw new Error(
		"No services configured. Provide slug-based env vars (SONARR_<SLUG>_URL/API_KEY or FLIX_BRIDGE_SONARR_<SLUG>_URL/KEY) or single-instance fallbacks (SONARR_URL/API_KEY, RADARR_URL/API_KEY).",
	);
}

function buildConfigFromSlugBasedEnvVars() {
	const services: Record<string, ServiceConfig> = {};
	const downloaders: Record<string, SabnzbdConfig> = {};

	// Discover Sonarr instances
	const sonarrSlugs = discoverServiceSlugs("SONARR");
	for (const [slug, config] of Object.entries(sonarrSlugs)) {
		if (config.url && config.apiKey) {
			const serviceName = config.name || deriveServiceName("sonarr", slug);
			services[serviceName] = {
				baseUrl: normalizeUrl(config.url),
				apiKey: config.apiKey,
			};
			logDebug(`Discovered Sonarr service: ${serviceName} (slug: ${slug})`);
		}
	}

	// Discover Radarr instances
	const radarrSlugs = discoverServiceSlugs("RADARR");
	for (const [slug, config] of Object.entries(radarrSlugs)) {
		if (config.url && config.apiKey) {
			const serviceName = config.name || deriveServiceName("radarr", slug);
			services[serviceName] = {
				baseUrl: normalizeUrl(config.url),
				apiKey: config.apiKey,
			};
			logDebug(`Discovered Radarr service: ${serviceName} (slug: ${slug})`);
		}
	}

	// Discover SABnzbd instances
	const sabnzbdSlugs = discoverServiceSlugs("SABNZBD");
	for (const [slug, config] of Object.entries(sabnzbdSlugs)) {
		if (config.url && config.apiKey) {
			const downloaderName =
				config.name || deriveDownloaderName("sabnzbd", slug);
			downloaders[downloaderName] = {
				baseUrl: normalizeUrl(config.url),
				apiKey: config.apiKey,
				name: config.name || downloaderName,
			};
			logDebug(
				`Discovered SABnzbd downloader: ${downloaderName} (slug: ${slug})`,
			);
		}
	}

	// Validate naming constraints for current registry
	for (const serviceName of Object.keys(services)) {
		if (
			!serviceName.toLowerCase().includes("sonarr") &&
			!serviceName.toLowerCase().includes("radarr")
		) {
			console.error(
				`Warning: Service name '${serviceName}' does not contain 'sonarr' or 'radarr'. Current registry requires this for type detection.`,
			);
		}
	}

	logDebug(`Total discovered services: ${Object.keys(services).length}`);
	logDebug(`Total discovered downloaders: ${Object.keys(downloaders).length}`);

	if (
		Object.keys(services).length === 0 &&
		Object.keys(downloaders).length === 0
	) {
		return null;
	}

	const result: {
		services: Record<string, ServiceConfig>;
		downloaders?: Record<string, SabnzbdConfig>;
	} = { services };
	if (Object.keys(downloaders).length > 0) {
		result.downloaders = downloaders;
	}
	return result;
}

function discoverServiceSlugs(
	serviceType: "SONARR" | "RADARR" | "SABNZBD",
): Record<string, SlugConfig> {
	const slugs: Record<string, SlugConfig> = {};
	const pattern = new RegExp(
		`^(?:FLIX_BRIDGE_)?${serviceType}_([A-Z0-9_]+?)_(URL|API_KEY|KEY|NAME)$`,
	);

	for (const [envKey, envValue] of Object.entries(process.env)) {
		const match = envKey.match(pattern);
		if (match && envValue && match[1] && match[2]) {
			const slug = match[1];
			const field = match[2];

			if (!slugs[slug]) {
				slugs[slug] = {};
			}

			switch (field) {
				case "URL":
					slugs[slug].url = envValue;
					break;
				case "API_KEY":
				case "KEY":
					slugs[slug].apiKey = envValue;
					break;
				case "NAME":
					slugs[slug].name = envValue;
					break;
			}
		}
	}

	return slugs;
}

function deriveServiceName(
	serviceType: "sonarr" | "radarr",
	slug: string,
): string {
	const normalizedSlug = slug.toLowerCase().replace(/_/g, "-");
	return `${serviceType}-${normalizedSlug}`;
}

function deriveDownloaderName(downloaderType: "sabnzbd", slug: string): string {
	const normalizedSlug = slug.toLowerCase().replace(/_/g, "-");
	return `${downloaderType}-${normalizedSlug}`;
}

function buildConfigFromSingleInstanceFallbacks() {
	const services: Record<string, ServiceConfig> = {};
	const downloaders: Record<string, SabnzbdConfig> = {};

	// Single Sonarr instance
	const sonarrUrl =
		process.env.SONARR_URL ?? process.env.FLIX_BRIDGE_SONARR_URL;
	const sonarrApiKey =
		process.env.SONARR_API_KEY ??
		process.env.SONARR_KEY ??
		process.env.FLIX_BRIDGE_SONARR_API_KEY ??
		process.env.FLIX_BRIDGE_SONARR_KEY;
	if (sonarrUrl && sonarrApiKey) {
		services.sonarr = {
			baseUrl: normalizeUrl(sonarrUrl),
			apiKey: sonarrApiKey,
		};
		logDebug("Discovered single Sonarr instance from fallback env vars");
	}

	// Single Radarr instance
	const radarrUrl =
		process.env.RADARR_URL ?? process.env.FLIX_BRIDGE_RADARR_URL;
	const radarrApiKey =
		process.env.RADARR_API_KEY ??
		process.env.RADARR_KEY ??
		process.env.FLIX_BRIDGE_RADARR_API_KEY ??
		process.env.FLIX_BRIDGE_RADARR_KEY;
	if (radarrUrl && radarrApiKey) {
		services.radarr = {
			baseUrl: normalizeUrl(radarrUrl),
			apiKey: radarrApiKey,
		};
		logDebug("Discovered single Radarr instance from fallback env vars");
	}

	// Single SABnzbd instance
	const sabnzbdUrl =
		process.env.SABNZBD_URL ?? process.env.FLIX_BRIDGE_SABNZBD_URL;
	const sabnzbdApiKey =
		process.env.SABNZBD_API_KEY ??
		process.env.SABNZBD_KEY ??
		process.env.FLIX_BRIDGE_SABNZBD_API_KEY ??
		process.env.FLIX_BRIDGE_SABNZBD_KEY;
	if (sabnzbdUrl && sabnzbdApiKey) {
		downloaders.sabnzbd = {
			baseUrl: normalizeUrl(sabnzbdUrl),
			apiKey: sabnzbdApiKey,
			name:
				process.env.SABNZBD_NAME ??
				process.env.FLIX_BRIDGE_SABNZBD_NAME ??
				"SABnzbd",
		};
		logDebug("Discovered single SABnzbd instance from fallback env vars");
	}

	if (
		Object.keys(services).length === 0 &&
		Object.keys(downloaders).length === 0
	) {
		return null;
	}

	const result: {
		services: Record<string, ServiceConfig>;
		downloaders?: Record<string, SabnzbdConfig>;
	} = { services };
	if (Object.keys(downloaders).length > 0) {
		result.downloaders = downloaders;
	}
	return result;
}

function normalizeUrl(url: string): string {
	return url.replace(/\/$/, "");
}

function logDebug(message: string): void {
	if (process.env.FLIX_BRIDGE_DEBUG === "1") {
		console.error(`[Config] ${message}`);
	}
}
