import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter } from "./harness/types.js";

test("batch deletion removes eligible sessions and protects running, viewed and consolidating sessions", async () => {
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
	const running = { state: { running: true, messages: [] }, lastActivity: Date.now() };
	const adapter = {
		id: "fake",
		live: (id: string) => id === "running" ? running : undefined,
		readSession: async () => ({ messages: [] }),
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
	const call = (cookie: string, method: string, route: string, opts: { body?: unknown; signal?: AbortSignal } = {}) => fetch(`${url}${route}`, {
		method, signal: opts.signal, headers: { Cookie: cookie, "X-Pi-Group": "1", "Content-Type": "application/json" }, body: JSON.stringify(opts.body),
	});
	const stream = new AbortController();
	let finishRead!: () => void;
	const history = new Promise<{ messages: [] }>((resolve) => { finishRead = () => resolve({ messages: [] }); });
	const recent = async (cookie: string) => ((await (await call(cookie, "GET", "/sessions/recent?limit=3")).json()).sessions as { key: string }[]).map((s) => s.key);
	try {
		const ownerCookie = await login(owner.username);
		const viewerCookie = await login(viewer.username);
		assert.deepEqual(await recent(ownerCookie), ["fake:b", "fake:a"]);
		assert.deepEqual(await recent(viewerCookie), ["fake:a"]);

		assert.equal((await call(viewerCookie, "DELETE", "/sessions/fake%3Aa")).status, 403);
		assert.deepEqual(deleted, []);

		store.upsertSession({ ...base, key: "fake:running", id: "running", ownerId: owner.id });
		store.upsertSession({ ...base, key: "fake:viewed", id: "viewed", ownerId: owner.id });
		const memoryCwd = path.join(dir, "project");
		mkdirSync(memoryCwd);
		// An old one-on-one session with up-to-date memory: the archiver reads its history.
		store.upsertSession({ ...base, cwd: memoryCwd, key: "fake:memory", id: "memory", ownerId: owner.id, projectId: "memory", updatedAt: "2020-01-01T00:00:00.000Z", consolidatedAt: "2020-01-02T00:00:00.000Z", authorship: { authors: { x: { id: owner.id, username: owner.username } }, pending: [] } });
		store.data.projects.push({ id: "memory", name: "Memory", cwd: memoryCwd, tenantId: "work", createdBy: owner.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
		// Hold the history read open, so the session is busy with memory while deletion is attempted.
		adapter.readSession = async (id) => id === "memory" ? history : { messages: [] };
		const { memoryControls } = await import("./memory.js");
		const archiving = memoryControls.archiveNow();
		const events = await call(ownerCookie, "GET", "/sessions/fake%3Aviewed/events", { signal: stream.signal });
		assert.equal(events.status, 200);
		for (const [id, reason] of [["running", "The agent is running"], ["viewed", "Someone is viewing this session"], ["memory", "Project memory is being updated"]]) {
			const { session } = await (await call(ownerCookie, "GET", `/sessions/fake%3A${id}`)).json();
			assert.equal(session.deleteBlockedReason, reason);
			assert.equal((await call(ownerCookie, "DELETE", `/sessions/fake%3A${id}`)).status, 409);
		}
		const batch = await call(ownerCookie, "POST", "/sessions/batch-delete", { body: { keys: ["fake:a", "fake:running", "fake:b", "fake:viewed", "fake:memory", "fake:a"] } });
		assert.deepEqual(await batch.json(), {
			deleted: ["fake:a", "fake:b"],
			skipped: [
				{ key: "fake:running", reason: "The agent is running" },
				{ key: "fake:viewed", reason: "Someone is viewing this session" },
				{ key: "fake:memory", reason: "Project memory is being updated" },
			],
		});
		finishRead();
		await archiving;
		assert.equal(store.session("fake:a"), undefined);
		assert.equal(store.session("fake:b")?.deleted, true);
		assert.equal((await call(ownerCookie, "GET", "/sessions/fake%3Ab")).status, 404);
		assert.ok(!(await recent(ownerCookie)).includes("fake:b"));
		assert.deepEqual(deleted, ["a", "b"]);
	} finally {
		finishRead();
		stream.abort();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
