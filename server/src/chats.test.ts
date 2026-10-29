import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
				assert.equal(state.running, false, "chat prompts must wait for the active turn");
				prompts.push({ id, cwd, text: input.text });
				state.messages.push({ role: "user", content: [{ type: "text", text: input.text }] });
				state.running = true;
				status();
				setTimeout(() => {
					state.messages.push({ role: "assistant", content: [{ type: "text", text: `reply to ${id}` }], stopReason: "stop" });
					state.running = false;
					status();
				}, 100);
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

test("chats: people talk, the asker's agent answers, private chats stay private, agent threads, side threads and the archive", async () => {
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

		// Bob asks @pi: Bob's agent gets the conversation so far, and its reply lands in the chat, labeled as his.
		await call("bob", "POST", `/chats/${chatId}/messages`, { text: "@pi can you look at the logs?" });
		await until(async () => (await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "done"), "bob's agent's reply");
		const chat = (await call("anna", "GET", `/chats/${chatId}`)).body;
		const reply = chat.messages.find((m: any) => m.status === "done");
		assert.equal(reply.message.role, "assistant");
		assert.equal(reply.message.content[0].text, "reply to f1");
		assert.deepEqual(reply.message.agentOf, { id: bob.id, username: "bob" });
		assert.match(prompts[0].text, /You are bob's agent, taking part in a group chat with anna, bob/);
		assert.match(prompts[0].text, /anna: hello bob, the deploy failed\n\nbob: @pi can you look at the logs\?/);
		assert.equal(prompts[0].cwd, config.chatFolder, "without #folder the agent works in the shared chat folder");
		assert.ok(existsSync(path.join(config.chatFolder, "AGENTS.md")));
		const bobAgent = Object.values(store.data.sessions).find((m) => m.thread === "chat" && m.ownerId === bob.id)!;
		assert.ok(bobAgent, "bob's agent for the chat is his own session");
		assert.deepEqual(bobAgent.shares, [], "nobody else steers bob's agent");
		assert.equal(chat.chat.title, "bob, pi");

		// Anna asks: her own agent answers, and it hears what bob's agent said.
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "thanks! @pi also check the cron job" });
		await until(() => prompts.length === 2, "anna's agent's prompt");
		assert.equal(prompts[1].id, "f2", "a second person's agent is a second session");
		assert.match(prompts[1].text, /You are anna's agent/);
		assert.match(prompts[1].text, /bob's agent: reply to f1/);
		assert.match(prompts[1].text, /anna: thanks! @pi also check the cron job$/);
		await until(async () => !(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "anna's agent's reply");
		const annaReply = (await call("anna", "GET", `/chats/${chatId}`)).body.messages.at(-1);
		assert.equal(annaReply.message.agentOf.username, "anna");
		assert.ok(!(await call("anna", "GET", "/chats")).body.chats.some((c: any) => c.kind === "session" && c.thread === "chat"), "chat agents are not listed");

		// Catch-up after a dropped connection: everything after the last message seen, plus the current state of checked ones.
		const all = (await call("anna", "GET", `/chats/${chatId}`)).body.messages;
		const caught = await call("anna", "GET", `/chats/${chatId}/messages?after=${all[1].id}&check=${all[0].id}`);
		assert.deepEqual(
			caught.body.messages.map((m: any) => m.id),
			[all[0].id, ...all.slice(2).map((m: any) => m.id)],
		);
		assert.equal((await call("carol", "GET", `/chats/${chatId}/messages?after=0`)).status, 404);

		// Mentions during a turn wait their turn; each asker's agent gets only what is new to it.
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "ordinary note while working" });
		await call("bob", "POST", `/chats/${chatId}/messages`, { text: "@pi queued request one" });
		await call("anna", "POST", `/chats/${chatId}/messages`, { text: "@pi queued request two" });
		await until(async () => !(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.status === "working"), "queued requests to finish");
		const queued = (await call("anna", "GET", `/chats/${chatId}`)).body.messages;
		assert.equal(queued.filter((m: any) => m.status === "error").length, 0);
		assert.equal(prompts.length, 4);
		assert.equal(prompts[2].id, "f1");
		assert.match(prompts[2].text, /anna: thanks! @pi also check the cron job/, "bob's agent catches up on what it missed");
		assert.match(prompts[2].text, /anna's agent: reply to f2/);
		assert.match(prompts[2].text, /ordinary note while working/);
		assert.match(prompts[2].text, /bob: @pi queued request one$/);
		assert.ok(!/reply to f1/.test(prompts[2].text), "an agent is not told its own replies");
		assert.equal(prompts[3].id, "f2");
		assert.match(prompts[3].text, /bob's agent: reply to f1/);
		assert.match(prompts[3].text, /anna: @pi queued request two$/);

		// Edits: people fix their own words, anyone fixes an agent's finished reply.
		const first = queued[0];
		assert.equal((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/edit`, { text: "hijacked" })).status, 403);
		const edited = await call("anna", "POST", `/chats/${chatId}/messages/${first.id}/edit`, { text: "hello bob, the deploy failed twice" });
		assert.equal(edited.status, 200);
		assert.equal(edited.body.message.message.content[0].text, "hello bob, the deploy failed twice");
		assert.ok(edited.body.message.editedAt);
		const answer = queued.find((m: any) => m.status === "done");
		assert.equal((await call("anna", "POST", `/chats/${chatId}/messages/${answer.id}/edit`, { text: "logs are clean" })).status, 200);

		// Reactions: only on people's messages, toggled per person.
		assert.equal((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "👍" })).body.message.reactions["👍"][0], bob.id);
		assert.deepEqual((await call("anna", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "❤️" })).body.message.reactions, { "👍": [bob.id], "❤️": [anna.id] });
		assert.deepEqual((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "👍" })).body.message.reactions, { "❤️": [anna.id] });
		assert.equal((await call("bob", "POST", `/chats/${chatId}/messages/${answer.id}/reactions`, { emoji: "👍" })).status, 400);
		assert.notEqual((await call("bob", "POST", `/chats/${chatId}/messages/${first.id}/reactions`, { emoji: "lol" })).status, 200, "only emoji are reactions");
		assert.deepEqual((await call("bob", "GET", `/chats/${chatId}`)).body.messages[0].reactions, { "❤️": [anna.id] });

		// Deleting: only your own words.
		const note = queued.find((m: any) => m.message.content[0]?.text?.includes("ordinary note while working"));
		assert.equal((await call("bob", "DELETE", `/chats/${chatId}/messages/${note.id}`)).status, 403);
		assert.equal((await call("anna", "DELETE", `/chats/${chatId}/messages/${note.id}`)).status, 200);
		assert.ok(!(await call("anna", "GET", `/chats/${chatId}`)).body.messages.some((m: any) => m.id === note.id));

		// The archive has the agentic chat (edits replace, deletions leave), searchable by its members only.
		const search = async (who: string, q: string) => (await call(who, "GET", `/archive/search?q=${encodeURIComponent(q)}`)).body.turns as any[];
		assert.ok((await search("bob", "deploy failed twice")).some((t) => t.conversation === `chat:${chatId}` && t.senderName === "anna"));
		assert.equal((await search("bob", "hijacked")).length, 0);
		assert.equal((await search("anna", "ordinary note")).length, 0, "deleted messages leave the archive");
		assert.ok((await search("anna", "clean")).some((t) => t.senderName === "bob's agent"), "agent replies are archived as whose agent spoke");
		assert.equal((await search("carol", "deploy")).length, 0, "non-members find nothing");

		// Titles: typed, cleared back to the names, or generated (without pi: the first words).
		assert.equal((await call("anna", "PATCH", `/chats/${chatId}`, { title: "Deploy incident" })).body.chat.title, "Deploy incident");
		assert.equal((await call("bob", "GET", "/chats")).body.chats.find((c: any) => c.id === chatId).title, "Deploy incident");
		assert.ok((await search("bob", "deploy failed twice")).every((t) => t.title === "Deploy incident"), "the archive follows renames");
		assert.equal((await call("anna", "PATCH", `/chats/${chatId}`, { title: "" })).body.chat.title, "bob, pi");
		const generated = await call("anna", "POST", `/chats/${chatId}/title`);
		assert.equal(generated.status, 200);
		assert.ok(generated.body.title.length > 0 && generated.body.title.length <= 60);

		// The agents' bridge: context window, the agentic chats digest, and archive search for their person.
		const { interactionEnvironment } = await import("./interactions.js");
		const bridge = async (key: string, body: unknown) => {
			const res = await fetch(`${base}/threads-bridge/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${interactionEnvironment(key).BEEZY_INTERACTION_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
			return { status: res.status, body: await res.json() };
		};
		assert.equal((await fetch(`${base}/threads-bridge/${encodeURIComponent(bobAgent.key)}`, { method: "POST", headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" }, body: "{}" })).status, 403);
		const bobContext = (await bridge(bobAgent.key, { action: "context" })).body;
		assert.equal(bobContext.windowHours, 24);
		assert.ok(!bobContext.digest.includes(`chat:${chatId}`), "a chat agent is not told its own chat twice");

		// Private chats: no agent, never archived; making one agentic archives it.
		const secret = (await call("anna", "POST", "/chats", { text: "surprise party for carol", userIds: [bob.id], private: true })).body.chat;
		const before = prompts.length;
		await call("bob", "POST", `/chats/${secret}/messages`, { text: "@pi plan it" });
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(prompts.length, before, "@pi does nothing in a private chat");
		assert.equal((await search("bob", "surprise")).length, 0, "private chats are not archived");
		assert.equal((await call("bob", "GET", "/chats")).body.chats.find((c: any) => c.id === secret).private, true);
		await call("anna", "PATCH", `/chats/${secret}`, { private: false });
		assert.equal((await search("bob", "surprise")).length, 1);
		await call("anna", "PATCH", `/chats/${secret}`, { private: true });
		assert.equal((await search("bob", "surprise")).length, 0, "making a chat private takes it out of the archive");

		// Only the agent: that is the caller's agent thread in the project (one per person, reused).
		const solo = await call("anna", "POST", "/chats", { text: "summarise the API", pi: true });
		assert.ok(solo.body.session);
		const thread = store.session(solo.body.session)!;
		assert.equal(thread.thread, "main");
		assert.equal(thread.ownerId, anna.id);
		await until(() => !adapter.live(thread.id)!.state.running, "anna's agent thread to answer");
		assert.equal((await call("anna", "POST", "/chats", { text: "and the web app?", pi: true })).body.session, thread.key, "the same thread again");
		assert.equal((await call("anna", "POST", "/agent-thread", {})).body.session.key, thread.key);
		assert.equal((await call("bob", "GET", "/agent-thread")).body.session, null, "bob has his own (not yet created) thread");
		await until(() => !adapter.live(thread.id)!.state.running && prompts.filter((p) => p.id === thread.id).length === 2, "anna's agent thread to answer again");
		const annaList = (await call("anna", "GET", "/chats")).body.chats;
		assert.ok(annaList.some((c: any) => c.kind === "session" && c.id === thread.key && c.thread === "main"));

		// Anna's agent thread sees the agentic chats she is in, and searches the archive as her.
		const mainContext = (await bridge(thread.key, { action: "context" })).body;
		assert.match(mainContext.digest, /Recent agentic chats/);
		assert.match(mainContext.digest, /hello bob, the deploy failed twice/);
		assert.ok(!mainContext.digest.includes("surprise"), "private chats never reach an agent");
		const cron = (await bridge(thread.key, { action: "search", query: "cron" })).body;
		assert.match(cron.results, /cron job/);
		assert.equal((await bridge(thread.key, { action: "read", conversation: `session:${bobAgent.key}` })).status, 404, "an agent cannot read another person's sessions");
		await until(async () => /summarise the API/.test((await bridge(thread.key, { action: "read", conversation: `session:${thread.key}` })).body.turns ?? ""), "the agent thread in the archive");

		// Side threads: started from the agent thread, they report back when the run ends.
		const side = await call("anna", "POST", `/sessions/${encodeURIComponent(thread.key)}/side`, { task: "refactor the uploads module", name: "Refactor uploads" });
		assert.equal(side.status, 200);
		const sideMeta = store.session(side.body.session.key)!;
		assert.equal(sideMeta.thread, "side");
		assert.equal(sideMeta.parentKey, thread.key);
		assert.match(prompts.find((p) => p.id === sideMeta.id)!.text, /Task: refactor the uploads module/);
		await until(() => store.session(sideMeta.key)!.sideStatus === "merged", "the side thread to merge");
		await until(() => prompts.some((p) => p.id === thread.id && p.text.startsWith('[Side thread "Refactor uploads" finished]')), "the summary in the agent thread");
		assert.match(prompts.find((p) => p.id === thread.id && p.text.startsWith("[Side thread"))!.text, new RegExp(`reply to ${sideMeta.id}`));
		const listed = (await call("anna", "GET", "/chats")).body.chats.find((c: any) => c.id === sideMeta.key);
		assert.equal(listed.parentKey, thread.key);
		assert.equal(listed.sideStatus, "merged");
		assert.equal((await call("anna", "POST", `/sessions/${encodeURIComponent(bobAgent.key)}/side`, { task: "x" })).status, 404, "only the owner's threads take side threads");
		await until(() => !adapter.live(thread.id)!.state.running, "the agent thread to take in the summary");
		const fromAgent = await bridge(thread.key, { action: "side", task: "run the long test suite", name: "Long tests" });
		assert.equal(fromAgent.body.status, "started");
		assert.equal((await bridge(sideMeta.key, { action: "side", task: "nested" })).status, 400, "side threads do not nest");

		// Fuzzy #folder search.
		const found = await call("anna", "GET", "/folders/search?q=apisrv");
		assert.equal(found.body.folders[0], "projects/api-server");
		writeFileSync(path.join(dir, "projects", "api-server", "server.ts"), "");
		const files = await call("anna", "GET", "/folders/search?q=apisrvts&files=1");
		assert.deepEqual(files.body.entries[0], { path: "projects/api-server/server.ts", type: "file" });

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
		assert.ok(memoryPrompts.some((p) => /anna: hello bob, the deploy failed/.test(p.text) && /bob's agent: /.test(p.text)));
		const again = await call("chat-admin", "POST", "/memory/consolidate", { all: true });
		assert.equal(again.body.pending, 0, "consolidated conversations are not repeated");

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
