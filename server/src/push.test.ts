import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

test("push subscriptions are per device, scoped to the caller and keep a stable server key", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-push-"));
	process.env.DATA_DIR = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { pushRoutes } = await import("./push.js");
	loadStore();
	const first = createUser("push-first", "test-password", "member");
	const second = createUser("push-second", "test-password", "member");
	const app = express();
	app.use(express.json(), authenticate, authRoutes(), pushRoutes());
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const login = async (username: string) => {
		const res = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		return res.headers.get("set-cookie")!.split(";")[0];
	};
	const post = (cookie: string, url: string, body: unknown) =>
		fetch(`${base}${url}`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Pi-Group": "1" }, body: JSON.stringify(body) });
	const device = { endpoint: "https://push.example.com/send/abc", keys: { p256dh: "BPublicKey", auth: "secret" } };
	try {
		assert.equal((await fetch(`${base}/push/key`)).status, 401);
		const firstCookie = await login(first.username);
		const secondCookie = await login(second.username);

		const key = (await (await fetch(`${base}/push/key`, { headers: { Cookie: firstCookie } })).json()).publicKey;
		assert.match(key, /^[A-Za-z0-9_-]{80,}$/);
		assert.ok(existsSync(path.join(dir, "vapid.json")));

		assert.notEqual((await post(firstCookie, "/push/subscribe", { endpoint: "http://127.0.0.1:22/", keys: device.keys })).status, 200);
		assert.equal(store.data.pushSubscriptions.length, 0);
		assert.equal((await post(firstCookie, "/push/subscribe", device)).status, 200);
		assert.equal((await post(firstCookie, "/push/subscribe", device)).status, 200);
		assert.deepEqual(store.data.pushSubscriptions.map((s) => s.userId), [first.id]);

		// Someone else cannot remove my device; signing in as them on it moves it over.
		await post(secondCookie, "/push/unsubscribe", { endpoint: device.endpoint });
		assert.equal(store.data.pushSubscriptions.length, 1);
		await post(secondCookie, "/push/subscribe", device);
		assert.deepEqual(store.data.pushSubscriptions.map((s) => s.userId), [second.id]);

		await post(secondCookie, "/push/unsubscribe", { endpoint: device.endpoint });
		assert.deepEqual(store.data.pushSubscriptions, []);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
