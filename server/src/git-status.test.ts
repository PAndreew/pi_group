import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gitStatus, parseStatus } from "./git-status.js";

test("parses branch, upstream, ahead/behind and counts every changed file once", () => {
	const status = parseStatus(
		[
			"# branch.oid 1234567890abcdef",
			"# branch.head main",
			"# branch.upstream origin/main",
			"# branch.ab +2 -3",
			"1 .M N... 100644 100644 100644 a b src/a.ts",
			"2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts",
			"u UU N... 100644 100644 100644 100644 a b c conflict.ts",
			"? notes.md",
			"",
		].join("\n"),
	);
	assert.deepEqual(status, { branch: "main", detached: false, files: 4, upstream: "origin/main", ahead: 2, behind: 3 });
	assert.deepEqual(parseStatus("# branch.oid abcdef1234\n# branch.head (detached)\n"), { branch: "abcdef1", detached: true, files: 0, ahead: 0, behind: 0 });
});

test("reads a real repository and returns null outside one", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-git-"));
	try {
		assert.equal(await gitStatus(dir), null);
		const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
		run("init", "-q", "-b", "trunk");
		writeFileSync(path.join(dir, "a.txt"), "a");
		run("add", "a.txt");
		run("commit", "-qm", "init");
		assert.deepEqual(await gitStatus(dir), { branch: "trunk", detached: false, files: 0, ahead: 0, behind: 0 });
		writeFileSync(path.join(dir, "a.txt"), "changed");
		writeFileSync(path.join(dir, "b.txt"), "new");
		assert.equal((await gitStatus(dir))?.files, 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
