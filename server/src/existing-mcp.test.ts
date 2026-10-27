import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("existing read-only Workspace registration is reused without credentials in capability views", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-existing-mcp-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	const file = path.join(dir, "mcp.json");
	const config = { mcpServers: { "google-workspace": { command: "/existing/venv/bin/workspace-mcp", args: ["--transport", "stdio", "--tools", "drive", "--tool-tier", "core", "--read-only"], env: { PRIVATE_TOKEN: "never-in-public-response" }, enabled: true } } };
	try {
		writeFileSync(file, JSON.stringify(config));
		const { existingWorkspaceCapability, capabilityTools } = await import("./tool-capabilities.js");
		const capabilities = existingWorkspaceCapability();
		assert.equal(capabilities.length, 1);
		assert.equal(capabilities[0].id, "google-workspace");
		assert.equal(capabilities[0].tools.length, 4);
		assert.ok(capabilities[0].tools.every(t => t.access === "read"));
		assert.ok(!JSON.stringify(capabilities).includes("never-in-public-response"));
		const project = { id: "voxi", name: "Voxi", cwd: dir, createdBy: "owner", createdAt: "", updatedAt: "", capabilities: { "google-workspace": "read" as const } };
		assert.ok(capabilityTools(project).includes("mcp__google_workspace__search_drive_files"));
		config.mcpServers["google-workspace"].enabled = false;
		writeFileSync(file, JSON.stringify(config));
		assert.equal(existingWorkspaceCapability().length, 0);
		assert.ok(!capabilityTools(project).includes("mcp__google_workspace__search_drive_files"));
		config.mcpServers["google-workspace"].enabled = true;
		config.mcpServers["google-workspace"].args = [];
		writeFileSync(file, JSON.stringify(config));
		assert.equal(existingWorkspaceCapability().length, 0, "Do not automatically trust a writable MCP as read-only");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
