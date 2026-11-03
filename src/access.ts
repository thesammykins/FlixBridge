// Keep transport credentials out of enumerable provider configuration and plans.
type AccessPair = Readonly<{ id: string; secret: string }>;
const credentials = new WeakMap<object, AccessPair & { origin: string }>();
const globalPrefix = "FLIX_BRIDGE";

function pairFromEnv(prefix: string): AccessPair | undefined {
	const canonical = prefix.replace(
		/^FLIX_BRIDGE_(?=(?:SONARR|RADARR|SABNZBD|PLEX|JELLYFIN)(?:_|$))/,
		"",
	);
	const aliases =
		canonical === globalPrefix
			? [globalPrefix]
			: [canonical, `FLIX_BRIDGE_${canonical}`];
	const pairs: AccessPair[] = [];
	for (const alias of aliases) {
		const id = process.env[`${alias}_CF_ACCESS_CLIENT_ID`];
		const secret = process.env[`${alias}_CF_ACCESS_CLIENT_SECRET`];
		if (id === undefined && secret === undefined) continue;
		if (
			!id ||
			!secret ||
			!/^[\x21-\x7e]+$/.test(id) ||
			!/^[\x21-\x7e]+$/.test(secret)
		)
			throw new Error(
				"Cloudflare Access requires a complete nonempty, header-safe client ID/secret pair in each configured alias",
			);
		pairs.push({ id, secret });
	}
	if (
		pairs.some(
			(pair) => pair.id !== pairs[0]?.id || pair.secret !== pairs[0]?.secret,
		)
	)
		throw new Error("Conflicting Cloudflare Access credential aliases");
	return pairs[0];
}

/** Validate even unused/masked scopes before discovery can discard empty fields. */
export function validateAccessEnv(): boolean {
	pairFromEnv(globalPrefix);
	let configured = false;
	for (const key of Object.keys(process.env)) {
		if (/^FLIX_BRIDGE_CF_ACCESS_CLIENT_(?:ID|SECRET)$/.test(key))
			configured = true;
		const match = key.match(
			/^(?:FLIX_BRIDGE_)?((?:SONARR|RADARR|SABNZBD|PLEX|JELLYFIN)(?:_[A-Z0-9_]+)?)_CF_ACCESS_CLIENT_(?:ID|SECRET)$/,
		);
		if (match?.[1]) {
			pairFromEnv(match[1]);
			configured = true;
		}
	}
	return configured;
}

export function bindAccess<T extends { baseUrl: string }>(
	config: T,
	prefix: string,
): T {
	// Validate global configuration even when a complete instance override exists.
	const global = pairFromEnv(globalPrefix);
	const pair = pairFromEnv(prefix) ?? global;
	if (!pair) {
		credentials.delete(config);
		return config;
	}
	let url: URL;
	try {
		url = new URL(config.baseUrl);
	} catch {
		throw new Error("Cloudflare Access requires a valid HTTPS upstream URL");
	}
	if (url.protocol !== "https:" || url.username || url.password)
		throw new Error("Cloudflare Access requires HTTPS without URL userinfo");
	credentials.set(config, { ...pair, origin: url.origin });
	return config;
}

export function inheritAccess(source: object, target: object): void {
	const pair = credentials.get(source);
	if (pair) credentials.set(target, pair);
	else credentials.delete(target);
}

export function accessHeaders(
	upstream: object | undefined,
	url: string,
): Record<string, string> {
	const pair = upstream && credentials.get(upstream);
	if (!pair) return {};
	const target = new URL(url);
	if (target.origin !== pair.origin || target.username || target.password)
		throw new Error("Cloudflare Access configured origin mismatch");
	return {
		"CF-Access-Client-Id": pair.id,
		"CF-Access-Client-Secret": pair.secret,
	};
}

/** Scrub parsed data, not JSON bytes: opaque credentials may contain JSON syntax. */
export function redactAccess<T>(value: T, upstream?: object): T {
	const pair = upstream && credentials.get(upstream);
	const values = Object.entries(process.env)
		.filter(
			([key, entry]) => /_CF_ACCESS_CLIENT_(?:ID|SECRET)$/.test(key) && entry,
		)
		.map(([, entry]) => entry as string);
	if (pair) values.push(pair.id, pair.secret);
	if (values.length === 0) return value;
	const forms = [
		...new Set(
			values.flatMap((entry) => {
				const encoded = [encodeURIComponent(entry), encodeURI(entry)];
				return [
					entry,
					JSON.stringify(entry).slice(1, -1),
					...encoded,
					...encoded.map((text) =>
						text.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase()),
					),
				];
			}),
		),
	].sort((a, b) => b.length - a.length);
	function clean(entry: unknown): unknown {
		if (typeof entry === "string") {
			for (const secret of forms)
				entry = (entry as string).split(secret).join("[redacted]");
			return entry;
		}
		if (Array.isArray(entry)) return entry.map(clean);
		if (entry && typeof entry === "object")
			return Object.fromEntries(
				Object.entries(entry).map(([key, item]) => [
					clean(key),
					/^cfaccessclient(?:id|secret)$/i.test(key.replace(/[^a-z]/gi, ""))
						? "[redacted]"
						: clean(item),
				]),
			);
		return entry;
	}
	return clean(value) as T;
}
