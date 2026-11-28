import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ClaudeCodeAdapter, claudeEnv } from "./harness/claude-code.js";
import type { LiveSession } from "./harness/types.js";

const done = (live: LiveSession) => new Promise<void>(resolve => {
	const unsub = live.subscribe(event => {
		if (event.type === "status" && !event.status.running) { unsub(); resolve(); }
	});
});

test("Claude maps top-level tool and thinking events and resumes from disk", { timeout: 8000 }, async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "beezy-claude-"));
	const binary = path.join(root, "claude");
	await fs.writeFile(binary, `#!${process.execPath}
const write = x => console.log(JSON.stringify(x));
const id = 'abcdef00-1234-4321-8888-0123456789ab';
if (process.argv[2] === 'auth') {
  const bad = require('node:fs').existsSync('no-login');
  write({ loggedIn: true, authMethod: bad ? 'api_key' : 'claude.ai', subscriptionType: 'pro' });
} else {
  let input = '';
  process.stdin.on('data', data => input += data);
  process.stdin.on('end', () => {
    write({type:'system', subtype:'init', session_id:id});
    if (input === 'hang') { setInterval(() => {}, 500); return; }
    const resumed = process.argv.includes('--resume') && process.argv.at(-1) === id;
    write({type:'stream_event', event:{type:'content_block_delta', index:0, delta:{type:'thinking_delta', thinking:'Inspect the file'}}});
    const call = {type:'assistant', uuid:'a', message:{content:[{type:'thinking', thinking:'Inspect the file'},{type:'tool_use', id:'read1', name:'Read', input:{file_path:'README.md'}}]}};
    write({...call, parent_tool_use_id:'nested', uuid:'nested'});
    write(call); write(call);
    write({type:'user', message:{content:[{type:'tool_result', tool_use_id:'read1', content:'file contents'}]}});
    write({type:'assistant', uuid:'b', message:{content:[{type:'text', text:resumed ? 'resumed' : input}]}});
    write({type:'result', subtype:'success', is_error:false});
  });
}
`, { mode: 0o700 });
	const transcripts = path.join(root, "history");
	const adapter = new ClaudeCodeAdapter(transcripts, binary);
	const reopened = new ClaudeCodeAdapter(transcripts, binary);
	try {
		const live = await adapter.create(root, { name: "A chat", ownerId: "alice" });
		const finished = done(live);
		await live.prompt({ text: "-prompt is not an argument" });
		await finished;
		assert.equal(live.state.notice, undefined);
		assert.deepEqual(live.state.messages.map(m => m.role), ["user", "assistant", "toolResult", "assistant"]);
		assert.deepEqual(live.state.messages[1]?.content, [{ type: "thinking", thinking: "Inspect the file" }, { type: "toolCall", id: "read1", name: "Read", arguments: { file_path: "README.md" } }]);
		assert.equal(live.state.messages[2]?.toolCallId, "read1");
		assert.equal(live.state.partial, null);
		assert.deepEqual(live.state.runningTools, []);
		await live.close();
		const restored = await reopened.open(live.id, root);
		assert.equal(restored.state.messages.length, 4);
		const followup = done(restored);
		await restored.prompt({ text: "What did you read?" });
		await followup;
		assert.deepEqual(restored.state.messages.at(-1)?.content, [{ type: "text", text: "resumed" }]);
		await restored.prompt({ text: "hang" });
		await assert.rejects(restored.prompt({ text: "overlap" }), /finish or press Stop/);
		await restored.abort();
		assert.equal(restored.state.messages.at(-1)?.stopReason, "aborted");
		await fs.writeFile(path.join(root, "no-login"), "");
		const rejected = done(restored);
		await restored.prompt({ text: "Do not use API billing" });
		await rejected;
		assert.match(restored.state.notice?.text ?? "", /Pro or Max subscription/);
		await reopened.deleteSession(live.id, root);
		assert.deepEqual(await reopened.listSessions(root), []);
	} finally {
		await Promise.all([adapter.shutdown(), reopened.shutdown()]);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("Claude child gets host login environment but not Beezy credentials", () => {
	assert.deepEqual(claudeEnv({ HOME: "/home/beezy", ANTHROPIC_API_KEY: "key", CLAUDE_CODE_OAUTH_TOKEN: "token", ANTHROPIC_BASE_URL: "proxy" }), { HOME: "/home/beezy" });
});
