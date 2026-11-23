import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

test("a login that is used slides forward, at most once a day", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-renew-"));
	process.env.DATA_DIR = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { config } = await import("./config.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	loadStore();
	const user = createUser("renew-user", "test-password", "member");
	const app = express();
	app.use(express.json(), authenticate, authRoutes());
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const ttl = config.loginTtlDays * 86400_000;
	try {
		const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user.username, password: "test-password" }) });
		const cookie = login.headers.get("set-cookie")!.split(";")[0];
		const record = store.data.logins.find((l) => l.userId === user.id)!;

		// Fresh login: no renewal, no new cookie.
		const fresh = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
		assert.equal(fresh.status, 200);
		assert.equal(fresh.headers.get("set-cookie"), null);

		// Two days left: renewed to the full TTL with a fresh cookie.
		record.expiresAt = Date.now() + 2 * 86400_000;
		const old = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
		assert.equal(old.status, 200);
		assert.match(old.headers.get("set-cookie") ?? "", new RegExp(`Max-Age=${ttl / 1000}`));
		assert.ok(record.expiresAt > Date.now() + ttl - 60_000);

		// Expired: stays expired.
		record.expiresAt = Date.now() - 1;
		assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } })).status, 401);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
