import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

test("defaults require authentication, are scoped to the account and persist", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-preferences-"));
	process.env.DATA_DIR = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	loadStore();
	const first = createUser("test-first", "test-password", "member");
	const second = createUser("test-second", "test-password", "member");
	const app = express();
	app.use(express.json(), authenticate, authRoutes());
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const defaults = { harness: "pi", model: { provider: "openai-codex", id: "gpt-6.1-sol" }, thinkingLevel: "medium" };
	try {
		const unauthorized = await fetch(`${base}/auth/defaults`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Pi-Group": "1" }, body: JSON.stringify(defaults) });
		assert.equal(unauthorized.status, 401);
		const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: first.username, password: "test-password" }) });
		assert.equal(login.status, 200);
		const cookie = login.headers.get("set-cookie")!.split(";")[0];
		const saved = await fetch(`${base}/auth/defaults`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Pi-Group": "1" }, body: JSON.stringify(defaults) });
		assert.equal(saved.status, 200);
		const body = await saved.json();
		assert.deepEqual(body.user.sessionDefaults, defaults);
		assert.equal(body.user.passwordHash, undefined);
		assert.equal(second.sessionDefaults, undefined);
		saveNow();
		loadStore();
		assert.deepEqual(store.userById(first.id)?.sessionDefaults, defaults);
		const me = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
		assert.deepEqual((await me.json()).user.sessionDefaults, defaults);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
