import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-archive-"));
process.env.DATA_DIR = dir;
const archive = await import("./archive.js");

test("the archive stores turns once, searches them for whoever may read them, and reads around a moment", () => {
	const t0 = Date.UTC(2026, 9, 1, 9);
	const info = { conversation: "session:pi:a", tenantId: "work", projectId: "p1", kind: "main" as const, title: "Agent" };
	const messages = [
		{ role: "user", timestamp: t0, content: [{ type: "text", text: "The login fails on Safari" }], author: { id: "u1", username: "anna" } },
		{ role: "assistant", timestamp: t0 + 1000, content: [{ type: "text", text: "Looking at the cookie settings" }, { type: "toolCall", name: "edit", arguments: { path: "src/auth.ts" } }] },
		{ role: "toolResult", timestamp: t0 + 2000, toolName: "edit", content: [{ type: "text", text: "Edited src/auth.ts" }] },
		{ role: "assistant", timestamp: t0 + 3000, content: [{ type: "text", text: "Fixed: SameSite=None needs Secure" }] },
	];
	const sender = (m: any) => (m.role === "user" ? { id: m.author.id, name: m.author.username } : m.role === "toolResult" ? { name: "tool" } : { name: "anna's agent" });
	assert.equal(archive.archiveMessages(info, messages as any, sender), 4);
	assert.equal(archive.archiveMessages(info, messages as any, sender), 0, "archiving again adds nothing");
	archive.archiveMessages({ ...info, conversation: "session:pi:b", title: "Bob's thread" }, [{ role: "user", timestamp: t0, content: "Safari is broken for me too", author: { id: "u2", username: "bob" } }] as any, sender);

	const everything = () => true;
	const hits = archive.searchTurns({ tenantId: "work", text: "safari" }, everything);
	assert.deepEqual(new Set(hits.map((t) => t.conversation)), new Set(["session:pi:a", "session:pi:b"]));
	assert.deepEqual(archive.searchTurns({ tenantId: "work", text: "safari" }, (c) => c === "session:pi:a").map((t) => t.conversation), ["session:pi:a"], "only readable conversations");
	assert.equal(archive.searchTurns({ tenantId: "other", text: "safari" }, everything).length, 0, "tenants are separate");
	assert.match(archive.searchTurns({ tenantId: "work", text: "auth.ts" }, everything)[0].text, /→ edit src\/auth\.ts|Edited src\/auth\.ts/);
	assert.equal(archive.searchTurns({ tenantId: "work", text: "Same*" }, everything)[0].senderName, "anna's agent", "prefix search");
	assert.equal(archive.searchTurns({ tenantId: "work", sender: "BOB" }, everything).length, 1);
	assert.equal(archive.searchTurns({ tenantId: "work", text: "safari", since: t0 + 1 }, everything).length, 0);
	assert.equal(archive.searchTurns({ tenantId: "work" }, everything)[0].ts, t0 + 3000, "without words, newest first");

	const around = archive.readConversation("session:pi:a", { around: t0 + 2000, before: 1, after: 1 });
	assert.deepEqual(around.map((t) => t.ts), [t0 + 1000, t0 + 2000]);
	assert.equal(archive.readConversation("session:pi:a").length, 4);
	assert.match(archive.formatTurns(around, { conversation: true }), /^2026-10-01 09:00 \[Agent · session:pi:a\] anna's agent: Looking at the cookie settings/);

	archive.relabelConversation("session:pi:a", { title: "Safari login" });
	assert.equal(archive.readConversation("session:pi:a")[0].title, "Safari login");

	// Chat messages have stable ids: an edit replaces, a deletion removes.
	const chat = { conversation: "chat:c1", tenantId: "work", kind: "chat" as const, title: "anna, bob" };
	archive.archiveChatMessage(chat, 1, { role: "user", timestamp: t0, content: "lunch at noon?" } as any, { id: "u1", name: "anna" });
	archive.archiveChatMessage(chat, 1, { role: "user", timestamp: t0, content: "lunch at one?" } as any, { id: "u1", name: "anna" });
	assert.deepEqual(archive.readConversation("chat:c1").map((t) => t.text), ["lunch at one?"]);
	assert.deepEqual(archive.recentTurns(["chat:c1", "chat:none"], t0 - 1).map((t) => t.text), ["lunch at one?"]);
	archive.forgetChatMessage("chat:c1", 1);
	assert.equal(archive.readConversation("chat:c1").length, 0);
	archive.forgetConversation("session:pi:b");
	assert.equal(archive.searchTurns({ tenantId: "work", text: "broken" }, everything).length, 0);
	assert.deepEqual(archive.archiveStats(), { turns: 4, conversations: 1 });
});

test("any search text is safe: quotes, operators and odd characters never break the query (fuzzed)", () => {
	const alphabet = ['"', "*", "(", ")", ":", "-", "^", "NEAR", "AND", "OR", "NOT", "'", "\\", "%", "_", "ä", "🙂", " ", "a", "b", "{", "}", "+", "\n"];
	let state = 42;
	const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
	for (let i = 0; i < 500; i++) {
		const text = Array.from({ length: 1 + Math.floor(random() * 12) }, () => alphabet[Math.floor(random() * alphabet.length)]).join(random() < 0.5 ? "" : " ");
		assert.doesNotThrow(() => archive.searchTurns({ tenantId: "work", text, sender: text, conversation: text }, () => true), `query ${JSON.stringify(text)}`);
	}
	assert.equal(archive.ftsQuery('cookie "same site" auth*'), '"cookie" "same site" "auth"*');
	assert.equal(archive.ftsQuery('a"b'), '"ab"');
	assert.equal(archive.ftsQuery("***"), "");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
