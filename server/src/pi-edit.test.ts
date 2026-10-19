import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("editing rewrites only the chosen message in pi's session file", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-edit-"));
	process.env.PI_SESSIONS_DIR = path.join(dir, "sessions");
	process.env.DATA_DIR = path.join(dir, "data");
	const { PiRpcAdapter, sessionDirFor } = await import("./harness/pi-rpc.js");
	const { replaceText } = await import("./harness/live-base.js");
	try {
		const cwd = path.join(dir, "work");
		mkdirSync(sessionDirFor(cwd), { recursive: true });
		const file = path.join(sessionDirFor(cwd), "s.jsonl");
		const answer = [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "First " }, { type: "toolCall", id: "t", name: "bash" }, { type: "text", text: "Done." }];
		const records = [
			{ type: "session", id: "s1", cwd, timestamp: "2026-10-19T10:00:00Z" },
			{ type: "message", id: "a", parentId: null, message: { role: "user", content: [{ type: "text", text: "fix the bug" }], timestamp: 1 } },
			{ type: "message", id: "b", parentId: "a", message: { role: "assistant", content: answer, timestamp: 2 } },
		];
		writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
		const adapter = new PiRpcAdapter();

		await adapter.editMessage("s1", cwd, 0, replaceText(records[1].message!.content, "fix the bug in auth", "fix the bug"));
		const answerEdit = replaceText(answer, "All done.", "Done.");
		await adapter.editMessage("s1", cwd, 1, answerEdit);
		const { messages } = (await adapter.readSession("s1", cwd))!;
		assert.deepEqual(messages[0].content, [{ type: "text", text: "fix the bug in auth" }]);
		assert.deepEqual(messages[1].content, [...answer.slice(0, 3), { type: "text", text: "All done." }], "reasoning and tool calls stay");
		assert.equal(readFileSync(file, "utf8").split("\n")[0], JSON.stringify(records[0]), "other lines are untouched");

		assert.equal(replaceText(answer, "x", "stale text"), undefined, "a stale edit is refused");
		assert.deepEqual(replaceText(answer, "Merged", "First Done."), [answer[0], { type: "text", text: "Merged" }, answer[2]], "the whole text can be replaced too");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
