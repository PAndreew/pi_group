import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { formatTopic, legacyMaster, overviewFile, readOverview, readTopics, renderIndex, topicsDir, topicToolText, writeAtomic, writeIndex } from "./memory-topics.js";

test("memory topics: indexed with the overview, read by the tool; a master from before topics is kept aside", () => {
	const project = mkdtempSync(path.join(os.tmpdir(), "topics-"));
	const live = topicsDir(project);
	mkdirSync(live, { recursive: true });
	writeFileSync(path.join(project, "MEMORY.md"), "# Old master\nUse Postgres.");
	writeFileSync(path.join(live, "budget.md"), formatTopic({ title: "Budget", description: "Costs and limits", body: "Hotel: 120 EUR/night." }));
	writeIndex(project);
	assert.equal(legacyMaster(project), "# Old master\nUse Postgres.", "the old master is not overwritten by the index");
	assert.match(readFileSync(path.join(project, "MEMORY.md"), "utf8"), /\[`budget`\]\(memory\/topics\/budget\.md\) — Budget: Costs and limits/);
	const fromSub = renderIndex(readTopics(live), "", "..");
	assert.match(fromSub, /\]\(\.\.\/memory\/topics\/budget\.md\)/, "links are relative to the reader's folder");
	assert.doesNotMatch(fromSub, /Hotel/, "topic bodies are not sent with the index");
	assert.equal(renderIndex([]), "");

	writeAtomic(overviewFile(project), "A family trip to Austria in May.\n");
	writeIndex(project);
	assert.equal(readOverview(project), "A family trip to Austria in May.");
	const master = readFileSync(path.join(project, "MEMORY.md"), "utf8");
	assert.ok(master.indexOf("A family trip") < master.indexOf("`budget`"), "the overview comes before the topic list");
	assert.match(renderIndex([], "Only an overview"), /Only an overview[\s\S]*No topics yet/);

	writeFileSync(path.join(live, "itinerary.md"), formatTopic({ title: "Itinerary", description: "Where and when", body: "Day 1: Vienna\nDay 2: Graz" }));
	assert.deepEqual(readTopics(live).map(t => t.slug), ["budget", "itinerary"]);
	assert.match(topicToolText(live, { topics: ["itinerary"] }), /Day 2: Graz/);
	assert.match(topicToolText(live, { topics: ["nope"] }), /No topic "nope"[\s\S]*itinerary/);
	assert.equal(topicToolText(live, { query: "graz" }).split("\n")[0], "itinerary: Day 2: Graz");
	assert.match(topicToolText(live), /itinerary: Itinerary — Where and when/);
});
