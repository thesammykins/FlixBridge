/**
 * Test assertion helpers
 * Provides clear, descriptive assertions for test validation
 */

import assert from "node:assert";

export function assertOk(result: { ok: boolean }): void {
	assert.strictEqual(result.ok, true, "Expected result.ok to be true");
}

export function assertNotOk(result: { ok: boolean }): void {
	assert.strictEqual(result.ok, false, "Expected result.ok to be false");
}

export function assertHasData<T>(result: {
	ok: boolean;
	data?: T;
}): asserts result is { ok: true; data: T } {
	assert.strictEqual(result.ok, true, "Expected result.ok to be true");
	assert.ok(result.data, "Expected result.data to be defined");
}

export function assertHasError(result: {
	ok: boolean;
	error?: unknown;
}): asserts result is { ok: false; error: unknown } {
	assert.strictEqual(result.ok, false, "Expected result.ok to be false");
	assert.ok(result.error, "Expected result.error to be defined");
}

export function assertServiceName(
	data: { service: string },
	expectedName: string,
): void {
	assert.strictEqual(
		data.service,
		expectedName,
		`Expected service to be "${expectedName}"`,
	);
}

export function assertMediaKind(
	data: { mediaKind: "series" | "movie" },
	expectedKind: "series" | "movie",
): void {
	assert.strictEqual(
		data.mediaKind,
		expectedKind,
		`Expected mediaKind to be "${expectedKind}"`,
	);
}

export function assertArrayLength<T>(
	arr: T[],
	expectedLength: number,
	context?: string,
): void {
	const message = context
		? `Expected ${context} to have length ${expectedLength}, got ${arr.length}`
		: `Expected array length ${expectedLength}, got ${arr.length}`;
	assert.strictEqual(arr.length, expectedLength, message);
}

export function assertArrayNotEmpty<T>(arr: T[], context?: string): void {
	const message = context
		? `Expected ${context} to not be empty`
		: "Expected array to not be empty";
	assert.ok(arr.length > 0, message);
}

export function assertArrayIncludes<T>(
	arr: T[],
	value: T,
	context?: string,
): void {
	const message = context
		? `Expected ${context} to include ${value}`
		: `Expected array to include ${value}`;
	assert.ok(arr.includes(value), message);
}

export function assertHasProperty<T extends object>(
	obj: T,
	prop: keyof T,
	context?: string,
): void {
	const message = context
		? `Expected ${context} to have property "${String(prop)}"`
		: `Expected object to have property "${String(prop)}"`;
	assert.ok(prop in obj, message);
}

export function assertPropertyEquals<T extends object, K extends keyof T>(
	obj: T,
	prop: K,
	expectedValue: T[K],
	context?: string,
): void {
	const message = context
		? `Expected ${context}.${String(prop)} to equal ${expectedValue}`
		: `Expected ${String(prop)} to equal ${expectedValue}`;
	assert.strictEqual(obj[prop], expectedValue, message);
}

export function assertThrows(
	fn: () => void,
	expectedError?: string | RegExp,
): void {
	assert.throws(fn, expectedError);
}

export async function assertRejects(
	fn: () => Promise<unknown>,
	expectedError?: string | RegExp,
): Promise<void> {
	await assert.rejects(fn, expectedError);
}

export function assertQueueItem(item: {
	id: number;
	title: string;
	status: string;
	mediaKind?: "series" | "movie";
}): void {
	assert.ok(
		typeof item.id === "number",
		"Expected queue item to have numeric id",
	);
	assert.ok(
		typeof item.title === "string",
		"Expected queue item to have string title",
	);
	assert.ok(
		typeof item.status === "string",
		"Expected queue item to have string status",
	);
	if (item.mediaKind) {
		assert.ok(
			["series", "movie"].includes(item.mediaKind),
			`Expected mediaKind to be "series" or "movie", got ${item.mediaKind}`,
		);
	}
}

export function assertValidForeignId(
	id: unknown,
	mediaKind: "series" | "movie",
): void {
	assert.ok(
		typeof id === "number" && id > 0,
		`Expected valid ${mediaKind === "series" ? "TVDB" : "TMDB"} ID (positive number), got ${id}`,
	);
}

export function assertValidQualityProfile(profile: {
	id: number;
	name: string;
	upgradeAllowed?: boolean;
}): void {
	assert.ok(
		typeof profile.id === "number",
		"Expected quality profile to have numeric id",
	);
	assert.ok(
		typeof profile.name === "string" && profile.name.length > 0,
		"Expected quality profile to have non-empty name",
	);
}

export function assertValidRootFolder(folder: {
	id: number;
	path: string;
	freeSpaceBytes?: number;
}): void {
	assert.ok(
		typeof folder.id === "number",
		"Expected root folder to have numeric id",
	);
	assert.ok(
		typeof folder.path === "string" && folder.path.length > 0,
		"Expected root folder to have non-empty path",
	);
	if (folder.freeSpaceBytes !== undefined) {
		assert.ok(
			typeof folder.freeSpaceBytes === "number" && folder.freeSpaceBytes >= 0,
			"Expected freeSpaceBytes to be non-negative number",
		);
	}
}

export function assertStatusMessagesStructure(
	statusMessages?: Array<{ title?: string; messages?: string[] }>,
): void {
	if (!statusMessages) return;

	assert.ok(
		Array.isArray(statusMessages),
		"Expected statusMessages to be an array",
	);

	for (const msg of statusMessages) {
		assert.ok(
			typeof msg === "object",
			"Expected statusMessage to be an object",
		);
		if (msg.title !== undefined) {
			assert.ok(
				typeof msg.title === "string",
				"Expected statusMessage.title to be a string",
			);
		}
		if (msg.messages !== undefined) {
			assert.ok(
				Array.isArray(msg.messages),
				"Expected statusMessage.messages to be an array",
			);
			for (const m of msg.messages) {
				assert.ok(
					typeof m === "string",
					"Expected each message in statusMessages.messages to be a string",
				);
			}
		}
	}
}
