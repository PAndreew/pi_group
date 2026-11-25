import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { gunzipSync } from "node:zlib";
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
				assert.equal(state.running, false, "chat prompts must wait for the active turn");
				prompts.push({ id, cwd, text: input.text });
				if (input.text.startsWith("[beezy: project memory sync]")) {
					// The sync session updates memory through its tool, from the digest in its prompt.
					const { projectMemoryUpdate } = await import("./memory.js");
					const meta = (await import("./store.js")).store.session(`pi:${id}`);
					projectMemoryUpdate(meta, { action: "write", topic: "deploy", title: "Deploy", description: "Deploy decisions", body: `Deploy decisions are recorded here, from ${meta!.key}.` });
					projectMemoryUpdate(meta, { action: "overview", body: "Beezy API server; deploys go through the deploy topic." });
				}
				state.messages.push({ role: "user", content: [{ type: "text", text: input.text }], timestamp: Date.now() });
				state.running = true;
				status();
				setTimeout(() => {
					state.messages.push({ role: "assistant", content: [{ type: "text", text: `reply to ${id}` }, { type: "thinking", thinking: "secret-reasoning" }], stopReason: "stop", timestamp: Date.now() });
					state.running = false;
					status();
				}, 100);
			},
			setModel: async () => {},
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
		listModels: async () => [{ provider: "test", id: "cheap", name: "Cheap" }],
		readSession: async (id: string) => ({ messages: sessions.get(id)?.state.messages ?? [] }),
		editMessage: async (id: string, _cwd: string, index: number, content: unknown) => {
			sessions.get(id).state.messages[index] = { ...sessions.get(id).state.messages[index], content };
		},
		deleteMessage: async (id: string, _cwd: string, index: number) => {
			sessions.get(id).state.messages.splice(index, 1);
		},
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
		// Home's explorer is offered the default folder before the first chat exists.
		assert.equal(existsSync(config.chatFolder), false);
		const homeFolders = await call("anna", "GET", "/folders/search?q=");
		assert.equal(homeFolders.status, 200);
		assert.ok(existsSync(path.join(dir, homeFolders.body.chatFolder)), "the explorer's default folder must exist");

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
		meta.name = "Cron investigation";
		assert.equal((await call("anna", "GET", `/chats/${chatId}`)).body.chat.title, "Cron investigation", "hybrid chats display their agent session's generated title");
		meta.name = undefined;

		// The next mention only carries what was said since pi's last turn.
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "thanks! @pi also check the cron job" });
		await until(() => prompts.length === 2, "second prompt");
		assert.equal(prompts[1].text, "anna: thanks! @pi also check the cron job");
		assert.ok((await call("anna", "GET", "/chats")).body.chats.some((c: any) => c.kind === "session" && c.id === meta.key), "a hybrid chat also appears as a regular session");

		// Catch-up after a dropped connection: everything after the last message seen, plus the current state of checked ones.
		const all = (await call("anna", "GET", `/chats/${chatId}`)).body.messages;
		const caught = await call("anna", "GET", `/chats/${chatId}/messages?after=${all[1].id}&check=${all[0].id}`);
		assert.deepEqual(
			caught.body.messages.map((m: any) => m.id),
			[all[0].id, ...all.slice(2).map((m: any) => m.id)],
		);
		assert.equal((await call("carol", "GET", `/chats/${chatId}/messages?after=0`)).status, 404);

		// Messages arriving during a turn wait; ordinary messages remain chat context, not new runs.
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "ordinary note while working" });
		await call("bob", "POST", `/chats/${chatId}/messages`, { text: "@pi queued request one" });
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "@pi queued request two" });
		await until(async () => !(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "queued requests to finish");
		const queued = (await call("anna", "GET", `/chats/${chatId}`)).body.messages;
		assert.equal(queued.filter((m: any) => m.status === "error").length, 0);
		assert.equal(prompts.length, 4);
		assert.match(prompts[2].text, /ordinary note while working/);
		assert.match(prompts[2].text, /queued request one/);
		assert.equal(prompts[3].text, "anna: @pi queued request two");

		// Edits: people fix their own words, anyone fixes pi's; pi's session reads the new text from then on.
		const first = queued[0];
		assert.equal((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/edit`, { text: "hijacked" })).status, 403);
		const edited = await call("anna", "POST", `/chats/${chatId}/messages/${first.id}/edit`, { text: "hello bob, the deploy failed twice" });
		assert.equal(edited.status, 200);
		assert.equal(edited.body.message.message.content[0].text, "hello bob, the deploy failed twice");
		assert.ok(edited.body.message.editedAt);
		const piSession = adapter.live(meta.id)!.state.messages as any[];
		assert.match(piSession[0].content[0].text, /anna: hello bob, the deploy failed twice\n\nbob: @pi can you look/);
		const answer = queued.find((m: any) => m.status === "done");
		assert.equal((await call("anna", "POST", `/chats/${chatId}/messages/${answer.id}/edit`, { text: "logs are clean" })).status, 200);
		assert.equal(piSession[1].content[0].text, "logs are clean");

		// Reactions: only on people's messages, toggled per person.
		assert.equal((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "👍" })).body.message.reactions["👍"][0], bob.id);
		assert.deepEqual((await call("anna", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "❤️" })).body.message.reactions, { "👍": [bob.id], "❤️": [anna.id] });
		assert.deepEqual((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "👍" })).body.message.reactions, { "❤️": [anna.id] });
		assert.equal((await call("bob", "POST", `/chats/${chatId}/messages/${answer.id}/reactions`, { emoji: "👍" })).status, 400);
		assert.notEqual((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "lol" })).status, 200, "only emoji are reactions");
		assert.deepEqual((await call("bob", "GET", `/chats/${chatId}`)).body.messages[0].reactions, { "❤️": [anna.id] });

		// Deleting: only your own words; they leave the chat and pi's transcript.
		const note = queued.find((m: any) => m.message.content[0]?.text?.includes("ordinary note while working"));
		assert.equal((await call("bob", "DELETE", `/chats/${chatId}/messages/${note.id}`)).status, 403);
		await until(async () => !(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "pi to finish before deleting");
		assert.equal((await call("anna", "DELETE", `/chats/${chatId}/messages/${note.id}`)).body.queued, false);
		assert.ok(!(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.id === note.id));
		const transcriptAfter = (adapter.live(meta.id)?.state.messages ?? (await adapter.readSession(meta.id, meta.cwd))!.messages) as any[];
		assert.ok(!transcriptAfter.some((m) => m.role === "user" && JSON.stringify(m.content).includes("ordinary note while working")));
		assert.ok(transcriptAfter.some((m) => m.role === "user" && JSON.stringify(m.content).includes("queued request one")));

		// Only @pi: a plain session, in the chosen folder.
		const solo = await call("anna", "POST", "/chats", { text: "summarise the API", pi: true, folder: "projects/api-server" });
		assert.ok(solo.body.session);
		assert.equal(store.session(solo.body.session)!.cwd, path.join(dir, "projects", "api-server"));
		const annaList = (await call("anna", "GET", "/chats")).body.chats;
		assert.ok(annaList.some((c: any) => c.kind === "session" && c.id === solo.body.session && c.folder === "projects/api-server"));

		// Fuzzy #folder search.
		const found = await call("anna", "GET", "/folders/search?q=apisrv");
		assert.equal(found.body.folders[0], "projects/api-server");
		writeFileSync(path.join(dir, "projects", "api-server", "server.ts"), "");
		const files = await call("anna", "GET", "/folders/search?q=apisrvts&files=1");
		assert.deepEqual(files.body.entries[0], { path: "projects/api-server/server.ts", type: "file" });

		const privateSession = (await call("anna", "POST", "/sessions", { harness: "pi", path: "projects/api-server", memoryPrivate: true })).body.session;
		assert.equal(privateSession.memoryPrivate, true);
		await call("anna", "POST", `/sessions/${privateSession.key}/prompt`, { text: "private-secret-not-for-memory" });
		// Project memory replaces the tenant-wide endpoint.
		await until(async () => !(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "pi to finish");
		await until(() => adapter.liveSessions().every(s => !s.state.running), "all sessions idle");
		// Old one-on-one sessions can archive; private and keep-live sessions cannot.
		const soloMeta = store.session(solo.body.session)!;
		adapter.live(soloMeta.id)!.state.messages.push({ role: "assistant", content: [{ type: "text", text: "early-important-fact " + "context ".repeat(9000) + " late-important-fact" }] });
		store.upsertSession({ ...soloMeta, updatedAt: "2020-01-01T00:00:00.000Z" });
		Object.defineProperty(adapter.live(soloMeta.id)!, "lastActivity", { value: Date.parse("2020-01-01T00:00:00.000Z"), writable: true });
		const endpoint = "/memory/general-work";
		// Context trimming is a project setting; the session's pi extension reads it over its bridge.
		assert.deepEqual((await call("chat-admin", "GET", endpoint)).body.context, { trimHours: 12, windowHours: 168 });
		assert.equal((await call("anna", "PATCH", endpoint, { context: { trimHours: 6, windowHours: 0 } })).status, 403);
		assert.equal((await call("chat-admin", "PATCH", endpoint, { context: { trimHours: 6, windowHours: 0 } })).status, 200);
		const { interactionEnvironment } = await import("./interactions.js");
		const contextBridge = (token: string) => fetch(`${base}/context-bridge/${encodeURIComponent(soloMeta.key)}`, { headers: { Authorization: `Bearer ${token}` } });
		assert.equal((await contextBridge("wrong")).status, 403);
		assert.deepEqual(await (await contextBridge(interactionEnvironment(soloMeta.key).BEEZY_INTERACTION_TOKEN)).json(), { trimHours: 6, windowHours: 0 });

		// An hourly sync per project: a short-lived session reads what was said since the last sync and is removed.
		const { memoryControls, MEMORY_UPDATE_TAG } = await import("./memory.js");
		const syncs = () => prompts.filter(p => p.text.startsWith(MEMORY_UPDATE_TAG));
		await memoryControls.syncNow("general-work");
		assert.equal(syncs().length, 1, "one sync session for the project");
		const [firstSync] = syncs();
		assert.ok(!Object.values(store.data.sessions).some(s => s.key !== `pi:${firstSync.id}` && s.id === firstSync.id), "the sync runs in a session of its own");
		assert.equal(store.session(`pi:${firstSync.id}`)!.deleted, true, "the sync session is removed afterwards");
		assert.match(firstSync.text, /late-important-fact/, "the newest part of long conversations is kept");
		assert.match(firstSync.text, new RegExp(`agent: reply to ${soloMeta.id}`));
		assert.doesNotMatch(firstSync.text, /secret-reasoning/, "thinking is left out");
		assert.doesNotMatch(firstSync.text, /private-secret-not-for-memory/, "private sessions never reach memory");
		assert.ok(!adapter.live(soloMeta.id)!.state.messages.some((m: any) => JSON.stringify(m).includes(MEMORY_UPDATE_TAG)), "conversations are not touched");
		assert.equal(store.session(soloMeta.key)!.updatedAt, "2020-01-01T00:00:00.000Z", "a sync does not move sessions up");
		const status = (await call("chat-admin", "GET", endpoint)).body;
		assert.equal(status.error, undefined);
		assert.ok(status.lastRun);
		assert.equal(status.overview, "Beezy API server; deploys go through the deploy topic.");
		assert.deepEqual(status.topics.map((t: any) => [t.slug, t.title, t.description]), [["deploy", "Deploy", "Deploy decisions"]]);
		const master = readFileSync(path.join(config.chatFolder, "MEMORY.md"), "utf8");
		assert.match(master, /Beezy API server[\s\S]*`deploy` — Deploy: Deploy decisions/, "MEMORY.md is the generated master: overview, then topics");
		await memoryControls.archiveNow();
		const { archiveEligible } = await import("./memory.js");
		assert.equal(archiveEligible({ ...soloMeta, keepLive: true }), false);
		assert.equal(archiveEligible({ ...soloMeta, memoryPrivate: true }), false);
		assert.equal(archiveEligible({ ...soloMeta, updatedAt: new Date().toISOString() }), false);
		assert.equal(archiveEligible({ ...soloMeta, authorship: undefined }), false);
		assert.ok(store.session(soloMeta.key)!.archivedAt);
		assert.ok(existsSync(store.session(soloMeta.key)!.archiveFile!));
		const archive = JSON.parse(gunzipSync(readFileSync(store.session(soloMeta.key)!.archiveFile!)).toString());
		assert.deepEqual(archive.messages, adapter.live(soloMeta.id)!.state.messages);
		assert.ok(!(await call("anna", "GET", "/chats")).body.chats.some((c: any) => c.id === soloMeta.key));
		assert.equal((await call("anna", "POST", `/sessions/${soloMeta.key}/prompt`, { text: "blocked" })).status, 409);
		assert.equal((await call("anna", "PATCH", `/sessions/${soloMeta.key}/retention`, { memoryPrivate: true })).status, 409);
		assert.equal((await call("bob", "PATCH", `/sessions/${soloMeta.key}/retention`, { archived: false })).status, 404);
		assert.equal((await call("anna", "GET", `${endpoint}/archives`)).body.sessions.length, 1);
		await call("anna", "PATCH", `/sessions/${soloMeta.key}/retention`, { archived: false });
		assert.equal(store.session(soloMeta.key)!.archivedAt, undefined);
		assert.equal(store.session(soloMeta.key)!.keepLive, true);
		await call("anna", "POST", `/sessions/${privateSession.key}/prompt`, { text: "read public context" });
		assert.ok(prompts.some(p => p.id === privateSession.id && p.text.includes("<project-memory>") && p.text.includes("`deploy` — Deploy") && p.text.includes("Beezy API server")), "sessions get the master");
		await until(() => !adapter.live(privateSession.id)!.state.running, "private session idle");
		await call("anna", "POST", `/sessions/${privateSession.key}/prompt`, { text: "again" });
		assert.ok(!prompts.some(p => p.id === privateSession.id && p.text.endsWith("again") && p.text.includes("<project-memory>")), "memory is put in front of a prompt at most once a day");
		// The pi extension reads and updates topics over the session's bridge, with the owner's access.
		const memoryBridge = (key: string, token: string, body: object, route = "") => fetch(`${base}/memory-bridge/${encodeURIComponent(key)}${route}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
		const token = (key: string) => interactionEnvironment(key).BEEZY_INTERACTION_TOKEN;
		assert.equal((await memoryBridge(privateSession.key, "wrong", {})).status, 403);
		assert.match((await (await memoryBridge(privateSession.key, token(privateSession.key), { topics: ["deploy"] })).json()).text, /Deploy decisions are recorded here/);
		const privateWrite = await memoryBridge(privateSession.key, token(privateSession.key), { action: "write", topic: "x", title: "X", description: "x", body: "x" }, "/update");
		assert.equal(privateWrite.status, 400);
		assert.match((await privateWrite.json()).text, /private/);
		const write = (body: object) => memoryBridge(soloMeta.key, token(soloMeta.key), body, "/update");
		assert.match((await (await write({ action: "write", topic: "Bad Name", title: "x", description: "y", body: "z" })).json()).text, /^Not changed: `topic` must be a slug/);
		assert.match((await (await write({ action: "write", topic: "design", title: "Design", description: "Look and feel", body: "Dark mode first." })).json()).text, /saved/);
		assert.match((await (await write({ action: "overview", body: "x".repeat(2000) })).json()).text, /at most 1500/);
		assert.match((await (await write({ action: "delete", topic: "design" })).json()).text, /deleted/);
		// People edit topics and the overview: create, update, delete; at most ten; the master follows.
		assert.equal((await call("anna", "PUT", `${endpoint}/topics/Bad%20Name`, { title: "x", description: "y", body: "z" })).status, 400);
		assert.equal((await call("anna", "PUT", `${endpoint}/topics/marketing`, { title: "Marketing", description: "Launch plans", body: "Launch in spring." })).status, 200);
		assert.equal((await call("anna", "GET", `${endpoint}/topics/marketing`)).body.body, "Launch in spring.");
		assert.match(readFileSync(path.join(config.chatFolder, "MEMORY.md"), "utf8"), /`marketing` — Marketing: Launch plans/);
		for (let i = 0; i < 8; i++) assert.equal((await call("anna", "PUT", `${endpoint}/topics/t${i}`, { title: "T", description: "d", body: "b" })).status, 200);
		assert.equal((await call("anna", "PUT", `${endpoint}/topics/eleventh`, { title: "T", description: "d", body: "b" })).status, 409);
		for (let i = 0; i < 8; i++) await call("anna", "DELETE", `${endpoint}/topics/t${i}`);
		assert.equal((await call("anna", "DELETE", `${endpoint}/topics/marketing`)).status, 200);
		assert.deepEqual((await call("anna", "GET", endpoint)).body.topics.map((t: any) => t.slug), ["deploy"]);
		assert.equal((await call("anna", "PUT", `${endpoint}/overview`, { body: "Edited by a person." })).status, 200);
		assert.equal((await call("anna", "GET", endpoint)).body.overview, "Edited by a person.");
		assert.equal(store.session(privateSession.key)!.consolidatedAt, undefined);

		// The next sync reads only what came after the last one, group chats included.
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "we settled on blue-green deploys" });
		const plain = (await call("anna", "POST", "/chats", { text: "the logo stays orange", userIds: [bob.id] })).body.chat;
		await memoryControls.syncNow("general-work");
		assert.equal(syncs().length, 2);
		const secondSync = syncs()[1].text;
		assert.match(secondSync, /anna: we settled on blue-green deploys/);
		assert.match(secondSync, /anna: the logo stays orange/);
		assert.doesNotMatch(secondSync, /late-important-fact/, "what the last sync read is not read again");
		assert.ok((await import("./chats.js")).getChat(plain)!.consolidatedAt);
		assert.ok(!(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "no chat reply is posted for the sync");
		await memoryControls.syncNow("general-work");
		assert.equal(syncs().length, 2, "nothing new, no sync session");

		// The sync model per provider: the cheapest unless an admin picks one.
		const memoryModel = (await call("anna", "GET", "/memory-model")).body;
		assert.deepEqual(memoryModel.current, { provider: "test", id: "cheap" });
		assert.equal((await call("anna", "PUT", "/memory-model", { test: "cheap" })).status, 403);
		assert.equal((await call("chat-admin", "PUT", "/memory-model", { test: "cheap" })).status, 200);
		assert.equal((await call("anna", "GET", "/memory-model")).body.providers.find((p: any) => p.provider === "test").configured, "cheap");
		assert.equal((await call("chat-admin", "PUT", "/memory-model", { test: null })).status, 200);

		// Deleting a chat removes it for the one deleting; it is gone once the last member deletes it.
		const doomed = (await call("anna", "POST", "/chats", { text: "temporary", userIds: [bob.id] })).body.chat;
		assert.equal((await call("carol", "DELETE", `/chats/${doomed}`)).status, 404);
		assert.equal((await call("anna", "DELETE", `/chats/${doomed}`)).body.deleted, false);
		assert.equal((await call("anna", "GET", `/chats/${doomed}`)).status, 404);
		assert.ok((await call("bob", "GET", "/chats")).body.chats.some((c: any) => c.id === doomed));
		assert.equal((await call("bob", "DELETE", `/chats/${doomed}`)).body.deleted, true);
		assert.equal((await import("./chats.js")).getChat(doomed), undefined);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		saveNow();
		(await import("./chats.js")).closeChats();
		rmSync(dir, { recursive: true, force: true });
	}
});
