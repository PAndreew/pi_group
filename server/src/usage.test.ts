import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("usage records come from every assistant message and add up per day, model and session", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-usage-"));
	process.env.PI_SESSIONS_DIR = path.join(dir, "sessions");
	const { PiRpcAdapter, sessionDirFor } = await import("./harness/pi-rpc.js");
	const { dayOf, summarize } = await import("./usage.js");
	try {
		const cwd = path.join(dir, "work");
		mkdirSync(sessionDirFor(cwd), { recursive: true });
		const day1 = Date.parse("2026-10-20T10:00:00Z");
		const day2 = Date.parse("2026-10-21T10:00:00Z");
		const usage = (input: number, cacheRead: number, output: number, cost: number) => ({ input, output, cacheRead, cacheWrite: 0, reasoning: 10, totalTokens: input + cacheRead + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
		const records = [
			{ type: "session", id: "s1", cwd, timestamp: "2026-10-20T09:00:00Z" },
			{ type: "message", id: "a", parentId: null, message: { role: "user", content: "hi", timestamp: day1 } },
			{ type: "message", id: "b", parentId: "a", message: { role: "assistant", provider: "openai-codex", model: "gpt-6.1-sol", content: [], usage: usage(1000, 9000, 200, 0.01), timestamp: day1 + 1 } },
			// An abandoned branch: paid for, so it counts.
			{ type: "message", id: "c", parentId: "a", message: { role: "assistant", provider: "openai-codex", model: "gpt-6.1-sol", content: [], usage: usage(500, 0, 50, 0.005), timestamp: day1 + 2 } },
			{ type: "message", id: "d", parentId: "c", message: { role: "assistant", provider: "openrouter", model: "deepseek-v4-flash", content: [], usage: usage(100, 19900, 100, 0.001), timestamp: day2 } },
		];
		writeFileSync(path.join(sessionDirFor(cwd), "s.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
		const parsed = await new PiRpcAdapter().usageRecords("s1", cwd);
		assert.equal(parsed.length, 3);
		assert.deepEqual(parsed[0], { timestamp: day1 + 1, provider: "openai-codex", model: "gpt-6.1-sol", input: 1000, output: 200, cacheRead: 9000, cacheWrite: 0, reasoning: 10, cost: 0.01 });

		const summary = summarize([{ key: "pi:s1", name: "Demo", path: "work", records: parsed }], day1 - 3_600_000, day2 + 3_600_000, 0);
		assert.equal(summary.totals.calls, 3);
		assert.equal(summary.totals.cacheRead, 28900);
		assert.ok(Math.abs(summary.totals.cost - 0.016) < 1e-9);
		assert.deepEqual(summary.days.map((d) => [d.date, d.calls]), [["2026-10-20", 2], ["2026-10-21", 1]]);
		assert.deepEqual(summary.models.map((m) => [m.model, m.calls]), [["deepseek-v4-flash", 1], ["gpt-6.1-sol", 2]], "largest token volume first");
		assert.equal(summary.sessions[0].lastAt, day2);
		assert.equal(dayOf(Date.parse("2026-10-20T23:30:00Z"), -60), "2026-10-21", "days follow the viewer's time zone");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
