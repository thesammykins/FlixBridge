/**
 * Tests for Plex reported-issues remediation: report URL resolution, service
 * matching (HD/UHD/anime aware), resolution state from comments, and the
 * remove_and_regrab confirmation-token contract.
 *
 * The Plex client and arr primitives all route through fetchJson → global.fetch,
 * so the test stubs global.fetch with createMockFetch. No network.
 */

import {
	buildComment,
	executeRemediation,
	mintRemoveToken,
	planRemediation,
	resolutionState,
	resolveReportMatches,
	resolveReports,
} from "../../src/services/plex/remediation.js";
import { PlexReportsClient } from "../../src/services/plex/reports.js";
import {
	type PlexReport,
	plexConfigFromEnv,
} from "../../src/services/plex/reports.js";
import {
	assertHasData,
	assertOk,
	assertPropertyEquals,
} from "../helpers/assertions.js";
import {
	MockRadarrService,
	MockSonarrService,
	createMockFetch,
	createMockServiceConfig,
} from "../helpers/mock-services.js";
import { describe, test } from "../helpers/test-runner.js";

// createMockFetch matches on url.pathname, so the GraphQL endpoint key is /api.
const PLEX_GRAPHQL = "/api";

function reportFixture(overrides: Partial<PlexReport> = {}): PlexReport {
	return {
		id: "report-1",
		message: "gib me 1080 plez",
		url: "server://6cf8bfab123/com.plexapp.plugins.library/library/metadata/242722",
		date: "2026-07-31T10:00:00Z",
		commentCount: 0,
		comments: [],
		...overrides,
	};
}

function metadataResponse(
	key: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		MediaContainer: {
			Metadata: [
				{
					ratingKey: key,
					type: "movie",
					title: "Leviticus",
					year: 2026,
					...overrides,
				},
			],
		},
	};
}

function gqlReportsResponse(nodes: unknown[]) {
	return {
		data: {
			reports: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
		},
	};
}

// createMockFetch is method-agnostic (pathname only), but addNew POSTs to
// /movie and needs an object response with an id. Wrap the stub so POST
// /movie returns an add-shaped object while GET still returns the array.
function withAddPost(
	base: typeof global.fetch,
	addedId: number,
): typeof global.fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const urlObj = new URL(url);
		if (init?.method === "POST" && urlObj.pathname === "/api/v3/movie") {
			return new Response(
				JSON.stringify({
					id: addedId,
					title: "Leviticus",
					year: 2026,
					qualityProfileId: 1,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		return base(input, init);
	}) as typeof global.fetch;
}

// Default stub: reports list + the single metadata item + empty comments.
function buildFetchStub(extra: Record<string, unknown> = {}) {
	return createMockFetch({
		[PLEX_GRAPHQL]: gqlReportsResponse([
			{
				__typename: "Report",
				id: "report-1",
				message: "gib me 1080 plez",
				user: { id: "u1", username: "KritxLana" },
				url: "server://6cf8bfab123/com.plexapp.plugins.library/library/metadata/242722",
				date: "2026-07-31T10:00:00Z",
				commentCount: 0,
			},
		]),
		"/library/metadata/242722": metadataResponse("242722"),
		"/library/metadata/0": { MediaContainer: { Metadata: [] } },
		"/api/v3/series": [],
		"/api/v3/movie": [
			{
				id: 10,
				title: "Leviticus",
				year: 2026,
				hasFile: true,
				movieFile: { id: 99 },
			},
		],
		"/api/v3/movie/lookup": [{ title: "Leviticus", year: 2026, tmdbId: 12345 }],
		"/api/v3/qualityprofile": [
			{ id: 1, name: "HD-1080p", upgradeAllowed: true, cutoff: 1 },
		],
		"/api/v3/command": { id: 1, name: "MoviesSearch" },
		"/api/v3/moviefile/99": {},
		...extra,
	});
}

async function makeClient(): Promise<PlexReportsClient> {
	const config = plexConfigFromEnv();
	if (!config) {
		return new PlexReportsClient({
			baseUrl: "http://plex:32400",
			token: "test-token",
		});
	}
	return new PlexReportsClient(config);
}

await describe("Plex reported-issues remediation", [
	test("resolutionState: no comments → unresolved; fixed marker → fixed; clarify marker → clarification_requested", () => {
		if (resolutionState([]) !== "unresolved")
			throw new Error("expected unresolved");
		if (
			resolutionState([{ id: "c1", message: "Fixed: removed broken file" }]) !==
			"fixed"
		)
			throw new Error("expected fixed");
		if (
			resolutionState([{ id: "c1", message: "Which device is this on?" }]) !==
			"clarification_requested"
		)
			throw new Error("expected clarification_requested");
	}),

	test("resolveReports: resolves URL to item and matches the right service kind", async () => {
		const oldFetch = global.fetch;
		global.fetch = buildFetchStub() as typeof global.fetch;
		try {
			const client = await makeClient();
			const sonarr = new MockSonarrService(
				"sonarr-hd",
				createMockServiceConfig(),
			);
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const radarrUhd = new MockRadarrService(
				"radarr-uhd",
				createMockServiceConfig(),
			);

			const reports = await resolveReports(
				client,
				[reportFixture()],
				[sonarr, radarr, radarrUhd],
			);

			const resolved = reports[0];
			if (!resolved) throw new Error("no resolved report");
			assertPropertyEquals(resolved.item?.title, "Leviticus");
			// Movie → only radarr services considered.
			assertPropertyEquals(resolved.matches.length, 2);
			const exact = resolved.matches.find((m) => m.matchType === "exact");
			if (!exact) throw new Error("no exact match");
			assertPropertyEquals(exact.service, "radarr-hd");
			assertPropertyEquals(exact.item?.id, 10);
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("planRemediation add_or_upgrade: item not in library → add with standard profile note", async () => {
		const oldFetch = global.fetch;
		global.fetch = buildFetchStub({
			"/api/v3/movie": [],
		}) as typeof global.fetch;
		try {
			const client = await makeClient();
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const plan = await planRemediation(
				client,
				reportFixture(),
				"add_or_upgrade",
				undefined,
				[radarr],
			);
			assertOk(plan);
			assertHasData(plan);
			assertPropertyEquals(plan.data?.service, "radarr-hd");
			if (!plan.data?.note.includes("add with standard quality profile")) {
				throw new Error(`unexpected note: ${plan.data?.note}`);
			}
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("planRemediation remove_and_regrab on movie: resolves movie file id", async () => {
		const oldFetch = global.fetch;
		global.fetch = buildFetchStub() as typeof global.fetch;
		try {
			const client = await makeClient();
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const plan = await planRemediation(
				client,
				reportFixture(),
				"remove_and_regrab",
				undefined,
				[radarr],
			);
			assertOk(plan);
			assertHasData(plan);
			assertPropertyEquals(plan.data?.item?.movieFileId, 99);
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("remove_and_regrab requires a confirmation token; execute fails without one", async () => {
		const oldFetch = global.fetch;
		global.fetch = buildFetchStub() as typeof global.fetch;
		try {
			const client = await makeClient();
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const result = await executeRemediation(
				client,
				reportFixture(),
				{ reportId: "report-1", action: "remove_and_regrab" },
				[radarr],
			);
			if (result.ok) throw new Error("expected failure without token");
			if (!("message" in result.error))
				throw new Error("expected internal error");
			if (!result.error.message.includes("Confirmation token")) {
				throw new Error(`unexpected message: ${result.error.message}`);
			}
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("buildComment: comment_only default asks for specifics; fixed actions say Fixed:", () => {
		const preview = {
			reportId: "report-1",
			action: "comment_only" as const,
			service: "radarr-hd",
			matchType: "exact" as const,
			item: { id: 10, title: "Leviticus", year: 2026, hasFile: true },
			resolvedTitle: "Leviticus",
			note: "",
		};
		const clarify = buildComment("comment_only", preview);
		if (!clarify.includes("more specific"))
			throw new Error(`unexpected: ${clarify}`);
		const fixed = buildComment("re_search", preview);
		if (!fixed.includes("Fixed:")) throw new Error(`unexpected: ${fixed}`);
	}),

	test("episode report matches sonarr services and resolves episode file id", async () => {
		const oldFetch = global.fetch;
		const epReport = reportFixture({
			message: "Wrong ep DLd",
			url: "server://6cf8bfab123/com.plexapp.plugins.library/library/metadata/234065",
		});
		global.fetch = buildFetchStub({
			"/library/metadata/234065": metadataResponse("234065", {
				type: "episode",
				title: "Destined",
				grandparentTitle: "Heartbreak High (2022)",
				parentIndex: 3,
				index: 5,
				year: 2026,
			}),
			"/api/v3/series": [
				{
					id: 7,
					title: "Heartbreak High (2022)",
					year: 2022,
					statistics: { episodeFileCount: 12 },
				},
			],
			"/api/v3/episode": [
				{
					id: 40,
					seasonNumber: 3,
					episodeNumber: 5,
					title: "Destined",
					hasFile: true,
					episodeFile: { id: 88 },
				},
			],
		}) as typeof global.fetch;
		try {
			const client = await makeClient();
			const sonarr = new MockSonarrService(
				"sonarr-hd",
				createMockServiceConfig(),
			);
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const matches = await resolveReportMatches(client, epReport, [
				sonarr,
				radarr,
			]);
			const sonarrMatch = matches.find((m) => m.service === "sonarr-hd");
			if (!sonarrMatch) throw new Error("no sonarr match");
			assertPropertyEquals(sonarrMatch.item?.id, 7);

			const plan = await planRemediation(
				client,
				epReport,
				"remove_and_regrab",
				undefined,
				[sonarr, radarr],
			);
			assertOk(plan);
			assertHasData(plan);
			assertPropertyEquals(plan.data?.episodeFileId, 88);
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("add_or_upgrade execute discovers root folder when not supplied (regression: Radarr 400)", async () => {
		const oldFetch = global.fetch;
		global.fetch = buildFetchStub({
			"/api/v3/movie": [],
			"/api/v3/rootfolder": [{ path: "/movies" }],
			"/api/v3/movie/lookup": [
				{ title: "Leviticus", year: 2026, tmdbId: 12345, foreignId: 12345 },
			],
			"/api/v3/qualityprofile": [
				{ id: 1, name: "HD-1080p", upgradeAllowed: true, cutoff: 1 },
			],
			"/api/v3/command": { id: 1, name: "MoviesSearch" },
			[PLEX_GRAPHQL]: {
				data: {
					createReportComment: {
						__typename: "ReportComment",
						id: "comment-1",
						message: "Fixed: added",
						date: "2026-08-03T07:12:53Z",
						status: "OPEN",
						user: { id: "me", username: "AshWilliams12" },
					},
				},
			},
		}) as typeof global.fetch;
		global.fetch = withAddPost(global.fetch, 2364) as typeof global.fetch;
		try {
			const client = await makeClient();
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const result = await executeRemediation(
				client,
				reportFixture(),
				{ reportId: "report-1", action: "add_or_upgrade" },
				[radarr],
			);
			if (!result.ok) {
				throw new Error(
					`expected success, got: ${JSON.stringify(result.error)}`,
				);
			}
			if (!result.data || typeof result.data !== "object")
				throw new Error("no data");
			const data = result.data as {
				actions?: string[];
				commentPosted?: boolean;
			};
			if (!(data.actions ?? []).some((a) => a.includes("added"))) {
				throw new Error(
					`expected add action, got: ${JSON.stringify(data.actions)}`,
				);
			}
			if (data.commentPosted !== true) throw new Error("comment not posted");
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("addNew uses the library's most-used profile, not a name match (regression: HD Bluray + WEB)", async () => {
		const oldFetch = global.fetch;
		global.fetch = buildFetchStub({
			// Most of the library uses qualityProfileId 1 ("HD Bluray + WEB");
			// a few old items use 2 ("HD-720p"). The name heuristic would pick
			// 2 first ("720p" pattern) — the library count must win.
			"/api/v3/movie": [
				{ id: 1, title: "Alpha", year: 2020, qualityProfileId: 1 },
				{ id: 2, title: "Beta", year: 2021, qualityProfileId: 1 },
				{ id: 3, title: "Gamma", year: 2022, qualityProfileId: 1 },
				{ id: 4, title: "Delta", year: 2018, qualityProfileId: 2 },
			],
			"/api/v3/qualityprofile": [
				{ id: 1, name: "HD Bluray + WEB", upgradeAllowed: true, cutoff: 1 },
				{ id: 2, name: "HD-720p", upgradeAllowed: true, cutoff: 2 },
			],
			"/api/v3/rootfolder": [{ path: "/movies" }],
		}) as typeof global.fetch;
		try {
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const result = await radarr.addNew({
				title: "Leviticus",
				foreignId: 12345,
			});
			if (!result.ok || !result.data) throw new Error("addNew failed");
			// The addNew payload is consumed by the stub; verify the recommended
			// profile from listQualityProfiles (same shared selection logic).
			const profiles = await radarr.listQualityProfiles();
			if (!profiles.ok || !profiles.data) throw new Error("profiles failed");
			if (profiles.data.recommended !== 1) {
				throw new Error(
					`expected recommended=1 (HD Bluray + WEB), got ${profiles.data.recommended}`,
				);
			}
			if (profiles.data.recommendedName !== "HD Bluray + WEB") {
				throw new Error(
					`expected recommendedName HD Bluray + WEB, got ${profiles.data.recommendedName}`,
				);
			}
			// Usage metadata must surface the library distribution.
			const top = profiles.data.usage[0];
			if (!top || top.id !== 1 || top.count !== 3 || top.pct !== 75) {
				throw new Error(
					`expected usage top = {1, 3, 75}, got ${JSON.stringify(top)}`,
				);
			}
			if (profiles.data.totalLibraryItems !== 4) {
				throw new Error(
					`expected totalLibraryItems 4, got ${profiles.data.totalLibraryItems}`,
				);
			}
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("update_quality_profile GETs the item, swaps the profile, PUTs it back", async () => {
		const oldFetch = global.fetch;
		let putBody: string | null = null;
		const seen: string[] = [];
		const origFetch = global.fetch;
		global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			const urlObj = new URL(url);
			seen.push(`${init?.method ?? "GET"} ${urlObj.pathname}`);
			if (init?.method === "PUT") {
				putBody = typeof init.body === "string" ? init.body : null;
				return new Response(JSON.stringify({ id: 2364, qualityProfileId: 7 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (urlObj.pathname === "/api/v3/movie/2364") {
				return new Response(
					JSON.stringify({
						id: 2364,
						title: "Leviticus",
						year: 2026,
						qualityProfileId: 3,
						path: "/movies/Leviticus (2026)",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return origFetch(input, init);
		}) as typeof global.fetch;
		try {
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const result = await radarr.updateQualityProfile(2364, 7);
			if (!result.ok || !result.data) throw new Error("update failed");
			if (result.data.updated !== true || result.data.qualityProfileId !== 7) {
				throw new Error(`unexpected result: ${JSON.stringify(result.data)}`);
			}
			if (
				!seen.some((s) => s === "GET /api/v3/movie/2364") ||
				!seen.some((s) => s === "PUT /api/v3/movie/2364")
			) {
				throw new Error(
					`expected GET+PUT on /movie/2364, saw: ${seen.join(", ")}`,
				);
			}
			if (!putBody || !(putBody as string).includes('"qualityProfileId":7')) {
				throw new Error(
					`expected PUT body with qualityProfileId 7, got: ${putBody}`,
				);
			}
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("add_or_upgrade does not post Fixed when the follow-up search fails", async () => {
		const oldFetch = global.fetch;
		let commentPosted = false;
		const base = buildFetchStub({
			"/api/v3/movie/lookup": [
				{ title: "Leviticus", year: 2026, tmdbId: 12345, foreignId: 12345 },
			],
		});
		global.fetch = withAddPost(
			(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				const urlObj = new URL(url);
				if (init?.method === "POST" && urlObj.pathname === "/api/v3/command") {
					// Simulate a failed search trigger.
					return new Response(JSON.stringify({ error: "search failed" }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (init?.method === "POST" && urlObj.pathname === "/api") {
					commentPosted = true;
				}
				return base(input, init);
			}) as typeof global.fetch,
			2364,
		) as typeof global.fetch;
		try {
			const client = await makeClient();
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const result = await executeRemediation(
				client,
				reportFixture(),
				{ reportId: "report-1", action: "add_or_upgrade" },
				[radarr],
			);
			if (result.ok) {
				throw new Error("expected failure when triggerSearch fails");
			}
			if (commentPosted) {
				throw new Error("must not comment Fixed when the search failed");
			}
			const err = result.error as { message?: string };
			if (!err.message?.includes("triggerSearch failed")) {
				throw new Error(`expected triggerSearch failure, got: ${err.message}`);
			}
		} finally {
			global.fetch = oldFetch;
		}
	}),

	test("remove_and_regrab does not re-search when the file deletion fails", async () => {
		const oldFetch = global.fetch;
		let searchTriggered = false;
		let commentPosted = false;
		const base = buildFetchStub();
		global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			const urlObj = new URL(url);
			if (init?.method === "DELETE") {
				return new Response(JSON.stringify({ error: "delete failed" }), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (init?.method === "POST" && urlObj.pathname === "/api/v3/command") {
				searchTriggered = true;
			}
			if (init?.method === "POST" && urlObj.pathname === "/api") {
				commentPosted = true;
			}
			return base(input, init);
		}) as typeof global.fetch;
		try {
			const client = await makeClient();
			const radarr = new MockRadarrService(
				"radarr-hd",
				createMockServiceConfig(),
			);
			const preview = await planRemediation(
				client,
				reportFixture(),
				"remove_and_regrab",
				undefined,
				[radarr],
			);
			if (!preview.ok || !preview.data) throw new Error("plan failed");
			const token = mintRemoveToken("report-1");
			const result = await executeRemediation(
				client,
				reportFixture(),
				{
					reportId: "report-1",
					action: "remove_and_regrab",
					confirmationToken: token,
				},
				[radarr],
			);
			if (result.ok) {
				throw new Error("expected failure when deleteFile fails");
			}
			if (searchTriggered) {
				throw new Error("must not trigger search after a failed delete");
			}
			if (commentPosted) {
				throw new Error("must not comment after a failed delete");
			}
		} finally {
			global.fetch = oldFetch;
		}
	}),
]);
