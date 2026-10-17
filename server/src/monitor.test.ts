import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter, SessionState } from "./harness/types.js";

test("monitor reports visible live sessions with process memory; folder counts follow access", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-monitor-"));
	process.env.DATA_DIR = path.join(dir, "data");
	process.env.FS_ROOT = dir;
	mkdirSync(path.join(dir, "proj"));
	mkdirSync(path.join(dir, "other"));
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { sessionRoutes } = await import("./sessions.js");
	const { monitorRoutes } = await import("./monitor.js");
	loadStore();
	const owner = createUser("mon-owner", "test-password", "member");
	createUser("mon-other", "test-password", "member");

	const state: SessionState = { messages: [], partial: null, toolOutputs: {}, runningTools: [], running: true, queue: { steering: [], followUp: [] }, dialogs: [], live: true, name: "Busy" };
	const cwd = path.join(dir, "proj");
	const live = { id: "m1", cwd, state, viewers: 1, lastActivity: Date.now(), subscribe: () => () => {} };
	const adapter = {
		id: "fake",
		available: async () => ({ ok: true }),
		live: () => live,
		liveSessions: () => [live],
		listSessions: async (folder: string) => (folder === cwd ? [{ id: "m1", cwd, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 }] : []),
		// The test process stands in for a pi process.
		usage: async () => ({ pid: process.pid, storageBytes: 1234, tokens: { total: 5000 }, cost: 0.12 }),
	} as unknown as HarnessAdapter;
	store.upsertSession({ key: "fake:m1", harness: "fake", id: "m1", cwd, ownerId: owner.id });

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]), monitorRoutes([adapter]));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const get = async (username: string, url: string) => {
		const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		const res = await fetch(`${base}${url}`, { headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] } });
		return res.json();
	};
	try {
		const report = await get("mon-owner", "/monitor");
		assert.equal(report.sessions.length, 1);
		const [s] = report.sessions;
		assert.equal(s.name, "Busy");
		assert.equal(s.running, true);
		assert.equal(s.path, "proj");
		assert.equal(s.storageBytes, 1234);
		assert.equal(s.cost, 0.12);
		if (process.platform !== "win32") assert.ok(s.rssBytes > 0 && s.processes >= 1, "process memory is measured where /proc or ps exist");
		assert.ok(report.system.memTotal > report.system.memAvailable);
		assert.ok(report.server.rssBytes > 0);

		assert.deepEqual((await get("mon-other", "/monitor")).sessions, [], "sessions the caller cannot see are left out");

		assert.deepEqual((await get("mon-owner", "/sessions/counts?path=")).counts, { proj: { total: 1, running: 1 } });
		assert.deepEqual((await get("mon-other", "/sessions/counts?path=")).counts, {});
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
