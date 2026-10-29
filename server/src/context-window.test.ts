import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const extensions = path.resolve(import.meta.dirname, "../extensions");
const { windowMessages, withPreface, default: contextWindow } = await import(pathToFileURL(path.join(extensions, "context-window.mjs")).href);
const { default: threads } = await import(pathToFileURL(path.join(extensions, "threads.mjs")).href);

const HOUR = 3_600_000;
type Message = { role: string; timestamp?: number; content?: unknown; toolCallId?: string };

/** A random conversation over `hours`: user turns, assistant replies with tool calls and their results. */
function conversation(seed: number, hours: number) {
	let state = seed;
	const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	const messages: Message[] = [];
	let t = Date.now() - hours * HOUR;
	while (t < Date.now() - 60_000) {
		messages.push({ role: "user", timestamp: t, content: [{ type: "text", text: `ask ${messages.length}` }] });
		for (let steps = Math.floor(random() * 4); steps > 0; steps--) {
			t += random() * 120_000;
			const id = `call-${messages.length}`;
			messages.push({ role: "assistant", timestamp: t, content: [{ type: "toolCall", id, name: "bash" }] });
			messages.push({ role: "toolResult", timestamp: t + 1000, toolCallId: id });
		}
		messages.push({ role: "assistant", timestamp: t + 2000, content: [{ type: "text", text: "done" }] });
		t += random() * 4 * HOUR;
	}
	return messages;
}

test("the context window keeps whole recent turns, never splits a tool call from its result, and always keeps the last turn (fuzzed)", () => {
	for (let seed = 1; seed <= 300; seed++) {
		const messages = conversation(seed, 6 + (seed % 90));
		const cutoff = Date.now() - 24 * HOUR;
		const kept: Message[] = windowMessages(messages, cutoff);
		assert.ok(kept.length > 0, `seed ${seed}: something is kept`);
		// A suffix of the conversation, starting at a user message (unless nothing older was dropped).
		assert.deepEqual(kept, messages.slice(messages.length - kept.length), `seed ${seed}: a suffix`);
		if (kept.length < messages.length) assert.equal(kept[0].role, "user", `seed ${seed}: starts at a turn`);
		// Every tool result kept has its call kept.
		const calls = new Set(kept.flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; id?: string }[]).filter((b) => b.type === "toolCall").map((b) => b.id) : [])));
		for (const m of kept) if (m.role === "toolResult") assert.ok(calls.has(m.toolCallId), `seed ${seed}: orphaned tool result`);
		// Nothing recent is dropped: every message newer than the cutoff is kept.
		const droppedRecent = messages.slice(0, messages.length - kept.length).filter((m) => (m.timestamp ?? 0) >= cutoff);
		assert.equal(droppedRecent.length, 0, `seed ${seed}: dropped a recent message`);
		// Turns kept are recent, except the last one, which is kept however old.
		const firstTurnEnd = kept.findIndex((m, i) => i > 0 && m.role === "user");
		const firstTurn = firstTurnEnd < 0 ? kept : kept.slice(0, firstTurnEnd);
		if (firstTurnEnd >= 0) assert.ok(firstTurn.some((m) => (m.timestamp ?? 0) >= cutoff), `seed ${seed}: kept an old turn`);
	}
	const old = [{ role: "user", timestamp: Date.now() - 50 * HOUR }, { role: "assistant", timestamp: Date.now() - 50 * HOUR }];
	assert.deepEqual(windowMessages(old, Date.now() - 24 * HOUR), old, "a quiet thread still has its last turn");
	assert.deepEqual(windowMessages([], Date.now()), []);
});

test("Beezy's note goes into the first user message, not a separate one", () => {
	const messages = [{ role: "user", content: "hello", timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2 }];
	const out = withPreface(messages, "older turns are in the archive");
	assert.equal(out.length, 2);
	assert.equal(out[0].content[0].text, "[Beezy context]\nolder turns are in the archive\n[/Beezy context]");
	assert.deepEqual(out[0].content[1], { type: "text", text: "hello" });
	assert.equal(messages[0].content, "hello", "the original is not changed");
	assert.equal(withPreface(messages, ""), messages);
});

test("the context extension windows only when Beezy says so, and leaves context alone when Beezy is unreachable", async () => {
	const previous = { fetch: globalThis.fetch, url: process.env.BEEZY_THREADS_URL, token: process.env.BEEZY_INTERACTION_TOKEN };
	process.env.BEEZY_THREADS_URL = "http://localhost/threads";
	process.env.BEEZY_INTERACTION_TOKEN = "t";
	let reply: () => Response = () => Response.json({ windowHours: 24, note: "NOTE", digest: "DIGEST" });
	globalThis.fetch = (async () => reply()) as typeof fetch;
	try {
		const handlers = new Map<string, (event: any, ctx?: any) => any>();
		contextWindow({ on: (name: string, fn: any) => handlers.set(name, fn) });
		const messages = conversation(7, 72);
		const result = await handlers.get("context")!({ messages }, {});
		assert.ok(result.messages.length < messages.length);
		assert.match(result.messages[0].content[0].text, /NOTE\n\nDIGEST/);

		const fresh = new Map<string, (event: any, ctx?: any) => any>();
		reply = () => Response.json({ windowHours: null });
		contextWindow({ on: (name: string, fn: any) => fresh.set(name, fn) });
		assert.equal(await fresh.get("context")!({ messages }, {}), undefined, "ordinary sessions are untouched");

		const offline = new Map<string, (event: any, ctx?: any) => any>();
		globalThis.fetch = (async () => { throw new Error("connection refused"); }) as typeof fetch;
		contextWindow({ on: (name: string, fn: any) => offline.set(name, fn) });
		assert.equal(await offline.get("context")!({ messages }, {}), undefined);
	} finally {
		globalThis.fetch = previous.fetch;
		process.env.BEEZY_THREADS_URL = previous.url;
		process.env.BEEZY_INTERACTION_TOKEN = previous.token;
	}
});

test("the threads extension registers the archive and side thread tools and reports server errors", async () => {
	const previous = { fetch: globalThis.fetch, url: process.env.BEEZY_THREADS_URL, token: process.env.BEEZY_INTERACTION_TOKEN };
	process.env.BEEZY_THREADS_URL = "http://localhost/threads";
	process.env.BEEZY_INTERACTION_TOKEN = "t";
	const sent: any[] = [];
	globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
		const body = JSON.parse(String(options.body));
		sent.push(body);
		if (body.action === "side" && body.task === "nested") return Response.json({ error: "Side threads start from an agent thread" }, { status: 400 });
		if (body.action === "side") return Response.json({ sessionKey: "pi:s1", name: "Long tests", status: "started" });
		if (body.action === "read") return Response.json({ turns: "2026-10-01 10:00 anna: hi" });
		return Response.json({ results: "2026-10-01 10:00 [Chat · chat:1] anna: deploy" });
	}) as typeof fetch;
	try {
		const tools = new Map<string, any>();
		threads({ registerTool: (tool: any) => tools.set(tool.name, tool) });
		assert.deepEqual([...tools.keys()], ["history_search", "history_read", "start_side_thread"]);
		assert.match((await tools.get("history_search").execute("1", { query: "deploy", since: "2026-10-01" })).content[0].text, /anna: deploy/);
		assert.deepEqual(sent[0], { action: "search", query: "deploy", since: "2026-10-01" });
		assert.match((await tools.get("history_read").execute("2", { conversation: "chat:1" })).content[0].text, /anna: hi/);
		assert.match((await tools.get("start_side_thread").execute("3", { task: "run tests" })).content[0].text, /Started side thread "Long tests"/);
		await assert.rejects(() => tools.get("start_side_thread").execute("4", { task: "nested" }), /start from an agent thread/);
	} finally {
		globalThis.fetch = previous.fetch;
		process.env.BEEZY_THREADS_URL = previous.url;
		process.env.BEEZY_INTERACTION_TOKEN = previous.token;
	}
});
