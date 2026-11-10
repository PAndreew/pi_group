import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { wrapProjectMemory } from "../extensions/lib/context-policy.mjs";
import { chunkLines, turnDigest } from "./memory.js";
import { copyTopics, formatTopic, invalidTopics, legacyMaster, MAX_TOPICS, readTopics, renderIndex, replaceTopics, topicsDir, topicToolText, writeIndex } from "./memory-topics.js";

test("memory digests keep what was said, reasoning and answers, without tool traffic or injected memory", () => {
	const lines = turnDigest([
		{ role: "user", content: [{ type: "text", text: `${wrapProjectMemory("- `old` — Old: index")}Use Postgres for the queue` }] },
		{ role: "assistant", content: [{ type: "thinking", thinking: "Postgres fits; " + "y".repeat(5000) }, { type: "text", text: "Checking." }, { type: "toolCall", name: "read", arguments: { path: "db.ts" } }] },
		{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "x".repeat(5000) }] },
		{ role: "assistant", content: [{ type: "text", text: "Agreed, Postgres." }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: {} }] },
	]);
	assert.equal(lines[0], "user: Use Postgres for the queue");
	assert.ok(lines[1].startsWith("assistant: (reasoning) Postgres fits; yyy") && lines[1].endsWith("more chars]\nChecking.") && lines[1].length < 2200);
	assert.equal(lines[2], "");
	assert.equal(lines[3], "assistant: Agreed, Postgres.");
	assert.equal(lines[4], "");
});

test("memory parts stay under the size, splitting only longer lines, and know how many messages they complete", () => {
	assert.deepEqual(chunkLines(["aaaa", "", "bbbb", "cc"], 10), [{ text: "aaaa\n\nbbbb", to: 3 }, { text: "cc", to: 4 }]);
	assert.deepEqual(chunkLines(["x".repeat(25)], 10), [{ text: "x".repeat(10), to: 0 }, { text: "x".repeat(10), to: 0 }, { text: "x".repeat(5), to: 1 }]);
	assert.deepEqual(chunkLines([]), []);
});

test("memory topics: validated, indexed, replaced, read by the tool; a master from before topics is kept aside", () => {
	const project = mkdtempSync(path.join(os.tmpdir(), "topics-"));
	const live = topicsDir(project);
	mkdirSync(live, { recursive: true });
	writeFileSync(path.join(project, "MEMORY.md"), "# Old master\nUse Postgres.");
	writeFileSync(path.join(live, "budget.md"), formatTopic({ title: "Budget", description: "Costs and limits", body: "Hotel: 120 EUR/night." }));
	writeIndex(project);
	assert.equal(legacyMaster(project), "# Old master\nUse Postgres.", "the old master is not overwritten by the index");
	assert.match(readFileSync(path.join(project, "MEMORY.md"), "utf8"), /`budget` — Budget: Costs and limits/);
	assert.equal(renderIndex([]), "");

	const staging = path.join(project, "staging");
	copyTopics(live, staging);
	writeFileSync(path.join(staging, "itinerary.md"), "---\ntitle: Itinerary\ndescription: Where and when\n---\nDay 1: Vienna");
	assert.equal(invalidTopics(staging), undefined);
	writeFileSync(path.join(staging, "notes.txt"), "x");
	assert.match(invalidTopics(staging)!, /not a topic file/);
	for (let i = 0; i < MAX_TOPICS; i++) writeFileSync(path.join(staging, `t${i}.md`), formatTopic({ title: "T", description: "d", body: "b" }));
	rmSync(path.join(staging, "notes.txt"));
	assert.match(invalidTopics(staging)!, /at most 10/);
	copyTopics(live, staging);
	writeFileSync(path.join(staging, "empty.md"), "---\ntitle: Empty\ndescription: nothing\n---\n");
	assert.match(invalidTopics(staging)!, /empty/);

	copyTopics(live, staging);
	writeFileSync(path.join(staging, "itinerary.md"), formatTopic({ title: "Itinerary", description: "Where and when", body: "Day 1: Vienna\nDay 2: Graz" }));
	replaceTopics(staging, live);
	assert.deepEqual(readTopics(live).map(t => t.slug), ["budget", "itinerary"]);
	copyTopics(live, staging);
	rmSync(path.join(staging, "budget.md"));
	replaceTopics(staging, live);
	assert.deepEqual(readTopics(live).map(t => t.slug), ["itinerary"], "a topic the worker deleted is gone");

	assert.match(topicToolText(live, { topics: ["itinerary"] }), /Day 2: Graz/);
	assert.match(topicToolText(live, { topics: ["nope"] }), /No topic "nope"[\s\S]*itinerary/);
	assert.equal(topicToolText(live, { query: "graz" }).split("\n")[0], "itinerary: Day 2: Graz");
	assert.match(topicToolText(live), /itinerary: Itinerary — Where and when/);
});

