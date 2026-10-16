import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter, SessionEvent, SessionState } from "./harness/types.js";

/** Reads server-sent `data:` events from a fetch response body. */
async function* events(res: Response) {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of res.body!) {
		buffer += decoder.decode(chunk, { stream: true });
		let index: number;
		while ((index = buffer.indexOf("\n\n")) >= 0) {
			const frame = buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
			const data = frame.split("\n").find((line) => line.startsWith("data: "));
			if (data) yield JSON.parse(data.slice(6));
		}
	}
}

test("run outcomes reach involved users only; aborted runs stay quiet", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-notify-"));
	process.env.DATA_DIR = dir;
	process.env.FS_ROOT = dir;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { sessionRoutes } = await import("./sessions.js");
	loadStore();
	const owner = createUser("notify-owner", "test-password", "member");
	createUser("notify-other", "test-password", "member");

	const state: SessionState = { messages: [], partial: null, toolOutputs: {}, runningTools: [], running: false, queue: { steering: [], followUp: [] }, dialogs: [], live: true };
	let listener: ((event: SessionEvent) => void) | undefined;
	const live = { id: "n1", cwd: dir, state, viewers: 0, lastActivity: Date.now(), subscribe: (l: typeof listener) => ((listener = l), l!({ type: "state", state }), () => {}) };
	const adapter = { id: "fake", live: () => live, liveSessions: () => [live] } as unknown as HarnessAdapter;
	store.upsertSession({ key: "fake:n1", harness: "fake", id: "n1", cwd: dir, ownerId: owner.id, name: "Notify me" });

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}`;
	const stream = async (username: string) => {
		const login = await fetch(`${url}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		const cookie = login.headers.get("set-cookie")!.split(";")[0];
		return fetch(`${url}/notifications`, { headers: { Cookie: cookie } });
	};
	const status = (running: boolean) => {
		const { messages: _m, partial: _p, toolOutputs: _t, ...rest } = state;
		listener!({ type: "status", status: { ...rest, running } });
	};
	try {
		const ownerEvents = events(await stream(owner.username));
		const otherRes = await stream("notify-other");
		const otherSeen: unknown[] = [];
		void (async () => {
			for await (const event of events(otherRes)) otherSeen.push(event);
		})().catch(() => {});

		// The 5 s sweep attaches the hub to live sessions nobody has opened.
		while (!listener) await new Promise((r) => setTimeout(r, 200));

		state.running = true;
		status(true);
		state.messages.push({ role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "aborted" });
		state.running = false;
		status(false);

		state.running = true;
		status(true);
		state.messages.push({ role: "assistant", content: [{ type: "text", text: "**All tests pass.**\n\n```\nok 12\n```" }], stopReason: "stop" });
		state.running = false;
		status(false);

		const first = (await ownerEvents.next()).value;
		assert.deepEqual(first, { type: "run", kind: "finished", key: "fake:n1", path: "", name: "Notify me", text: "All tests pass. [code]" });

		state.running = true;
		status(true);
		state.notice = { level: "error", text: "rate limited" };
		state.running = false;
		status(false);
		assert.equal((await ownerEvents.next()).value.kind, "error");

		await new Promise((r) => setTimeout(r, 300));
		assert.deepEqual(otherSeen, []);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
