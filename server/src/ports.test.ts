import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("node adapters keep today's behavior behind the ports, and a deployment can swap them", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-ports-"));
	process.env.DATA_DIR = path.join(dir, "data");
	process.env.FS_ROOT = path.join(dir, "files");
	mkdirSync(process.env.FS_ROOT);
	const { nodePlatform } = await import("./ports/node.js");
	const { platform, setPlatform } = await import("./ports/index.js");
	const node = nodePlatform();
	try {
		// Documents: atomic JSON in DATA_DIR; missing ones are undefined.
		assert.equal(node.documents.load("missing"), undefined);
		node.documents.save("doc", { a: 1 });
		assert.deepEqual(node.documents.load("doc"), { a: 1 });

		// SQLite: created on first open.
		assert.equal(node.sqlExists("test"), false);
		const db = node.openSql("test");
		db.exec("CREATE TABLE t (v TEXT)");
		db.prepare("INSERT INTO t (v) VALUES (?)").run("x");
		assert.deepEqual(db.prepare("SELECT v FROM t").all().map((r) => r.v), ["x"]);
		db.close();
		assert.equal(node.sqlExists("test"), true);

		// Storage: confined to FS_ROOT; a stale save is refused.
		await node.storage.mkdir("notes");
		const saved = await node.storage.writeText("notes/a.txt", "one");
		assert.equal((await node.storage.list("notes")).entries[0].name, "a.txt");
		await node.storage.writeText("notes/a.txt", "two", saved.mtime);
		writeFileSync(path.join(dir, "files", "notes", "a.txt"), "changed elsewhere");
		await assert.rejects(node.storage.writeText("notes/a.txt", "three", saved.mtime - 10_000), { status: 409 });
		assert.throws(() => node.storage.localPath!("../outside"), { status: 403 });

		// Realtime: topics fan out until unsubscribed.
		const seen: unknown[] = [];
		const stop = node.realtime.subscribe("t", (event) => seen.push(event));
		node.realtime.publish("t", 1);
		assert.equal(node.realtime.subscribers("t"), 1);
		stop();
		node.realtime.publish("t", 2);
		assert.deepEqual(seen, [1]);
		assert.equal(node.realtime.subscribers("t"), 0);

		// Sandbox: stdin in, stdout out, exit code after the output.
		const child = node.sandbox.spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { cwd: dir });
		let out = "";
		child.onStdout((chunk) => (out += chunk.toString()));
		child.end("echo");
		assert.equal(await new Promise((resolve) => child.onClose(resolve)), 0);
		assert.equal(out, "echo");

		// Models: everything off by default.
		assert.deepEqual(Object.values(node.models.info()).map((c) => c.provider), ["none", "none", "none", "none", "none"]);

		// A deployment swaps the adapters before the app uses them.
		setPlatform({ ...node, models: { info: () => ({ ...node.models.info(), stt: { provider: "api", model: "whisper" } }) } });
		assert.equal(platform().models.info().stt.provider, "api");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
