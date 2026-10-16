import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { WebSocket } from "ws";

test("terminal: admins only, same origin only, and a working shell in the session folder", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-terminal-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	if (process.platform === "win32") process.env.SHELL = "cmd.exe";
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { attachTerminal } = await import("./terminal.js");
	loadStore();
	const admin = createUser("term-admin", "test-password", "admin");
	createUser("term-member", "test-password", "member");
	store.upsertSession({ key: "fake:t1", harness: "fake", id: "t1", cwd: dir, ownerId: admin.id });

	const app = express();
	app.use(express.json(), authenticate, authRoutes());
	const server = app.listen(0, "127.0.0.1");
	attachTerminal(server);
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const host = `127.0.0.1:${address.port}`;
	const login = async (username: string) => {
		const res = await fetch(`http://${host}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		return res.headers.get("set-cookie")!.split(";")[0];
	};
	/** Resolves with the HTTP status of a refused upgrade, or the open socket. */
	const connect = (headers: Record<string, string>) =>
		new Promise<number | WebSocket>((resolve) => {
			const ws = new WebSocket(`ws://${host}/api/terminal?key=fake:t1&cols=100&rows=30`, { headers });
			ws.on("open", () => resolve(ws));
			ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
			ws.on("error", () => resolve(0));
		});
	try {
		const adminCookie = await login("term-admin");
		assert.equal(await connect({ Origin: `http://${host}` }), 401);
		assert.equal(await connect({ Cookie: await login("term-member"), Origin: `http://${host}` }), 403);
		assert.equal(await connect({ Cookie: adminCookie, Origin: "http://evil.example" }), 403);
		assert.equal(await connect({ Cookie: adminCookie }), 403);

		const ws = await connect({ Cookie: adminCookie, Origin: `http://${host}` });
		assert.ok(ws instanceof WebSocket);
		let output = "";
		ws.on("message", (data) => (output += String(data)));
		ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
		ws.send(JSON.stringify({ type: "input", data: "echo term-$((6*7))-ok\r" }));
		if (process.platform === "win32") ws.send(JSON.stringify({ type: "input", data: "echo term-42-ok\r" }));
		const deadline = Date.now() + 15_000;
		while (!output.includes("term-42-ok") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
		assert.match(output, /term-42-ok/);
		const closed = once(ws, "close");
		ws.send(JSON.stringify({ type: "input", data: "exit\r" }));
		await closed;
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
