import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { projectSandboxCommand } from "./project-sandbox.js";

test("sandbox rejects unsafe profiles before launch", () => {
	assert.throws(() => projectSandboxCommand({ readOnly: ["/"], writable: [], cwd: "/" }, "/bin/sh", []), /Unsafe/);
	assert.throws(() => projectSandboxCommand({ readOnly: ["relative"], writable: [], cwd: "/" }, "/bin/sh", []), /absolute/);
});

test("Linux sandbox enforces filesystem access for commands and descendants", { skip: process.platform !== "linux" || !existsSync("/usr/bin/bwrap") }, () => {
	const dir = mkdtempSync(path.join(os.homedir(), ".beezy-sandbox-test-"));
	const shared = path.join(dir, "shared");
	const project = path.join(dir, "project");
	const privateDir = path.join(dir, "private");
	for (const root of [shared, project, privateDir]) mkdirSync(root);
	writeFileSync(path.join(shared, "input"), "shared");
	writeFileSync(path.join(privateDir, "secret"), "secret");
	symlinkSync(privateDir, path.join(project, "escape"));
	const profile = { readOnly: [shared], writable: [project], cwd: project };
	const run = (script: string) => {
		const spec = projectSandboxCommand(profile, "/bin/sh", ["-c", script]);
		return spawnSync(spec.command, spec.args, { encoding: "utf8", env: { ...process.env, BEEZY_TEST_SECRET: "must-not-leak" }, timeout: 10000 });
	};
	try {
		assert.throws(() => projectSandboxCommand({ ...profile, readOnly: [dir] }, "/bin/sh", []), /Overlapping/);
		assert.throws(() => projectSandboxCommand({ ...profile, cwd: privateDir }, "/bin/sh", []), /outside/);
		let result = run(`cat '${shared}/input'; printf ok > output; /bin/sh -c 'printf child > child-output'`);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "shared");
		assert.equal(readFileSync(path.join(project, "output"), "utf8"), "ok");
		assert.equal(readFileSync(path.join(project, "child-output"), "utf8"), "child");
		assert.notEqual(run(`printf bad > '${shared}/input'`).status, 0);
		assert.notEqual(run(`cat '${privateDir}/secret'`).status, 0);
		assert.notEqual(run("cat escape/secret").status, 0);
		assert.equal(run("printf '%s' \"${BEEZY_TEST_SECRET-unset}\"").stdout, "unset");
		assert.equal(readFileSync(path.join(shared, "input"), "utf8"), "shared");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
