import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { HarnessAdapter, ModelInfo } from "./harness/types.js";

test("first prompt gets an automatic title using its personal Pi profile", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-title-test-"));
	const piBin = path.join(dir, "pi.mjs");
	process.env.DATA_DIR = process.env.FS_ROOT = dir;
	process.env.PI_BIN = piBin;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { sessionRoutes } = await import("./sessions.js");
	const { savePiKey, piProfile } = await import("./pi-profiles.js");
	loadStore();
	const user = createUser("test-owner", "test-password", "member");
	const model = { provider: "personal-test", id: "test-model", name: "Test model" } as ModelInfo;
	user.sessionDefaults = { harness: "pi", model, thinkingLevel: "off", autoTitle: true };
	await savePiKey(user.id, model.provider, "fixture-key");
	writeFileSync(piBin, `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.equal(process.env.PI_CODING_AGENT_DIR, ${JSON.stringify(await piProfile(user.id))});
assert.ok(process.argv.includes('--no-session') && process.argv.includes('-nt') && process.argv.includes('-ne'));
assert.ok(process.argv.includes('personal-test/test-model'));
assert.equal(readFileSync('conversation.txt', 'utf8'), 'Find the lost recipe');
console.log('Find the lost recipe');
`);
	const state = { model, live: true, running: false, messages: [], name: undefined as string | undefined };
	const live = { state, authProfile: await piProfile(user.id), lastActivity: Date.now(), subscribe: () => () => {}, prompt: async () => {}, setName: async (name: string) => { state.name = name; } };
	const adapter = { id: "pi", open: async () => live, live: () => live, listModels: async () => [model], liveSessions: () => [] } as unknown as HarnessAdapter;
	store.upsertSession({ key: "pi:test", id: "test", harness: "pi", cwd: dir, ownerId: user.id });
	const app = express();
	app.use(express.json(), authenticate, authRoutes(), sessionRoutes([adapter]));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	try {
		const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user.username, password: "test-password" }) });
		const headers = { Cookie: login.headers.get("set-cookie")!.split(";")[0], "Content-Type": "application/json", "X-Pi-Group": "1" };
		const endpoint = `${base}/sessions/pi%3Atest`;
		const prompt = await fetch(`${endpoint}/prompt`, { method: "POST", headers, body: JSON.stringify({ text: "Find the lost recipe" }) });
		assert.equal(prompt.status, 200);
		const deadline = Date.now() + 2000;
		let name: string | undefined;
		while (!name && Date.now() < deadline) {
			const response = await fetch(endpoint, { headers });
			assert.equal(response.status, 200);
			name = (await response.json()).session.name;
			if (!name) await new Promise(resolve => setTimeout(resolve, 25));
		}
		assert.equal(name, "Find the lost recipe");
	} finally {
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
