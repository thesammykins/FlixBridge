import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, test, testRunner } from "../helpers/test-runner.js";

await describe("Release policy", [
	test("release identity rejects mismatched inputs and lock identity", async () => {
		const path = new URL(
			"../../scripts/release-preflight.mjs",
			import.meta.url,
		);
		const exists = await readFile(path, "utf8").catch(() => "");
		assert.ok(exists, "actual release CLI helper must exist");
		const { validateIdentity } = await import(path.href);
		const sha = "a".repeat(40);
		const env = {
			EXPECTED_COMMIT: sha,
			GITHUB_SHA: sha,
			PACKAGE_VERSION: "1.1.0",
			EXPECTED_SHA256: "b".repeat(64),
			GITHUB_REPOSITORY: "thesammykins/FlixBridge",
			GITHUB_REF: "refs/heads/main",
		};
		const pkg = { name: "@thesammykins/flixbridge", version: "1.1.0" };
		const lock = { ...pkg, packages: { "": pkg } };
		validateIdentity(env, pkg, lock, sha, sha, "");
		for (const field of [
			"EXPECTED_COMMIT",
			"GITHUB_SHA",
			"PACKAGE_VERSION",
			"EXPECTED_SHA256",
			"GITHUB_REPOSITORY",
			"GITHUB_REF",
		]) {
			assert.throws(() =>
				validateIdentity(
					{ ...env, [field]: "invalid" },
					pkg,
					lock,
					sha,
					sha,
					"",
				),
			);
		}
		assert.throws(() =>
			validateIdentity(env, pkg, { ...lock, version: "0.1.0" }, sha, sha, ""),
		);
		assert.throws(() =>
			validateIdentity(env, pkg, lock, "c".repeat(40), sha, ""),
		);
		assert.throws(() =>
			validateIdentity(env, pkg, lock, sha, "c".repeat(40), ""),
		);
		assert.throws(() =>
			validateIdentity(env, pkg, lock, sha, sha, "?? surprise"),
		);
	}),
	test("public registry preflight fails closed and readback verifies exact bytes", async () => {
		const helper = await import(
			new URL("../../scripts/release-preflight.mjs", import.meta.url).href
		);
		assert.equal(
			typeof helper.checkAvailable,
			"function",
			"public registry preflight missing",
		);
		const packument = {
			name: "@thesammykins/flixbridge",
			versions: {},
			"dist-tags": {},
		};
		const respond =
			(body: unknown, status = 200) =>
			async (url: string, options: RequestInit) => {
				assert.ok(url.startsWith("https://registry.npmjs.org/"));
				assert.equal(options.redirect, "error");
				assert.equal(options.headers?.authorization, undefined);
				return new Response(JSON.stringify(body), { status });
			};
		await helper.checkAvailable("1.1.0", respond(packument));
		for (const status of [401, 403, 404, 429, 500, 503])
			await assert.rejects(
				helper.checkAvailable("1.1.0", respond({}, status)),
				new RegExp(`HTTP ${status}`),
			);
		await assert.rejects(
			helper.checkAvailable("1.1.0", async () => {
				throw new Error("offline");
			}),
			/transport/,
		);
		await assert.rejects(
			helper.checkAvailable("1.1.0", async () => new Response("not json")),
			/JSON/,
		);
		for (const malformed of [
			{ ...packument, versions: [] },
			{ ...packument, versions: { "0.3.18": null } },
			{ ...packument, "dist-tags": { latest: 42 } },
			{ ...packument, "dist-tags": { latest: "0.3.18" } },
		])
			await assert.rejects(
				helper.checkAvailable("1.1.0", respond(malformed)),
				/packument/,
			);
		await assert.rejects(
			helper.checkAvailable("1.1.0", respond({})),
			/packument/,
		);
		await assert.rejects(
			helper.checkAvailable(
				"1.1.0",
				respond({ ...packument, versions: { "1.1.0": {} } }),
			),
			/already exists/,
		);
		const bytes = Buffer.from("exact tarball fixture");
		const { createHash } = await import("node:crypto");
		const artifact = {
			version: "1.1.0",
			sha256: createHash("sha256").update(bytes).digest("hex"),
			integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		};
		const metadata = {
			name: packument.name,
			version: "1.1.0",
			dist: {
				integrity: artifact.integrity,
				tarball:
					"https://registry.npmjs.org/@thesammykins/flixbridge/-/flixbridge-1.1.0.tgz",
			},
		};
		let calls = 0;
		const published = async (url: string) => {
			calls++;
			if (url.endsWith(".tgz")) return new Response(bytes);
			return new Response(
				JSON.stringify(
					url.endsWith("/1.1.0")
						? metadata
						: { ...packument, "dist-tags": { latest: "1.1.0" } },
				),
			);
		};
		await helper.verifyPublished(artifact, published, 1, 0);
		assert.equal(calls, 3);
		for (const changed of [
			{ ...artifact, sha256: "0".repeat(64) },
			{ ...artifact, integrity: "sha512-bad" },
			{ ...artifact, version: "1.2.0" },
		])
			await assert.rejects(helper.verifyPublished(changed, published, 1, 0));
		calls = 0;
		await assert.rejects(
			helper.verifyPublished(
				artifact,
				async () => {
					calls++;
					return new Response("", { status: 503 });
				},
				2,
				0,
			),
		);
		assert.equal(calls, 2, "only bounded read retries");
	}),
	test("artifact gate binds approved hash, allowlist and actual tar members", async () => {
		const helper = await import(
			new URL("../../scripts/release-preflight.mjs", import.meta.url).href
		);
		assert.equal(
			typeof helper.validateArtifact,
			"function",
			"artifact gate missing",
		);
		const bytes = Buffer.from("tar fixture");
		const { createHash } = await import("node:crypto");
		const sha = createHash("sha256").update(bytes).digest("hex");
		const files = [
			"LICENSE",
			"README.md",
			"dist/cli.js",
			"dist/index.js",
			"package.json",
		];
		const manifest = {
			name: "@thesammykins/flixbridge",
			version: "1.1.0",
			filename: "thesammykins-flixbridge-1.1.0.tgz",
			files: files.map((path) => ({ path })),
		};
		const members = files.map((path) => `package/${path}`);
		const result = helper.validateArtifact(
			bytes,
			manifest,
			members,
			"1.1.0",
			sha,
		);
		assert.equal(result.sha256, sha);
		assert.match(result.integrity, /^sha512-/);
		assert.throws(() =>
			helper.validateArtifact(
				bytes,
				manifest,
				members,
				"1.1.0",
				"0".repeat(64),
			),
		);
		assert.throws(() =>
			helper.validateArtifact(
				bytes,
				manifest,
				[...members, "package/.env"],
				"1.1.0",
				sha,
			),
		);
		assert.throws(() =>
			helper.validateArtifact(
				bytes,
				{ ...manifest, name: "wrong" },
				members,
				"1.1.0",
				sha,
			),
		);
		assert.throws(() =>
			helper.validateArtifact(bytes, manifest, members.slice(1), "1.1.0", sha),
		);
		for (const path of [
			".env",
			"dist/../secret",
			"dist//secret",
			"src/index.ts",
			"dist/.secret",
		])
			assert.throws(() =>
				helper.validateArtifact(
					bytes,
					{ ...manifest, files: [...manifest.files, { path }] },
					[...members, `package/${path}`],
					"1.1.0",
					sha,
				),
			);
	}),
	test("artifact CLI consumes npm 12 keyed pack output and rejects changed bytes", async () => {
		const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { execFileSync, spawnSync } = await import("node:child_process");
		const { createHash } = await import("node:crypto");
		const dir = await mkdtemp(join(tmpdir(), "release-policy-"));
		try {
			const files = [
				"LICENSE",
				"README.md",
				"dist/cli.js",
				"dist/index.js",
				"package.json",
			];
			await mkdir(join(dir, "package/dist"), { recursive: true });
			for (const path of files)
				await writeFile(
					join(dir, "package", path),
					path === "package.json"
						? await readFile(new URL("../../package.json", import.meta.url))
						: "fixture",
				);
			const filename = "thesammykins-flixbridge-1.1.0.tgz";
			execFileSync("tar", [
				"-czf",
				join(dir, filename),
				"-C",
				dir,
				...files.map((path) => `package/${path}`),
			]);
			const sha = createHash("sha256")
				.update(await readFile(join(dir, filename)))
				.digest("hex");
			await writeFile(
				join(dir, "pack.json"),
				JSON.stringify({
					"@thesammykins/flixbridge": {
						name: "@thesammykins/flixbridge",
						version: "1.1.0",
						filename,
						files: files.map((path) => ({ path })),
					},
				}),
			);
			const env = {
				...process.env,
				ARTIFACT_DIR: dir,
				PACKAGE_VERSION: "1.1.0",
				EXPECTED_SHA256: sha,
			};
			const run = spawnSync(
				process.execPath,
				["scripts/release-preflight.mjs", "artifact"],
				{ env, encoding: "utf8" },
			);
			assert.equal(run.status, 0, run.stderr);
			assert.equal(JSON.parse(run.stdout).sha256, sha);
			const bad = spawnSync(
				process.execPath,
				["scripts/release-preflight.mjs", "artifact"],
				{ env: { ...env, EXPECTED_SHA256: "0".repeat(64) }, encoding: "utf8" },
			);
			assert.equal(bad.status, 1);
			assert.match(bad.stderr, /SHA-256/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}),
	test("release workflow enforces the dispatch and exact artifact boundary", async () => {
		const workflow = await readFile(
			new URL("../../.github/workflows/release.yml", import.meta.url),
			"utf8",
		).catch(() => "");
		assert.ok(workflow, "guarded release workflow missing");
		assert.match(
			workflow,
			/^ {4}if: github\.repository == 'thesammykins\/FlixBridge' && github\.ref == 'refs\/heads\/main'$/m,
		);
		assert.match(workflow, /^ {4}runs-on: ubuntu-latest$/m);
		assert.match(
			workflow,
			/^ {4}permissions:\n {6}contents: read\n {6}id-token: write/m,
		);
		assert.match(workflow, /^on:\n {2}workflow_dispatch:\n {4}inputs:/m);
		for (const key of ["expected_commit", "package_version", "expected_sha256"])
			assert.match(
				workflow,
				new RegExp(
					`^ {6}${key}:\\n {8}description: [^\\n]+\\n {8}required: true\\n {8}type: string$`,
					"m",
				),
			);
		for (const required of [
			"workflow_dispatch:",
			"github.repository == 'thesammykins/FlixBridge'",
			"github.ref == 'refs/heads/main'",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
			"ref: ${{ github.sha }}",
			"persist-credentials: false",
			"node-version: 24.22.1",
			"npm install --global npm@12.2.1 --ignore-scripts",
			"npm ci --include=dev --ignore-scripts",
			"npm run check",
			"npm run build",
			"npm test",
			"npm audit --audit-level=moderate",
			"npm pack --ignore-scripts",
			"--omit=dev --ignore-scripts",
			"MCP_TEST_BIN=",
			"tests/mcp-client.test.mjs",
			'flixbridge-retention" --help',
			"id-token: write",
			"--ignore-scripts --access public --tag latest --provenance",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression
			"if: ${{ always() && steps.publish.outcome != 'skipped' }}",
			"node scripts/release-preflight.mjs readback",
		])
			assert.ok(workflow.includes(required), `missing ${required}`);
		assert.doesNotMatch(
			workflow,
			/^ {8}default:/m,
			"release inputs require final reviewed values, never stale defaults",
		);
		assert.doesNotMatch(
			workflow,
			/^ {2}(push|pull_request|schedule|workflow_call):/m,
		);
		assert.doesNotMatch(
			workflow,
			/(?:contents|packages|actions|pull-requests):\s*write|continue-on-error|npm run smoke|git\s+(?:push|tag)/,
		);
		assert.equal((workflow.match(/npm publish /g) ?? []).length, 1);
		assert.equal((workflow.match(/npm pack /g) ?? []).length, 1);
		assert.equal((workflow.match(/NODE_AUTH_TOKEN:/g) ?? []).length, 1);
		assert.equal((workflow.match(/secrets\./g) ?? []).length, 1);
		assert.equal(
			(workflow.match(/node scripts\/release-preflight.mjs identity/g) ?? [])
				.length,
			2,
		);
		assert.ok(
			workflow.indexOf("release-preflight.mjs identity") <
				workflow.indexOf("npm install --global"),
		);
		assert.ok(
			workflow.lastIndexOf("release-preflight.mjs identity") <
				workflow.indexOf("npm publish "),
		);
		assert.ok(
			workflow.indexOf("release-preflight.mjs available") <
				workflow.indexOf("npm publish "),
		);
		for (const line of workflow
			.split("\n")
			.filter((line) => line.includes("${{ inputs.")))
			assert.match(
				line,
				/^ {6}(EXPECTED_COMMIT|PACKAGE_VERSION|EXPECTED_SHA256): /,
			);
		assert.match(
			workflow,
			/- name: Publish exact verified tarball\n {8}id: publish\n {8}env:\n {10}NODE_AUTH_TOKEN: \$\{\{ secrets.NPM_TOKEN \}\}/,
		);
	}),
	test("ordinary repository workflows cannot publish or mutate release state", async () => {
		const files = await readdir(
			new URL("../../.github/workflows/", import.meta.url),
		);
		for (const name of files.filter((file) => /\.ya?ml$/.test(file))) {
			const workflow = await readFile(
				new URL(`../../.github/workflows/${name}`, import.meta.url),
				"utf8",
			);
			if (name === "release.yml") continue;
			assert.doesNotMatch(
				workflow,
				/npm\s+(?:stage\s+)?publish\b|npm\s+version\b|git\s+(?:push|tag)\b|actions\/create-release/,
			);
			assert.doesNotMatch(
				workflow,
				/(?:id-token|contents|packages|actions|pull-requests):\s*write/,
			);
		}
	}),
]);

if (process.argv[1]?.endsWith("release-policy.test.ts"))
	testRunner.printSummary();
