import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("scope extension refreshes tools and rechecks revocation on every call", async () => {
	const previousFetch = globalThis.fetch;
	const previousUrl = process.env.BEEZY_AGENT_URL;
	const previousToken = process.env.BEEZY_INTERACTION_TOKEN;
	process.env.BEEZY_AGENT_URL = "http://localhost/test";
	process.env.BEEZY_INTERACTION_TOKEN = "test";
	const handlers = new Map<string, (event: any) => Promise<any>>();
	const tools: string[] = [];
	let active: string[] = [];
	let enabled = true;
	let oldServer = false;
	globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
		const body = JSON.parse(String(options.body));
		if (oldServer && body.action === "tool_policy") return Response.json({ error: "Unknown action" }, { status: 400 });
		if (body.action === "tool_policy") return Response.json({ tools: enabled ? ["web_search", "drive_read"] : [] });
		if (body.action === "authorize_tool") return enabled && body.tool === "drive_read" ? Response.json({ allowed: true }) : Response.json({ error: "Capability access denied" }, { status: 403 });
		return Response.json({});
	}) as typeof fetch;
	try {
		const file = pathToFileURL(path.resolve(import.meta.dirname, "../extensions/project-scope.mjs")).href;
		const { default: extension } = await import(file);
		extension({ registerTool: (tool: { name: string }) => tools.push(tool.name), on: (event: string, fn: any) => handlers.set(event, fn), registerCommand: () => {}, setActiveTools: (names: string[]) => { active = names; } });
		oldServer = true;
		await assert.rejects(() => handlers.get("before_agent_start")!({}), /Unknown action/);
		oldServer = false;
		await handlers.get("before_agent_start")!({});
		assert.ok(active.includes("web_search"));
		assert.ok(active.includes("drive_read"));
		assert.ok(tools.includes("web_search"));
		assert.equal(await handlers.get("tool_call")!({ toolName: "drive_read", input: {} }), undefined);
		enabled = false;
		assert.equal((await handlers.get("tool_call")!({ toolName: "drive_read", input: {} })).block, true);
		await handlers.get("before_agent_start")!({});
		assert.ok(!active.includes("drive_read"));
		assert.equal((await handlers.get("tool_call")!({ toolName: "bash", input: {} })).block, true);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousUrl === undefined) delete process.env.BEEZY_AGENT_URL; else process.env.BEEZY_AGENT_URL = previousUrl;
		if (previousToken === undefined) delete process.env.BEEZY_INTERACTION_TOKEN; else process.env.BEEZY_INTERACTION_TOKEN = previousToken;
	}
});
