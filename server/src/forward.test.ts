import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter, LiveSession, PromptInput, SessionEvent, SessionState } from "./harness/types.js";

/** A live session whose running flag the test flips; prompts are recorded and start a run. */
function fakeLive(id: string, cwd: string) {
	const listeners = new Set<(event: SessionEvent) => void>();
	const prompts: PromptInput[] = [];
	const state: SessionState = { messages: [], partial: null, toolOutputs: {}, runningTools: [], running: false, queue: { steering: [], followUp: [] }, dialogs: [], live: true };
	const setRunning = (running: boolean) => {
		state.running = running;
		for (const listener of listeners) listener({ type: "state", state });
	};
	const live = {
		id,
		cwd,
		state,
		viewers: 0,
		lastActivity: Date.now(),
		subscribe: (listener: (event: SessionEvent) => void) => (listeners.add(listener), () => listeners.delete(listener)),
		prompt: async (input: PromptInput) => {
			prompts.push(input);
			setRunning(true);
		},
	} as unknown as LiveSession;
	return { live, prompts, setRunning };
}

test("sharing a message into other sessions waits until both agents are idle", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-forward-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { sessionRoutes } = await import("./sessions.js");
	const { closeChats } = await import("./chats.js");
	loadStore();
	const owner = createUser("fwd-owner", "test-password", "member");
	const reader = createUser("fwd-reader", "test-password", "member");
	const lives = Object.fromEntries(["src", "idle", "busy", "ro"].map((id) => [id, fakeLive(id, dir)]));
	const adapter = {
		id: "fake",
		live: (id: string) => lives[id]?.live,
		liveSessions: () => Object.values(lives).map((l) => l.live),
		open: async (id: string) => lives[id].live,
	} as unknown as HarnessAdapter;
	const base = { harness: "fake", cwd: dir, updatedAt: "2026-01-01T00:00:00.000Z" };
	store.upsertSession({ ...base, key: "fake:src", id: "src", ownerId: owner.id, name: "Source" });
	store.upsertSession({ ...base, key: "fake:idle", id: "idle", ownerId: owner.id });
	store.upsertSession({ ...base, key: "fake:busy", id: "busy", ownerId: owner.id });
	store.upsertSession({ ...base, key: "fake:ro", id: "ro", ownerId: reader.id, visibility: "shared", shares: [{ userId: owner.id, access: "read" }] });

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}`;
	const res = await fetch(`${url}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: owner.username, password: "test-password" }) });
	const cookie = res.headers.get("set-cookie")!.split(";")[0];
	const call = (method: string, route: string, body?: unknown) =>
		fetch(`${url}${route}`, { method, headers: { Cookie: cookie, "X-Pi-Group": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
	try {
		const { chat } = await (await call("POST", "/chats", { text: "hello", userIds: [reader.id] })).json();
		const targets = ((await (await call("GET", "/sessions/targets")).json()).targets as { kind: string; id: string }[]).map((t) => `${t.kind}:${t.id}`).sort();
		assert.deepEqual(targets, [`chat:${chat}`, "session:fake:busy", "session:fake:idle", "session:fake:src"]);

		const session = (id: string) => ({ kind: "session", id });
		assert.equal((await call("POST", "/sessions/forward", { text: "hi", from: session("fake:src"), to: [session("fake:ro")] })).status, 403);

		lives.busy.setRunning(true);
		const shared = await (await call("POST", "/sessions/forward", { text: "The answer", from: session("fake:src"), to: [session("fake:idle"), session("fake:busy"), { kind: "chat", id: chat }] })).json();
		assert.deepEqual(shared, { shared: 3, waiting: 1 });
		const posted = (await (await call("GET", `/chats/${chat}`)).json()).messages.at(-1);
		assert.equal(posted.message.content[0].text, "Shared from session “Source”:\n\nThe answer");
		assert.equal(posted.message.author.id, owner.id);
		assert.deepEqual(lives.idle.prompts.map((p) => p.text), ["Shared from session “Source”:\n\nThe answer"]);
		assert.equal(lives.busy.prompts.length, 0);

		lives.busy.setRunning(false);
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(lives.busy.prompts.length, 1);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		saveNow();
		closeChats();
		rmSync(dir, { recursive: true, force: true });
	}
});
