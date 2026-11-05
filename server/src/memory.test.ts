import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkLines, compactTranscript } from "./memory.js";

test("memory transcripts keep what was said and done, with tool output cut to a glimpse", () => {
	const lines = compactTranscript([
		{ role: "user", content: "Use Postgres for the queue" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "Agreed." }, { type: "toolCall", name: "read", arguments: { path: "db.ts" } }] },
		{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "x".repeat(5000) }] },
		{ role: "assistant", content: [] },
	]);
	assert.equal(lines[0], "user: Use Postgres for the queue");
	assert.equal(lines[1], 'assistant: Agreed.\n[read({"path":"db.ts"})]');
	assert.ok(lines[2].startsWith("tool read: xxx") && lines[2].length < 400 && lines[2].includes("more chars"));
	assert.equal(lines[3], "");
});

test("memory parts stay under the size, splitting only lines that are longer", () => {
	assert.deepEqual(chunkLines(["aaaa", "", "bbbb", "cc"], 10), ["aaaa\n\nbbbb", "cc"]);
	assert.deepEqual(chunkLines(["x".repeat(25)], 10), ["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
	assert.deepEqual(chunkLines([]), []);
});
