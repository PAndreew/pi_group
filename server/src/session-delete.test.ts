import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { AgentMessage, HarnessAdapter, SessionState } from "./harness/types.js";

test("people delete their own prompts; while the agent runs the deletion waits for the run to end", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-delete-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { registerPrompt } = await import("./authorship.js");
	const { sessionRoutes } = await import("./sessions.js");
	loadStore();
	const anna = createUser("delete-anna", "test-password", "member");
	const bob = createUser("delete-bob", "test-password", "member");

	const text = (t: string) => [{ type: "text", text: t }];
	const history: AgentMessage[] = [
		{ role: "user", content: text("first question"), timestamp: 1 },
		{ role: "assistant", content: text("first answer"), timestamp: 2 },
		{ role: "user", content: text("my password is hunter2"), timestamp: 3 },
		{ role: "assistant", content: text("noted"), timestamp: 4 },
		{ role: "user", content: text("bob was here"), timestamp: 5 },
	];
	const ledger = { authors: {}, pending: [] };
	registerPrompt(ledger, [], { text: "first question" }, { id: anna.id, username: anna.username });
	registerPrompt(ledger, [], { text: "my password is hunter2" }, { id: anna.id, username: anna.username });
	registerPrompt(ledger, [], { text: "bob was here" }, { id: bob.id, username: bob.username });
	store.upsertSession({ harness: "fake", cwd: dir, key: "fake:s", id: "s", ownerId: anna.id, visibility: "shared", shares: [{ userId: bob.id, access: "write" }], authorship: ledger });

	const state: SessionState = { messages: history, partial: null, toolOutputs: {}, runningTools: [], running: true, queue: { steering: [], followUp: [] }, dialogs: [], live: true };
	let open = true;
	const live = { id: "s", cwd: dir, state, viewers: 0, lastActivity: Date.now(), subscribe: (listener: (event: unknown) => void) => (listener({ type: "state", state }), () => {}), close: async () => void (open = false) };
	const adapter = {
		id: "fake",
		label: "fake",
		live: () => (open ? live : undefined),
		liveSessions: () => (open ? [live] : []),
		readSession: async () => ({ messages: history }),
		deleteMessage: async (_id: string, _cwd: string, index: number) => void history.splice(index, 1),
	} as unknown as HarnessAdapter;

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]));
	app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		res.status(error.status ?? 500).json({ error: error.message });
	});
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}`;
	const login = async (username: string) => {
		const res = await fetch(`${url}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		return res.headers.get("set-cookie")!.split(";")[0];
	};
	const remove = async (cookie: string, body: unknown) => {
		const res = await fetch(`${url}/sessions/fake%3As/messages/delete`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "X-Pi-Group": "1" }, body: JSON.stringify(body) });
		return { status: res.status, body: await res.json() };
	};
	try {
		const annaCookie = await login(anna.username);
		const bobCookie = await login(bob.username);
		assert.equal((await remove(bobCookie, { index: 2, timestamp: 3, expect: "my password is hunter2" })).status, 403, "only the author deletes");
		assert.equal((await remove(annaCookie, { index: 4, timestamp: 5, expect: "bob was here" })).status, 403);
		assert.equal((await remove(annaCookie, { index: 2, timestamp: 3, expect: "something else" })).status, 409);

		const queued = await remove(annaCookie, { index: 2, timestamp: 3, expect: "my password is hunter2" });
		assert.deepEqual(queued.body, { queued: true });
		assert.equal(history.length, 5, "nothing changes while the agent runs");
		assert.equal(store.session("fake:s")!.pendingDeletes?.length, 1);

		state.running = false;
		const deadline = Date.now() + 10_000;
		while (store.session("fake:s")!.pendingDeletes?.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
		assert.deepEqual(history.map((m) => (m.content as { text: string }[])[0].text), ["first question", "first answer", "noted", "bob was here"]);
		assert.equal(store.session("fake:s")!.pendingDeletes, undefined);

		// Idle: deleted at once, and authors stay attached to the remaining prompts.
		assert.deepEqual((await remove(bobCookie, { index: 3, timestamp: 5, expect: "bob was here" })).body, { queued: false });
		assert.deepEqual((await remove(annaCookie, { index: 0, timestamp: 1, expect: "first question" })).body, { queued: false });
		assert.deepEqual(history.map((m) => m.role), ["assistant", "assistant"]);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
