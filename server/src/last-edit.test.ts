import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("the file preview finds the last existing file a write or edit touched, inside the root", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "beezy-last-edit-"));
	process.env.FS_ROOT = root;
	mkdirSync(path.join(root, "proj/src"), { recursive: true });
	writeFileSync(path.join(root, "proj/src/app.ts"), "");
	writeFileSync(path.join(root, "proj/notes.md"), "");
	const { lastEditedFile } = await import("./sessions.js");
	const call = (name: string, args: Record<string, unknown>) => ({ type: "toolCall", name, arguments: args });
	const cwd = path.join(root, "proj");
	try {
		const messages = [
			{ role: "assistant", content: [call("write", { path: "notes.md" })] },
			{ role: "assistant", content: [call("edit", { path: "src/app.ts" }), call("read", { path: "notes.md" })] },
			{ role: "assistant", content: [call("write", { path: "deleted.txt" }), call("edit", { file_path: "/etc/passwd" })] },
		];
		assert.equal(lastEditedFile(messages, cwd), "proj/src/app.ts");
		assert.equal(lastEditedFile(messages.slice(0, 1), cwd), "proj/notes.md");
		assert.equal(lastEditedFile([{ role: "user", content: "hi" }], cwd), undefined);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
