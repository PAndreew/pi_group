import assert from "node:assert/strict";
import { test } from "node:test";
import { applyContextPolicy, cutoffsOf, epochTracker, EPOCH_IDLE_MS, historyPage, wrapProjectMemory } from "../extensions/lib/context-policy.mjs";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-05T12:00:00Z");
const at = (hoursAgo: number) => NOW - hoursAgo * HOUR;

/** One finished agent turn: prompt, reasoning plus a tool call, its result, and the answer. */
function turn(hoursAgo: number, label: string, prompt = `question ${label}`) {
	const t = at(hoursAgo);
	return [
		{ role: "user", content: prompt, timestamp: t },
		{ role: "assistant", content: [{ type: "thinking", thinking: `pondering ${label}` }, { type: "toolCall", id: `call-${label}`, name: "bash", arguments: { command: "x".repeat(300), timeout: 5 } }], timestamp: t + 1000 },
		{ role: "toolResult", toolCallId: `call-${label}`, toolName: "bash", content: [{ type: "text", text: `first line ${label}\nsecond\nthird` }, { type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: t + 2000 },
		{ role: "assistant", content: [{ type: "text", text: `answer ${label}` }], timestamp: t + 3000 },
	];
}

test("context policy: old turns trimmed, very old hidden behind a note, recent and current untouched", () => {
	const messages = [...turn(200, "a"), ...turn(30, "b"), ...turn(2, "c"), { role: "user", content: "now", timestamp: NOW }];
	const out = applyContextPolicy(messages, cutoffsOf({ trimHours: 12, windowHours: 168 }, NOW));
	// Turn a (200h) is hidden; the note lands on the first kept user message.
	assert.equal(out.length, 4 + 4 + 1);
	assert.match(String(out[0].content), /^\[Context note: 4 earlier messages .*session_history.*\]\n\nquestion b$/s);
	// Turn b (30h): no reasoning, arguments clipped, result one line with what was cut.
	const assistantB = out[1].content as any[];
	assert.deepEqual(assistantB.map((b) => b.type), ["toolCall"]);
	assert.equal(assistantB[0].arguments.command.length, 121);
	assert.equal(assistantB[0].arguments.timeout, 5);
	assert.deepEqual(out[2].content, [{ type: "text", text: "first line b … [trimmed: 3 lines, 25 chars, 1 image]" }]);
	assert.equal(out[2].toolCallId, "call-b");
	assert.deepEqual(out[3].content, [{ type: "text", text: "answer b" }]);
	// Turn c (2h) and the current prompt are as they were.
	assert.deepEqual(out.slice(4), messages.slice(8));
	// Inputs are not mutated.
	assert.equal((messages[5].content as any[]).length, 2);
});

test("context policy: the turn in progress is never touched, and zero hours switches rules off", () => {
	const running = turn(48, "r");
	assert.deepEqual(applyContextPolicy(running, cutoffsOf({ trimHours: 12, windowHours: 24 }, NOW)), running);
	const messages = [...turn(400, "a"), ...turn(1, "b")];
	assert.deepEqual(applyContextPolicy(messages, cutoffsOf({ trimHours: 0, windowHours: 0 }, NOW)), messages);
});

test("context policy: only the newest project memory copy stays; a hidden one moves into the note", () => {
	const mem = (text: string) => wrapProjectMemory(text);
	const messages = [...turn(300, "a", `${mem("old memory")}question a`), ...turn(20, "b", `${mem("new memory")}question b`), ...turn(1, "c", `${mem("newest memory")}question c`)];
	const out = applyContextPolicy(messages, cutoffsOf({ trimHours: 12, windowHours: 168 }, NOW));
	const users = out.filter((m) => m.role === "user").map((m) => String(m.content));
	assert.equal(users.length, 2);
	assert.doesNotMatch(users[0], /memory/);
	assert.match(users[1], /newest memory/);

	const hiddenLatest = [...turn(300, "a", `${mem("only memory")}question a`), ...turn(1, "b")];
	const kept = applyContextPolicy(hiddenLatest, cutoffsOf({ trimHours: 12, windowHours: 168 }, NOW));
	assert.match(String(kept[0].content), /^\[Context note.*\]\n\nPublic project memory[\s\S]*only memory[\s\S]*question b$/);
});

test("context policy: cutoffs stay frozen within an epoch and move after an idle gap", async () => {
	let loads = 0;
	const cutoffs = epochTracker(() => (loads++, { trimHours: 12, windowHours: 168 }));
	const first = await cutoffs("s", NOW);
	assert.deepEqual(await cutoffs("s", NOW + EPOCH_IDLE_MS - 1), first);
	assert.deepEqual(await cutoffs("s", NOW + 2 * EPOCH_IDLE_MS - 2), first, "activity keeps the epoch alive");
	const later = await cutoffs("s", NOW + 4 * EPOCH_IDLE_MS);
	assert.equal(later.trimBefore, first.trimBefore + 4 * EPOCH_IDLE_MS);
	assert.equal(loads, 2);
});

test("session history: search, read by number or time, page through", () => {
	const messages = [...turn(300, "a"), ...turn(30, "b", `${wrapProjectMemory("m")}question b`)];
	const hits = historyPage(messages, { query: "FIRST LINE A" });
	assert.match(hits, /^#3 2026-10-24 00:00 tool bash: …first line a/);
	const read = historyPage(messages, { from: 5 });
	assert.match(read, /^#5 .* user: \[project memory\]\nquestion b/);
	assert.match(read, /→ bash\(/);
	assert.match(read, /\[Messages #5–#8 of 8\.\]$/);
	assert.match(historyPage(messages, { date: "2026-11-04" }), /^#5 /);
	const long = Array.from({ length: 40 }, (_, i) => ({ role: "user", content: "y".repeat(1000), timestamp: at(40 - i) }));
	assert.ok(historyPage(long).endsWith("[Messages #1–#11 of 40. Continue with from=12.]"));
});
