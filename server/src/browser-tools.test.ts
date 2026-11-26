import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { WebSocket } from "ws";

const executable = process.env.BROWSER_EXECUTABLE || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(existsSync);

const FIXTURE = `<!doctype html><style>body{margin:0;font:16px sans-serif}</style>
<input id="name" style="position:absolute;left:20px;top:20px;width:200px;height:30px">
<select id="color" style="position:absolute;left:20px;top:80px"><option value="r">Red</option><option value="g">Green</option></select>
<button id="copy" style="position:absolute;left:20px;top:130px;width:120px;height:30px" onclick="navigator.clipboard.writeText('from the page'); console.error('copied!')">Copy</button>
<p id="para" style="position:absolute;left:20px;top:200px">Select me please</p>
<div id="hover" style="position:absolute;left:300px;top:20px;width:80px;height:30px" onmouseenter="this.textContent='hovered'">hover</div>
<div style="height:4000px"></div>
<p id="late" hidden>Late text</p>
<script>setTimeout(() => (document.getElementById("late").hidden = false), 300); fetch("/missing")</script>`;

test("agent browser tools, keyboard hints and the clipboard bridge", { skip: !executable && "no browser installed", timeout: 30_000 }, async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-browser-tools-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	process.env.BROWSER_EXECUTABLE = executable!;
	const { attachBrowser, browserRoutes, closeBrowsers } = await import("./browser.js");
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { interactionEnvironment } = await import("./interactions.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	loadStore();
	const admin = createUser("tools-admin", "test-password", "admin");
	const key = "fake:tools";
	store.upsertSession({ key, harness: "fake", id: "tools", cwd: dir, ownerId: admin.id });
	const app = express();
	app.get("/fixture", (_req, res) => res.send(FIXTURE));
	app.get("/second", (_req, res) => res.send("<title>Second</title><p>Second page</p>"));
	app.use(express.json(), authenticate, authRoutes());
	app.use("/api", browserRoutes());
	app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ error: error.message }));
	const server = app.listen(0, "127.0.0.1");
	attachBrowser(server);
	let socket: WebSocket | undefined;
	try {
		await once(server, "listening");
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		const origin = `http://127.0.0.1:${address.port}`;
		const token = interactionEnvironment(key).BEEZY_INTERACTION_TOKEN;
		const call = async (body: object) => {
			const response = await fetch(`${origin}/api/browser-bridge/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error);
			return result;
		};

		await call({ action: "open", url: `${origin}/fixture` });
		assert.equal((await call({ action: "scroll", dy: 500 })).scrollY, 500);
		assert.equal((await call({ action: "scroll", to: "top" })).scrollY, 0);
		assert.ok((await call({ action: "scroll", to: "bottom" })).scrollY > 3000);
		await call({ action: "scroll", selector: "#name" });
		await call({ action: "wait", text: "Late text" });
		await call({ action: "type", selector: "#name", text: "Ada" });
		await call({ action: "type", selector: "#name", text: " Lovelace", append: true });
		await call({ action: "press", selector: "#name", key: "Shift+Home" });
		await call({ action: "press", key: "Backspace" });
		assert.equal((await call({ action: "evaluate", expression: "document.querySelector('#name').value" })).result, "");
		assert.deepEqual((await call({ action: "select", selector: "#color", values: ["Green"] })).selected, ["g"]);
		await call({ action: "hover", selector: "#hover" });
		assert.equal((await call({ action: "evaluate", expression: "(async () => ({ text: document.querySelector('#hover').textContent }))()" })).result, '{\n  "text": "hovered"\n}');
		await call({ action: "click", selector: "#copy" });
		const log = (await call({ action: "console", errorsOnly: true })).entries.map((e: { text: string }) => e.text).join("\n");
		assert.match(log, /copied!/);
		assert.match(log, /\/missing → 404/);
		assert.equal((await call({ action: "console", clear: true })).entries.length > 0, true);
		assert.equal((await call({ action: "console" })).entries.length, 0);
		assert.match((await call({ action: "snapshot", selector: "#para" })).snapshot, /Select me please/);
		await call({ action: "open", url: `${origin}/second` });
		assert.equal((await call({ action: "history", go: "back" })).url, `${origin}/fixture`);
		assert.equal((await call({ action: "history", go: "forward" })).title, "Second");
		await call({ action: "history", go: "back" });
		await assert.rejects(call({ action: "evaluate", expression: "new Promise(() => {})" }), /10 seconds/);

		// A viewer: where the fields are, what has focus, and the clipboard both ways.
		const login = await fetch(`${origin}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "tools-admin", password: "test-password" }) });
		socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/browser?key=${key}`, { headers: { Origin: origin, Cookie: login.headers.get("set-cookie")!.split(";")[0] } });
		const ws = socket;
		const next = <T extends { type: string }>(match: (m: T) => boolean) => new Promise<T>((resolve, reject) => {
			const onMessage = (data: Buffer, binary: boolean) => {
				if (binary) return;
				const message = JSON.parse(data.toString());
				if (!match(message)) return;
				clearTimeout(timer);
				ws.off("message", onMessage);
				resolve(message);
			};
			const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error("Timed out")); }, 5000);
			ws.on("message", onMessage);
		});
		const send = (message: object) => ws.send(JSON.stringify(message));
		type Boxes = { type: string; boxes: { x: number; y: number }[] };
		const editables = await next<Boxes>((m) => m.type === "editables" && m.boxes.length > 0);
		assert.deepEqual(editables.boxes.map((b) => [b.x, b.y]), [[20, 20]]);

		type Focus = { type: string; editable: boolean; box?: { x: number } };
		const focused = next<Focus>((m) => m.type === "focus" && m.editable);
		send({ type: "mouse", action: "down", x: 60, y: 35, buttons: 1 });
		send({ type: "mouse", action: "up", x: 60, y: 35, buttons: 0 });
		assert.equal((await focused).box?.x, 20);
		send({ type: "text", text: "hello world" });
		send({ type: "press", key: "Shift+Home" });
		const copied = next<{ type: string; id: string; text: string }>((m) => m.type === "copied");
		send({ type: "copy", id: "c1" });
		assert.equal((await copied).text, "hello world");
		const cut = next<{ type: string; text: string }>((m) => m.type === "copied");
		send({ type: "copy", id: "c2", cut: true });
		assert.equal((await cut).text, "hello world");
		assert.equal((await call({ action: "evaluate", expression: "document.querySelector('#name').value" })).result, "", "cut removes the text");

		// Off the field: the click is followed by a report that nothing editable has focus.
		const blurred = next<Focus>((m) => m.type === "focus" && !m.editable);
		send({ type: "mouse", action: "down", x: 600, y: 600, buttons: 1 });
		send({ type: "mouse", action: "up", x: 600, y: 600, buttons: 0 });
		await blurred;

		// A copy button in the page goes to the viewer who clicked it.
		const fromPage = next<{ type: string; text: string }>((m) => m.type === "clipboard");
		send({ type: "mouse", action: "down", x: 60, y: 145, buttons: 1 });
		send({ type: "mouse", action: "up", x: 60, y: 145, buttons: 0 });
		assert.equal((await fromPage).text, "from the page");

		const failed = next<{ type: string; message: string }>((m) => m.type === "error");
		send({ type: "copy", id: "c3" });
		assert.match((await failed).message, /Select text/);
	} finally {
		socket?.terminate();
		await closeBrowsers();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
