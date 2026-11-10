import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("project links: files and web pages people and agents gave, not tool output", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "beezy-links-"));
	process.env.FS_ROOT = root;
	mkdirSync(path.join(root, "proj/out"), { recursive: true });
	writeFileSync(path.join(root, "proj/report.md"), "");
	writeFileSync(path.join(root, "proj/out/chart.png"), "");
	writeFileSync(path.join(root, "proj/app.ts"), "");
	const { extractLinks } = await import("./links.js");
	const { wrapProjectMemory } = await import("../extensions/lib/context-policy.mjs");
	try {
		const links = extractLinks([
			{ role: "user", timestamp: 1, content: [{ type: "text", text: `${wrapProjectMemory("see https://memory.example/x")}Look at https://example.com/spec, and the [drive](https://drive.google.com/drive/folders/abc).` }] },
			{ role: "assistant", timestamp: 2, content: [
				{ type: "text", text: "Done: [report.md](report.md), [chart](out/chart.png), [gone](missing.md), [escape](../../etc/passwd), [top](#top), [mail](mailto:a@b.c)" },
				{ type: "toolCall", name: "edit", arguments: { path: "app.ts" } },
				{ type: "toolCall", name: "read", arguments: { path: "report.md" } },
			] },
			{ role: "toolResult", content: [{ type: "text", text: "https://drive.google.com/file/d/nested [x](report.md)" }] },
		], path.join(root, "proj"));
		assert.deepEqual(links.map((l) => [l.kind, l.target, l.label]), [
			["web", "https://drive.google.com/drive/folders/abc", "drive"],
			["web", "https://example.com/spec", undefined],
			["file", "proj/report.md", "report.md"],
			["file", "proj/out/chart.png", "chart"],
			["file", "proj/app.ts", undefined],
		]);
		assert.equal(links[0].at, new Date(1).toISOString());
	} finally { rmSync(root, { recursive: true, force: true }); }
});
