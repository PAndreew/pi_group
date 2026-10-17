import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter, PromptInput, SessionEvent, SessionState } from "./harness/types.js";

/** A harness whose sessions answer every prompt with "reply to <id>" after a moment. */
function fakeHarness() {
	const sessions = new Map<string, any>();
	const prompts: { id: string; cwd: string; text: string }[] = [];
	let n = 0;
	const create = async (cwd: string) => {
		const id = `f${++n}`;
		const state: SessionState = { messages: [], partial: null, toolOutputs: {}, runningTools: [], running: false, queue: { steering: [], followUp: [] }, dialogs: [], live: true };
		let listener: ((event: SessionEvent) => void) | undefined;
		const status = () => {
			const { messages: _m, partial: _p, toolOutputs: _t, ...rest } = state;
			listener?.({ type: "status", status: rest });
		};
		const live = {
			id,
			cwd,
			state,
			viewers: 0,
			lastActivity: Date.now(),
			subscribe: (l: (event: SessionEvent) => void) => ((listener = l), l({ type: "state", state }), () => {}),
			prompt: async (input: PromptInput) => {
				prompts.push({ id, cwd, text: input.text });
				state.messages.push({ role: "user", content: [{ type: "text", text: input.text }] });
				state.running = true;
				status();
				setTimeout(() => {
					state.messages.push({ role: "assistant", content: [{ type: "text", text: `reply to ${id}` }], stopReason: "stop" });
					state.running = false;
					status();
				}, 30);
			},
			close: async () => {},
		};
		sessions.set(id, live);
		return live;
	};
	const adapter = {
		id: "pi",
		available: async () => ({ ok: true }),
		create,
		live: (id: string) => sessions.get(id),
		liveSessions: () => [...sessions.values()],
		open: async (id: string) => sessions.get(id),
		listSessions: async () => [],
		readSession: async (id: string) => ({ messages: sessions.get(id)?.state.messages ?? [] }),
	} as unknown as HarnessAdapter;
	return { adapter, prompts };
}

const until = async (check: () => Promise<boolean> | boolean, what: string) => {
	const deadline = Date.now() + 10_000;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 50));
	}
};

test("chats: people talk, @pi joins with context and replies, pi-only chats are sessions, memory consolidates", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-chats-"));
	process.env.DATA_DIR = path.join(dir, "data");
	process.env.FS_ROOT = dir;
	mkdirSync(path.join(dir, "projects", "api-server"), { recursive: true });
	mkdirSync(path.join(dir, "projects", "web"), { recursive: true });
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { sessionRoutes } = await import("./sessions.js");
	const { config } = await import("./config.js");
	loadStore();
	const admin = createUser("chat-admin", "test-password", "admin");
	const anna = createUser("anna", "test-password", "member");
	const bob = createUser("bob", "test-password", "member");
	createUser("carol", "test-password", "member");
	const { adapter, prompts } = fakeHarness();

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]));
	app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => void res.status(error.status ?? 500).json({ error: error.message }));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const cookies = new Map<string, string>();
	const call = async (username: string, method: string, url: string, body?: unknown) => {
		if (!cookies.has(username)) {
			const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
			cookies.set(username, login.headers.get("set-cookie")!.split(";")[0]);
		}
		const res = await fetch(`${base}${url}`, { method, headers: { Cookie: cookies.get(username)!, "Content-Type": "application/json", "X-Pi-Group": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
		return { status: res.status, body: await res.json() };
	};
	try {
		// A human chat: no pi yet.
		const created = await call("anna", "POST", "/chats", { text: "hello bob, the deploy failed", userIds: [bob.id] });
		assert.equal(created.status, 200);
		const chatId = created.body.chat;
		const bobList = await call("bob", "GET", "/chats");
		const item = bobList.body.chats.find((c: any) => c.id === chatId);
		assert.equal(item.title, "anna");
		assert.equal(item.unread, 1);
		assert.equal(item.last.text, "hello bob, the deploy failed");
		assert.equal(prompts.length, 0, "a chat between people does not start pi");
		assert.equal((await call("carol", "GET", `/chats/${chatId}`)).status, 404, "non-members cannot read a chat");

		// Bob asks pi: it gets the conversation so far, and its reply lands in the chat.
		await call("bob", "POST", `/chats/${chatId}/messages`, { text: "@pi can you look at the logs?" });
		await until(async () => (await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "done"), "pi's reply");
		const chat = (await call("anna", "GET", `/chats/${chatId}`)).body;
		const reply = chat.messages.find((m: any) => m.status === "done");
		assert.equal(reply.message.role, "assistant");
		assert.equal(reply.message.content[0].text, "reply to f1");
		assert.match(prompts[0].text, /group chat with anna, bob/);
		assert.match(prompts[0].text, /anna: hello bob, the deploy failed\n\nbob: @pi can you look at the logs\?/);
		assert.equal(prompts[0].cwd, config.chatFolder, "without #folder pi works in the shared chat folder");
		assert.ok(existsSync(path.join(config.chatFolder, "AGENTS.md")), "the chat folder points pi at the memory");
		const meta = store.session(chat.chat.sessionKey)!;
		assert.equal(meta.ownerId, bob.id);
		assert.deepEqual(meta.shares, [{ userId: anna.id, access: "write" }], "chat members can follow pi's session");
		assert.equal(chat.chat.title, "bob, pi");

		// The next mention only carries what was said since pi's last turn.
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "thanks! @pi also check the cron job" });
		await until(() => prompts.length === 2, "second prompt");
		assert.equal(prompts[1].text, "anna: thanks! @pi also check the cron job");
		assert.ok(!(await call("anna", "GET", "/chats")).body.chats.some((c: any) => c.kind === "session" && c.id === meta.key), "a chat's session is not listed twice");

		// Only @pi: a plain session, in the chosen folder.
		const solo = await call("anna", "POST", "/chats", { text: "summarise the API", pi: true, folder: "projects/api-server" });
		assert.ok(solo.body.session);
		assert.equal(store.session(solo.body.session)!.cwd, path.join(dir, "projects", "api-server"));
		const annaList = (await call("anna", "GET", "/chats")).body.chats;
		assert.ok(annaList.some((c: any) => c.kind === "session" && c.id === solo.body.session && c.folder === "projects/api-server"));

		// Fuzzy #folder search.
		const found = await call("anna", "GET", "/folders/search?q=apisrv");
		assert.equal(found.body.folders[0], "projects/api-server");

		// Memory: an admin can consolidate everything now; the master session gets one prompt per conversation.
		await until(async () => !(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "pi to finish");
		assert.equal((await call("anna", "POST", "/memory/consolidate", { all: true })).status, 403);
		const started = await call("chat-admin", "POST", "/memory/consolidate", { all: true });
		assert.equal(started.body.started, true);
		await until(async () => Boolean((await call("chat-admin", "GET", "/memory")).body.lastRun), "consolidation");
		const status = (await call("chat-admin", "GET", "/memory")).body;
		assert.equal(status.lastRun.error, undefined);
		const master = store.session(status.sessionKey)!;
		assert.equal(master.memory, true);
		assert.equal(master.ownerId, admin.id);
		const memoryPrompts = prompts.filter((p) => p.text.startsWith("Consolidate"));
		assert.ok(memoryPrompts.some((p) => /anna: hello bob, the deploy failed/.test(p.text) && /pi: reply to f1/.test(p.text)));
		const again = await call("chat-admin", "POST", "/memory/consolidate", { all: true });
		assert.equal(again.body.pending, 0, "consolidated conversations are not repeated");
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		(await import("./chats.js")).closeChats();
		rmSync(dir, { recursive: true, force: true });
	}
});
