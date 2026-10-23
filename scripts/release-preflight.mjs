import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const name = "@thesammykins/flixbridge";
const repository = "thesammykins/FlixBridge";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);

export function validateIdentity(env, pkg, lock, head, remote, status) {
	assert.match(env.EXPECTED_COMMIT ?? "", /^[a-f0-9]{40}$/);
	assert.match(env.EXPECTED_SHA256 ?? "", /^[a-f0-9]{64}$/);
	assert.match(env.PACKAGE_VERSION ?? "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
	assert.equal(env.GITHUB_REPOSITORY, repository);
	assert.equal(env.GITHUB_REF, "refs/heads/main");
	for (const sha of [env.GITHUB_SHA, head, remote]) assert.equal(sha, env.EXPECTED_COMMIT);
	for (const identity of [pkg, lock, lock.packages?.[""]]) {
		assert.equal(identity?.name, name);
		assert.equal(identity?.version, env.PACKAGE_VERSION);
	}
	assert.equal(status, "", "tracked and untracked tree must be clean");
}

const registry = "https://registry.npmjs.org";
const packageUrl = `${registry}/${encodeURIComponent(name)}`;

async function request(url, fetcher = fetch) {
	assert.equal(new URL(url).origin, registry, "public registry origin required");
	let response;
	try {
		response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
	} catch (error) {
		throw new Error(`registry transport failure: ${error.message}`);
	}
	assert.equal(response.status, 200, `registry HTTP ${response.status}`);
	return response;
}

async function registryJson(url, fetcher) {
	const response = await request(url, fetcher);
	try { return await response.json(); }
	catch { throw new Error("registry invalid JSON"); }
}

export async function checkAvailable(version, fetcher = fetch) {
	const data = await registryJson(packageUrl, fetcher);
	assert.ok(data && data.name === name && data.versions && typeof data.versions === "object" && !Array.isArray(data.versions) && data["dist-tags"] && typeof data["dist-tags"] === "object" && !Array.isArray(data["dist-tags"]), "registry invalid packument");
	assert.ok(!Object.hasOwn(data.versions, version), "registry version already exists; never retry publish");
	assert.ok(Object.entries(data.versions).every(([key, value]) => value?.name === name && value?.version === key), "registry invalid packument versions");
	assert.ok(Object.values(data["dist-tags"]).every((value) => typeof value === "string" && Object.hasOwn(data.versions, value)), "registry invalid packument tags");
}

export async function verifyPublished(artifact, fetcher = fetch, attempts = 3, delayMs = 2000) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const metadata = await registryJson(`${packageUrl}/${artifact.version}`, fetcher);
			assert.equal(metadata.name, name);
			assert.equal(metadata.version, artifact.version);
			assert.equal(metadata.dist?.integrity, artifact.integrity, "registry integrity mismatch");
			const bytes = Buffer.from(await (await request(metadata.dist.tarball, fetcher)).arrayBuffer());
			assert.equal(hash(bytes, "sha256", "hex"), artifact.sha256, "downloaded SHA-256 mismatch");
			assert.equal(`sha512-${hash(bytes, "sha512", "base64")}`, artifact.integrity, "downloaded SHA-512 mismatch");
			const packument = await registryJson(packageUrl, fetcher);
			assert.equal(packument.name, name);
			assert.equal(packument["dist-tags"]?.latest, artifact.version, "latest tag mismatch");
			return;
		} catch (error) {
			if (attempt + 1 === attempts) throw error;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

export function validateArtifact(bytes, manifest, members, version, expectedSha) {
	assert.equal(manifest.name, name);
	assert.equal(manifest.version, version);
	assert.equal(manifest.filename, `thesammykins-flixbridge-${version}.tgz`);
	const paths = manifest.files.map((file) => file.path).sort();
	assert.equal(new Set(paths).size, paths.length, "duplicate members");
	for (const path of paths) {
		assert.ok(/^(LICENSE|README\.md|package\.json|dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|js\.map|d\.ts|d\.ts\.map))$/.test(path), `forbidden package member: ${path}`);
	}
	for (const required of ["LICENSE", "README.md", "package.json", "dist/index.js", "dist/cli.js"]) assert.ok(paths.includes(required), `missing ${required}`);
	assert.deepEqual([...members].sort(), paths.map((path) => `package/${path}`), "tar members differ from pack manifest");
	const sha256 = hash(bytes, "sha256", "hex");
	assert.equal(sha256, expectedSha, "approved SHA-256 mismatch");
	return { version, sha256, integrity: `sha512-${hash(bytes, "sha512", "base64")}` };
}

function artifact() {
	const packed = json(`${process.env.ARTIFACT_DIR}/pack.json`);
	assert.deepEqual(Object.keys(packed), [name], "pack exactly one named artifact");
	const manifest = packed[name];
	assert.equal(manifest.filename, `thesammykins-flixbridge-${process.env.PACKAGE_VERSION}.tgz`);
	const path = `${process.env.ARTIFACT_DIR}/${manifest.filename}`;
	const members = execFileSync("tar", ["-tzf", path], { encoding: "utf8" }).trim().split("\n");
	const types = execFileSync("tar", ["-tvzf", path], { encoding: "utf8" }).trim().split("\n");
	assert.ok(types.every((line) => line.startsWith("-")), "only regular tar members allowed");
	const pkg = JSON.parse(execFileSync("tar", ["-xOzf", path, "package/package.json"], { encoding: "utf8" }));
	assert.deepEqual(pkg, json("package.json"), "packed package identity differs");
	return validateArtifact(readFileSync(path), manifest, members, process.env.PACKAGE_VERSION, process.env.EXPECTED_SHA256);
}

function identity() {
	validateIdentity(process.env, json("package.json"), json("package-lock.json"), git("rev-parse", "HEAD"), git("ls-remote", `https://github.com/${repository}.git`, "refs/heads/main").split(/\s/)[0], git("status", "--porcelain", "--untracked-files=all"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (process.argv[2] === "identity") identity();
		else if (process.argv[2] === "artifact") console.log(JSON.stringify(artifact()));
		else if (process.argv[2] === "available") await checkAvailable(process.env.PACKAGE_VERSION);
		else if (process.argv[2] === "readback") await verifyPublished(artifact());
		else throw new Error("unknown release command");
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
