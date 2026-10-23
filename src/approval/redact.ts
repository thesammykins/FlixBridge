const CREDENTIAL_KEY =
	/(?:apikey|password|passwd|secret|token|authorization|cookie|credential|privatekey)/i;

/** Defense in depth, not a general DLP system. Plans must contain references, not credentials. */
export function redact(value: unknown): unknown {
	const secrets = Object.entries(process.env)
		.filter(
			([key, entry]) =>
				/(?:SECRET|TOKEN|API_?KEY|PASSWORD|CREDENTIAL|AUTHORIZATION|COOKIE)/i.test(
					key,
				) && entry,
		)
		.map(([, entry]) => entry as string);
	function clean(entry: unknown): unknown {
		if (typeof entry === "string") {
			let text = entry;
			for (const secret of secrets)
				text = text.split(secret).join("[redacted]");
			return text.replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
				try {
					const url = new URL(raw);
					if (!url.username && !url.password && !url.search && !url.hash)
						return raw;
					url.username = "";
					url.password = "";
					url.search = "";
					url.hash = "";
					return url.toString();
				} catch {
					return "[redacted-url]";
				}
			});
		}
		if (Array.isArray(entry)) return entry.map(clean);
		if (entry && typeof entry === "object")
			return Object.fromEntries(
				Object.entries(entry).map(([key, item]) => [
					clean(key) as string,
					CREDENTIAL_KEY.test(key.replace(/[^a-z]/gi, ""))
						? "[redacted]"
						: clean(item),
				]),
			);
		return entry;
	}
	return clean(value);
}
