import assert from "node:assert/strict";
import { test } from "node:test";

test("runtime filtering preserves originals, defers tools, handles revocation and fails safely", async () => {
	const originalFetch = globalThis.fetch;
	process.env.BEEZY_ASSISTANCE_URL = "http://bridge.test";
	process.env.BEEZY_INTERACTION_TOKEN = "test-token";
	const settings = { injectionChecks: false, contextExtraction: false, toolSelection: false };
	let runId = "run-1";
	let bridgeDown = false;
	let checkFails = false;
	let suspicious = false;
	let extractsFail = false;
	let checkCalls = 0;
	let extractCalls = 0;
	let selected = ["search"];
	globalThis.fetch = async (input, init) => {
		assert.ok(String(input).startsWith("http://bridge.test"), "extension must only call local bridge");
		if (bridgeDown) throw new Error("unavailable");
		const action = new URL(String(input)).pathname;
		if (action === "/") return Response.json({ runId, settings });
		if (action === "/check") {
			checkCalls++;
			if (checkFails) throw new Error("check failed");
			return Response.json({ checked: true, suspicious });
		}
		if (action === "/extract") {
			extractCalls++;
			if (extractsFail) throw new Error("extract failed");
			return Response.json({ excerpts: ["relevant source passage"] });
		}
		if (action === "/select") {
			const body = JSON.parse(init!.body as string);
			assert.equal(body.tools.some((t: any) => t.name === "disabled"), false);
			return Response.json({ tools: selected });
		}
		throw new Error(`Unexpected path ${action}`);
	};
	const handlers: Record<string, any> = {};
	const tools = new Map<string, any>();
	let active = ["read", "search", "vault_get_secret"];
	const notices: string[] = [];
	const entries: any[] = [];
	const pi = {
		on: (name: string, handler: any) => { handlers[name] = handler; },
		registerTool: (tool: any) => { tools.set(tool.name, tool); active.push(tool.name); },
		registerCommand: () => {},
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => { active = [...names]; },
		getAllTools: () => ["read", "search", "disabled", "vault_get_secret", ...tools.keys()].map(name => ({ name, description: `${name} capability` })),
		appendEntry: (_type: string, data: any) => { entries.push(data); },
	};
	const ctx = { ui: { notify: (message: string) => notices.push(message) }, sessionManager: { getBranch: () => entries } };
	const original: any = { role: "toolResult", toolName: "search", toolCallId: "call-1", content: [{ type: "text", text: "relevant source passage\n" + "irrelevant ".repeat(1000) }] };
	const messages = [{ role: "user", content: "find source passage" }, original];
	try {
		const { default: extension } = await import("../extensions/cloudflare-assistance.mjs" as string);
		extension(pi);
		await handlers.session_start({}, ctx);
		assert.deepEqual(active, ["read", "search", "vault_get_secret"]);
		await handlers.input({}, ctx);
		assert.equal(await handlers.context({ messages }, ctx), undefined);
		assert.equal(checkCalls + extractCalls, 0);

		settings.contextExtraction = true;
		settings.toolSelection = true;
		runId = "run-2";
		await handlers.input({}, ctx);
		assert.deepEqual(active, ["beezy_find_tools", "beezy_open_result"]);
		await handlers.before_agent_start({ prompt: "find source passage" }, ctx);
		assert.equal(entries.at(-1).runId, "run-2");
		await tools.get("beezy_find_tools").execute("find", { goal: "search" });
		assert.deepEqual(active, ["beezy_find_tools", "beezy_open_result", "search"]);
		selected = ["disabled"];
		await assert.rejects(tools.get("beezy_find_tools").execute("find", { goal: "anything" }), /Invalid selected/);
		const filtered = await handlers.context({ messages }, ctx);
		assert.match(filtered.messages[1].content[0].text, /Untrusted excerpts/);
		assert.equal(filtered.messages[1].content[0].text.includes("irrelevant"), false);
		assert.equal(original.content[0].text.includes("irrelevant"), true, "saved original must not be mutated");
		await handlers.context({ messages }, ctx);
		assert.equal(extractCalls, 1, "same task/result should use cache");
		await handlers.context({ messages: [{ role: "user", content: "different task" }, original] }, ctx);
		assert.equal(extractCalls, 2, "new task must invalidate extraction cache");
		extractsFail = true;
		const fallback = await handlers.context({ messages: [{ role: "user", content: "another task" }, original] }, ctx);
		assert.match(fallback.messages[1].content[0].text, /unavailable/);
		assert.equal(fallback.messages[1].content[1].text, original.content[0].text);
		extractsFail = false;

		settings.injectionChecks = true;
		runId = "run-3";
		await handlers.input({}, ctx);
		suspicious = true;
		const withheld = await handlers.context({ messages }, ctx);
		assert.match(withheld.messages[1].content[0].text, /withheld/);
		assert.equal(extractCalls, 3, "unsafe content must not be extracted");
		assert.equal(checkCalls, 1);
		await handlers.context({ messages }, ctx);
		assert.equal(checkCalls, 1);
		suspicious = false;
		checkFails = true;
		const unknown = await handlers.context({ messages: [{ ...original, toolCallId: "call-2", content: [{ type: "text", text: "unchecked" }] }] }, ctx);
		assert.match(unknown.messages[0].content[0].text, /withheld/);
		checkFails = false;
		bridgeDown = true;
		const unavailable = await handlers.context({ messages }, ctx);
		assert.match(unavailable.messages[1].content[0].text, /withheld/);
		assert.equal((await handlers.input({}, ctx)).action, "handled");
		bridgeDown = false;
		runId = "run-4";
		await handlers.input({}, ctx);

		const before = checkCalls;
		const secret = { ...original, toolName: "vault_get_secret", content: [{ type: "text", text: "SECRET" }] };
		const sensitive = await handlers.context({ messages: [secret] }, ctx);
		assert.equal(sensitive.messages[0].content[0].text, "SECRET");
		assert.equal(checkCalls, before, "known credentials must not be sent to Cloudflare");
		const secretRead = { role: "toolResult", toolName: "read", toolCallId: "env-read", content: [{ type: "text", text: "ENV_SECRET" }] };
		await handlers.context({ messages: [{ role: "assistant", content: [{ type: "toolCall", id: "env-read", arguments: { path: ".env" } }] }, secretRead] }, ctx);
		assert.equal(checkCalls, before, "root credential-file reads must not be sent to Cloudflare");
		const code = { ...original, toolName: "read" };
		const exact = await handlers.context({ messages: [code] }, ctx);
		assert.equal(exact.messages[0].content[0].text, original.content[0].text, "exact file reads are not compressed");

		entries.push({ message: original });
		const recovered = await tools.get("beezy_open_result").execute("open", { toolCallId: "call-1", offset: 0 }, undefined, undefined, ctx);
		assert.match(recovered.content[0].text, /Original untrusted result/);
		assert.ok(recovered.content[0].text.length <= 12200);
		entries.push({ message: { ...secret, toolCallId: "secret-1" } });
		await assert.rejects(tools.get("beezy_open_result").execute("open", { toolCallId: "secret-1" }, undefined, undefined, ctx), /credential results/);

		settings.injectionChecks = false;
		settings.contextExtraction = false;
		settings.toolSelection = false;
		await handlers.context({ messages }, ctx);
		assert.deepEqual(active, ["read", "search", "vault_get_secret"]);
		const previousChecks = checkCalls;
		assert.equal(await handlers.context({ messages }, ctx), undefined);
		assert.equal(checkCalls, previousChecks);
	} finally {
		globalThis.fetch = originalFetch;
		delete process.env.BEEZY_ASSISTANCE_URL;
		delete process.env.BEEZY_INTERACTION_TOKEN;
	}
});
