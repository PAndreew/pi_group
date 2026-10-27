import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("user-level MCP servers become per-project capabilities, on by default, without exposing credentials", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-mcp-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	const file = path.join(dir, "mcp.json");
	const config = { mcpServers: {
		"google-workspace": { command: "workspace-mcp", args: ["--read-only"], env: { PRIVATE_TOKEN: "never-in-public-response" } },
		github: { url: "https://example.com/mcp", description: "Issues and PRs" },
		off: { command: "x", enabled: false },
	} };
	try {
		writeFileSync(file, JSON.stringify(config));
		const { mcpCapabilities, capabilityTools, requireCapabilityTool, capabilityAccess } = await import("./tool-capabilities.js");
		const capabilities = mcpCapabilities();
		assert.deepEqual(capabilities.map(c => c.id), ["mcp-google-workspace", "mcp-github"]);
		assert.ok(!JSON.stringify(capabilities).includes("never-in-public-response"));
		assert.equal(capabilities[0].tools[0].access, "read");
		assert.equal(capabilities[1].tools[0].access, "write");
		assert.equal(capabilities[1].description, "Issues and PRs");

		const project = { id: "p", name: "P", cwd: dir, createdBy: "owner", createdAt: "", updatedAt: "" } as Parameters<typeof capabilityTools>[0];
		assert.equal(capabilityAccess(project, "mcp-github"), "write");
		const candidates = ["mcp__github__create_issue", "mcp__google_workspace__search_drive_files", "mcp__unknown__x"];
		assert.deepEqual(capabilityTools(project, false, candidates).filter(n => !n.endsWith("*")), ["web_search", "mcp__github__create_issue", "mcp__google_workspace__search_drive_files"]);
		assert.doesNotThrow(() => requireCapabilityTool(project, "mcp__github__create_issue"));
		assert.throws(() => requireCapabilityTool(project, "mcp__unknown__x"), /not enabled/);
		// The read-only butler keeps read-only servers only.
		assert.throws(() => requireCapabilityTool(project, "mcp__github__create_issue", true), /not enabled/);
		assert.doesNotThrow(() => requireCapabilityTool(project, "mcp__google_workspace__search_drive_files", true));
		project.capabilities = { "mcp-github": "off" };
		assert.throws(() => requireCapabilityTool(project, "mcp__github__create_issue"), /not enabled/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
