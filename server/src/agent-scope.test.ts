import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";

test("agent bridge enforces project writes, read-only butler, delegation and ACLs", async () => {
	const root = mkdtempSync(path.join(os.homedir(), ".beezy-agent-test-"));
	for (const dir of ["data", "agent", "workspace", "workspace/project", "workspace/other", "workspace/general"]) mkdirSync(path.join(root, dir), { recursive: true });
	process.env.DATA_DIR = path.join(root, "data");
	process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
	process.env.FS_ROOT = path.join(root, "workspace");
	process.env.CHAT_FOLDER = path.join(root, "workspace/general");
	writeFileSync(path.join(root, "data/tool-capabilities.json"), JSON.stringify([{ id: "drive", name: "Drive", tools: [{ name: "drive_read", access: "read", allow: { operation: ["list", "download"] } }, { name: "drive_write", access: "write" }] }]));
	const { loadStore, store } = await import("./store.js");
	const { createUser } = await import("./auth.js");
	const { authorizeAgentRun, mountAgentScope } = await import("./agent-scope.js");
	const { interactionEnvironment } = await import("./interactions.js");
	loadStore();
	const owner = createUser("owner", "password123", "member");
	const other = createUser("other", "password123", "member");
	const at = new Date().toISOString();
	store.data.projects.push(
		{ id: "project", tenantId: "work", name: "Project", cwd: path.join(root, "workspace/project"), createdBy: owner.id, createdAt: at, updatedAt: at },
		{ id: "other", tenantId: "work", name: "Other", cwd: path.join(root, "workspace/other"), createdBy: other.id, createdAt: at, updatedAt: at },
	);
	writeFileSync(path.join(root, "workspace/other/secret"), "private");
	const scoped = store.upsertSession({ key: "pi:project", id: "project", harness: "pi", cwd: path.join(root, "workspace/project"), projectId: "project", ownerId: owner.id });
	const butler = store.upsertSession({ key: "pi:butler", id: "butler", harness: "pi", cwd: path.join(root, "workspace/general"), ownerId: owner.id });
	const privateSession = store.upsertSession({ key: "pi:private", id: "private", harness: "pi", cwd: path.join(root, "workspace/other"), ownerId: other.id });
	authorizeAgentRun(scoped, owner);
	authorizeAgentRun(butler, owner);
	const delegated: unknown[] = [];
	const app = express();
	app.use(express.json());
	mountAgentScope(app, {
		delegate: async (user, projectId, prompt) => { delegated.push({ userId: user.id, projectId, prompt }); return "pi:child"; },
		readSession: async meta => ({ key: meta.key, transcript: "allowed" }),
	});
	app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => void res.status(error.status ?? 500).json({ error: error.message }));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const call = async (key: string, body: unknown, token = interactionEnvironment(key).BEEZY_INTERACTION_TOKEN) => {
		const response = await fetch(`http://127.0.0.1:${address.port}/agent-bridge/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return { status: response.status, body: await response.json() };
	};
	try {
		assert.equal((await call(scoped.key, { action: "scope" }, "wrong")).status, 403);
		assert.equal((await call(privateSession.key, { action: "scope" })).status, 403);
		assert.equal((await call(scoped.key, { action: "scope" })).body.butler, false);
		assert.deepEqual((await call(scoped.key, { action: "tool_policy" })).body.tools, ["web_search"]);
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "drive_read", input: { operation: "list" } })).status, 403);
		const project = store.data.projects.find(p => p.id === "project")!;
		project.capabilities = { drive: "read" };
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "drive_read", input: { operation: "list" } })).status, 200);
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "drive_read", input: { operation: "delete" } })).status, 403);
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "drive_write" })).status, 403);
		project.capabilities.drive = "write";
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "drive_write" })).status, 200);
		project.capabilities.drive = "off";
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "drive_read", input: { operation: "list" } })).status, 403);
		project.capabilities["web-search"] = "off";
		assert.equal((await call(scoped.key, { action: "web_search", query: "test" })).status, 403);
		assert.equal((await call(scoped.key, { action: "authorize_tool", tool: "bash" })).status, 403);
		const general = store.data.projects.find(p => p.general)!;
		general.capabilities = { drive: "write" };
		assert.equal((await call(butler.key, { action: "authorize_tool", tool: "drive_write" })).status, 403);
		assert.equal((await call(butler.key, { action: "authorize_tool", tool: "drive_read", input: { operation: "list" } })).status, 200);
		assert.equal((await call(butler.key, { action: "scope" })).body.butler, true);
		assert.equal((await call(scoped.key, { action: "bash", command: "printf hello > result" })).body.exitCode, 0);
		assert.equal(readFileSync(path.join(root, "workspace/project/result"), "utf8"), "hello");
		const sockets = await call(scoped.key, { action: "bash", command: `python3 -c 'import socket; socket.socket(socket.AF_UNIX)'` });
		assert.notEqual(sockets.body.exitCode, 0);
		assert.match(sockets.body.output, /Operation not permitted/);
		assert.equal((await call(scoped.key, { action: "bash", command: `/bin/sh -c 'printf child'` })).body.output, "child");
		assert.notEqual((await call(scoped.key, { action: "bash", command: `cat '${root}/workspace/other/secret'` })).body.exitCode, 0);
		assert.notEqual((await call(butler.key, { action: "bash", command: "printf bad > result" })).body.exitCode, 0);
		assert.equal((await call(butler.key, { action: "bash", command: "cat result" })).body.output, "hello");
		assert.equal((await call(scoped.key, { action: "delegate", projectId: "project", prompt: "Do it" })).status, 403);
		assert.equal((await call(butler.key, { action: "delegate", projectId: "other", prompt: "Do it" })).status, 403);
		assert.equal((await call(butler.key, { action: "delegate", projectId: "project", prompt: "Do it" })).body.sessionKey, "pi:child");
		assert.deepEqual(delegated, [{ userId: owner.id, projectId: "project", prompt: "Do it" }]);
		assert.equal((await call(butler.key, { action: "read_session", key: privateSession.key })).status, 404);
		assert.equal((await call(butler.key, { action: "read_session", key: scoped.key })).status, 200);
		assert.equal((await call(scoped.key, { action: "sessions" })).status, 403);
		assert.throws(() => authorizeAgentRun(scoped, other, true));
		store.data.tenants[0].memberIds = store.data.tenants[0].memberIds.filter(id => id !== owner.id);
		assert.equal((await call(butler.key, { action: "scope" })).status, 403);
	} finally {
		server.closeAllConnections();
		await new Promise<void>(resolve => server.close(() => resolve()));
		rmSync(root, { recursive: true, force: true });
	}
});
