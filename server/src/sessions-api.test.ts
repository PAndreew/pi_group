import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter } from "./harness/types.js";

test("only owners delete sessions; erased ones are removed, others tombstoned; recent lists activity", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-sessions-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { sessionRoutes } = await import("./sessions.js");
	loadStore();
	const owner = createUser("test-owner", "test-password", "member");
	const viewer = createUser("test-viewer", "test-password", "member");
	const deleted: string[] = [];
	const adapter = {
		id: "fake",
		live: () => undefined,
		liveSessions: () => [],
		// "a" can be erased by the harness, "b" cannot (like pi-durable).
		deleteSession: async (id: string) => (deleted.push(id), id === "a"),
	} as unknown as HarnessAdapter;
	const base = { harness: "fake", cwd: dir };
	store.upsertSession({ ...base, key: "fake:a", id: "a", ownerId: owner.id, visibility: "shared", shares: [{ userId: viewer.id, access: "read" }], updatedAt: "2026-01-01T00:00:00.000Z" });
	store.upsertSession({ ...base, key: "fake:b", id: "b", ownerId: owner.id, updatedAt: "2026-01-02T00:00:00.000Z" });
	store.upsertSession({ ...base, key: "fake:c", id: "c" });

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}`;
	const login = async (username: string) => {
		const res = await fetch(`${url}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		return res.headers.get("set-cookie")!.split(";")[0];
	};
	const call = (cookie: string, method: string, route: string) => fetch(`${url}${route}`, { method, headers: { Cookie: cookie, "X-Pi-Group": "1" } });
	const recent = async (cookie: string) => ((await (await call(cookie, "GET", "/sessions/recent?limit=3")).json()).sessions as { key: string }[]).map((s) => s.key);
	try {
		const ownerCookie = await login(owner.username);
		const viewerCookie = await login(viewer.username);
		assert.deepEqual(await recent(ownerCookie), ["fake:b", "fake:a"]);
		assert.deepEqual(await recent(viewerCookie), ["fake:a"]);

		assert.equal((await call(viewerCookie, "DELETE", "/sessions/fake%3Aa")).status, 403);
		assert.deepEqual(deleted, []);

		assert.equal((await call(ownerCookie, "DELETE", "/sessions/fake%3Aa")).status, 200);
		assert.equal(store.session("fake:a"), undefined);

		assert.equal((await call(ownerCookie, "DELETE", "/sessions/fake%3Ab")).status, 200);
		assert.equal(store.session("fake:b")?.deleted, true);
		assert.equal((await call(ownerCookie, "GET", "/sessions/fake%3Ab")).status, 404);
		assert.deepEqual(await recent(ownerCookie), []);
		assert.deepEqual(deleted, ["a", "b"]);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
