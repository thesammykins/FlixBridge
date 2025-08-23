// Centralized slug-based environment configuration loader for Flix-Bridge
// Replaces all file-based and JSON mapping configuration with pure environment variable discovery.
// Supported sources (in precedence order):
// 1) Slug-based discovery: SONARR_<SLUG>_*, RADARR_<SLUG>_*, SABNZBD_<SLUG>_*
// 2) Single-instance fallbacks: SONARR_URL, RADARR_URL, SABNZBD_URL (with API keys)

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
	if (slugConfig && Object.keys(slugConfig.services).length > 0) {
		return slugConfig;
	}

	const fallbackConfig = buildConfigFromSingleInstanceFallbacks();
	if (fallbackConfig && Object.keys(fallbackConfig.services).length > 0) {
		return fallbackConfig;
	}

	throw new Error(
		"No services configured. Provide slug-based env vars (SONARR_<SLUG>_URL/API_KEY, RADARR_<SLUG>_URL/API_KEY) or single-instance fallbacks (SONARR_URL/API_KEY, RADARR_URL/API_KEY).",
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
			console.warn(
				`Warning: Service name '${serviceName}' does not contain 'sonarr' or 'radarr'. Current registry requires this for type detection.`,
			);
		}
	}

	logDebug(`Total discovered services: ${Object.keys(services).length}`);
	logDebug(`Total discovered downloaders: ${Object.keys(downloaders).length}`);

	if (Object.keys(services).length === 0) return null;

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
		`^${serviceType}_([A-Z0-9_]+)_(URL|API_KEY|NAME)$`,
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
	if (process.env.SONARR_URL && process.env.SONARR_API_KEY) {
		services.sonarr = {
			baseUrl: normalizeUrl(process.env.SONARR_URL),
			apiKey: process.env.SONARR_API_KEY,
		};
		logDebug("Discovered single Sonarr instance from fallback env vars");
	}

	// Single Radarr instance
	if (process.env.RADARR_URL && process.env.RADARR_API_KEY) {
		services.radarr = {
			baseUrl: normalizeUrl(process.env.RADARR_URL),
			apiKey: process.env.RADARR_API_KEY,
		};
		logDebug("Discovered single Radarr instance from fallback env vars");
	}

	// Single SABnzbd instance
	if (process.env.SABNZBD_URL && process.env.SABNZBD_API_KEY) {
		downloaders.sabnzbd = {
			baseUrl: normalizeUrl(process.env.SABNZBD_URL),
			apiKey: process.env.SABNZBD_API_KEY,
			name: "SABnzbd",
		};
		logDebug("Discovered single SABnzbd instance from fallback env vars");
	}

	if (Object.keys(services).length === 0) return null;

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
		console.debug(`[Config] ${message}`);
	}
}
