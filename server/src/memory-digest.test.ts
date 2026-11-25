import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapProjectMemory } from "../extensions/lib/context-policy.mjs";
import { digestMessages, fitSources, keepTail } from "./memory-digest.js";
import { pickMemoryModel } from "./memory.js";

test("digest: what was said, without thinking, injected memory or tool output", () => {
	const text = digestMessages([
		{ role: "user", content: [{ type: "text", text: `${wrapProjectMemory("old memory")}Use blue-green deploys` }, { type: "image", data: "xx" }] },
		{ role: "assistant", content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "toolCall", name: "read", arguments: { path: "deploy.sh" } }] },
		{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "#!/bin/sh\n".repeat(500) }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "npm test" } }, { type: "toolCall", name: "bash", arguments: { command: "npm test" } }] },
		{ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "1 test failed\nlong trace" }] },
		{ role: "assistant", content: [{ type: "text", text: "Done: deploys are blue-green now." }] },
	], (m) => (m.role === "user" ? "anna" : undefined));
	assert.equal(text, "anna: Use blue-green deploys\n\n[tools: read deploy.sh; bash npm test ×2; bash failed: 1 test failed long trace]\n\nagent: Done: deploys are blue-green now.");
});

test("digest: long conversations keep their newest part within the budget", () => {
	assert.equal(keepTail("short", 100), "short");
	const long = `${"old ".repeat(5000)}\n\nnewest decision`;
	assert.match(keepTail(long, 1000), /^\[… \d+ earlier characters left out\][\s\S]*newest decision$/);
	const fitted = fitSources([{ title: "big", text: "x".repeat(50_000) }, { title: "small", text: "tiny" }], 20_000);
	assert.ok(fitted.length < 21_000);
	assert.match(fitted, /<conversation title="small">\ntiny\n<\/conversation>/);
});

test("memory model: configured, else the provider's cheapest", () => {
	const models = [
		{ provider: "anthropic", id: "opus", name: "Opus", cost: { input: 15, output: 75 } },
		{ provider: "anthropic", id: "haiku", name: "Haiku", cost: { input: 1, output: 5 } },
		{ provider: "openai", id: "gpt-mini", name: "Mini", cost: { input: 0.1, output: 0.4 } },
		{ provider: "local", id: "big", name: "Big" },
		{ provider: "local", id: "small-chat", name: "Small" },
	];
	assert.deepEqual(pickMemoryModel(models, { provider: "anthropic", id: "opus" }), { provider: "anthropic", id: "haiku" });
	assert.deepEqual(pickMemoryModel(models, { provider: "anthropic", id: "opus" }, { anthropic: "opus" }), { provider: "anthropic", id: "opus" });
	assert.deepEqual(pickMemoryModel(models, { provider: "local", id: "big" }), { provider: "local", id: "small-chat" }, "a light model when prices are unknown");
	assert.deepEqual(pickMemoryModel([], { provider: "x", id: "y" }), undefined);
});
