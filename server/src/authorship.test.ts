import assert from "node:assert/strict";
import { test } from "node:test";
import { attributeMessages, registerPrompt, type Authorship } from "./authorship.js";

const alice = { id: "a", username: "Alice" };
const bob = { id: "b", username: "Bob" };
const ledger = (): Authorship => ({ authors: {}, pending: [] });
const message = (text: string, timestamp = 1) => ({ role: "user", content: [{ type: "text", text }], timestamp });

test("legacy messages stay unknown; new authors survive JSON persistence", () => {
	const data = ledger();
	const old = message("hello");
	registerPrompt(data, [old], { text: "hello" }, alice);
	const messages = [old, message("hello", 2)];
	const attributed = attributeMessages(data, messages);
	assert.equal(attributed[0].author, undefined);
	assert.deepEqual(attributed[1].author, alice);
	assert.deepEqual(attributeMessages(JSON.parse(JSON.stringify(data)), messages), attributed);
	assert.equal(messages[1].content[0].text, "hello");
});

test("Yo retains its avatar identity across live delivery and transcript reload", () => {
	const data = ledger();
	registerPrompt(data, [], { text: "Yo" }, alice);
	const user = message("Yo", 1792089252713);
	const live = attributeMessages(data, [user]);
	assert.deepEqual(live[0].author, alice);
	const reloaded = attributeMessages(JSON.parse(JSON.stringify(data)), [
		JSON.parse(JSON.stringify(user)),
		{ role: "assistant", content: [{ type: "text", text: "Yo! What are we working on?" }], timestamp: 1792089252732 },
	]);
	assert.deepEqual(reloaded[0].author, alice);
	assert.equal(reloaded[1].author, undefined);
});

test("steering overtakes follow-up without swapping authors", () => {
	const data = ledger();
	registerPrompt(data, [], { text: "later", mode: "followUp" }, alice);
	registerPrompt(data, [], { text: "now", mode: "steer" }, bob);
	const messages = [message("now"), message("later", 2)];
	assert.deepEqual(attributeMessages(data, messages).map((m) => m.author), [bob, alice]);
	assert.equal(data.pending.length, 0);
});

test("ambiguous identical queued prompts are not falsely attributed", () => {
	const data = ledger();
	registerPrompt(data, [], { text: "same" }, alice);
	registerPrompt(data, [], { text: "same" }, bob);
	assert.deepEqual(attributeMessages(data, [message("same"), message("same", 2)]).map((m) => m.author), [undefined, undefined]);
});

test("summary messages without content do not prevent subsequent prompts or lose authors", () => {
	const data = ledger();
	const history = [
		{ role: "compactionSummary", summary: "Earlier conversation", tokensBefore: 1000 },
		{ role: "branchSummary", summary: "Other branch" },
	];
	registerPrompt(data, history, { text: "continue" }, alice);
	const messages = [...history, message("continue")];
	assert.deepEqual(attributeMessages(data, messages)[2].author, alice);
	assert.deepEqual(attributeMessages(JSON.parse(JSON.stringify(data)), messages)[2].author, alice);
	assert.deepEqual(messages.slice(0, 2), history);
});

test("string content and image prompts are supported", () => {
	const data = ledger();
	registerPrompt(data, [], { text: "plain" }, alice);
	assert.deepEqual(attributeMessages(data, [{ role: "user", content: "plain" }])[0].author, alice);
	const image = { data: "abc", mimeType: "image/png" };
	registerPrompt(data, [], { text: "image", images: [image] }, bob);
	assert.deepEqual(attributeMessages(data, [{ role: "user", content: [{ type: "text", text: "image" }, { type: "image", ...image }] }])[0].author, bob);
});
