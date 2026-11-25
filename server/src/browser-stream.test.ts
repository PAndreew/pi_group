import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { WebSocket } from "ws";

const executable = process.env.BROWSER_EXECUTABLE || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);

test("shared browser streams sharp frames and hands viewport control to the next editor", { skip: !executable && "no browser installed", timeout: 15_000 }, async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-browser-stream-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	process.env.BROWSER_EXECUTABLE = executable!;
	const { attachBrowser, closeBrowsers } = await import("./browser.js");
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	loadStore();
	const admin = createUser("browser-admin", "test-password", "admin");
	store.upsertSession({ key: "fake:browser", harness: "fake", id: "browser", cwd: dir, ownerId: admin.id });
	const app = express();
	app.use(express.json(), authenticate, authRoutes());
	app.get("/fixture", (_req, res) => res.send(`<style>body{margin:0}main{height:800px;background:#9f9}@media(max-width:600px){main{background:#9cf}}</style><main><button id="target" style="position:absolute;top:450px;left:250px" onclick="this.textContent='Clicked'">Click me</button></main>`));
	const server = app.listen(0, "127.0.0.1");
	attachBrowser(server);
	const sockets: WebSocket[] = [];
	try {
		await once(server, "listening");
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		const host = `127.0.0.1:${address.port}`;
		const origin = `http://${host}`;
		const login = await fetch(`${origin}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "browser-admin", password: "test-password" }) });
		const headers = { Origin: origin, Cookie: login.headers.get("set-cookie")!.split(";")[0] };
		type State = { type: string; canResize?: boolean; viewport?: { width: number; height: number } };
		const connect = () => {
			const socket = new WebSocket(`ws://${host}/api/browser?key=fake:browser`, { headers });
			sockets.push(socket);
			const next = <T>(binary: boolean, match: (value: T) => boolean = () => true) => new Promise<T>((resolve, reject) => {
				const onMessage = (data: Buffer, isBinary: boolean) => {
					if (isBinary !== binary) return;
					const value = binary ? data : JSON.parse(data.toString());
					if (!match(value)) return;
					cleanup();
					resolve(value);
				};
				const cleanup = () => { clearTimeout(timer); socket.off("message", onMessage); };
				const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${binary ? "frame" : "state"}`)); }, 4000);
				socket.on("message", onMessage);
			});
			return { socket, next, send: (message: object) => socket.send(JSON.stringify(message)) };
		};
		const phone = connect();
		const [initial, initialFrame] = await Promise.all([phone.next<State>(false, (m) => m.type === "state"), phone.next<Buffer>(true)]);
		assert.deepEqual(dimensions(initialFrame), [2560, 1600]);
		assert.equal(initial.canResize, true);
		const loaded = phone.next<Buffer>(true);
		phone.send({ type: "navigate", url: `${origin}/fixture` });
		await loaded;
		const resized = phone.next<State>(false, (m) => m.viewport?.width === 390);
		const frame = phone.next<Buffer>(true, (jpg) => dimensions(jpg)[0] === 780);
		phone.send({ type: "viewport", width: 390, height: 650 });
		const [, jpeg] = await Promise.all([resized, frame]);
		assert.deepEqual(dimensions(jpeg), [780, 1300]);

		// Input and element picking still use CSS coordinates, not the larger frame's pixels.
		const picked = phone.next<{ type: string; elements: { text: string }[]; image?: string }>(false, (m) => m.type === "picked");
		const point = { x: 275, y: 460 };
		phone.send({ type: "mouse", action: "down", ...point, buttons: 1 });
		phone.send({ type: "mouse", action: "up", ...point, buttons: 0 });
		phone.send({ type: "pick", id: "target", ...point });
		const result = await picked;
		assert.equal(result.elements[0]?.text, "Clicked");
		assert.ok(result.image);

		const desktop = connect();
		assert.equal((await desktop.next<State>(false, (m) => m.type === "state")).canResize, false);
		desktop.send({ type: "viewport", width: 1280, height: 800 });
		const promotes = desktop.next<State>(false, (m) => m.canResize === true);
		phone.socket.close();
		await promotes;
		const desktopState = desktop.next<State>(false, (m) => m.viewport?.width === 1280);
		desktop.send({ type: "viewport", width: 1280, height: 800 });
		await desktopState;
	} finally {
		for (const socket of sockets) socket.terminate();
		await closeBrowsers();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});

// Chromium JPEGs use a baseline SOF marker (C0), which stores height and width.
function dimensions(frame: Buffer) {
	for (let i = 2; i + 9 < frame.length;) {
		if (frame[i] !== 0xff || frame[i + 1] === 0xda) break;
		if (frame[i + 1] === 0xc0) return [frame.readUInt16BE(i + 7), frame.readUInt16BE(i + 5)];
		i += 2 + frame.readUInt16BE(i + 2);
	}
	throw new Error("Missing JPEG dimensions");
}
