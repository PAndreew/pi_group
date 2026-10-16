import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const write = (file: string, text: string) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
};

test("installed pi resources and MCP config are read from disk without secrets", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-inventory-"));
	const agent = path.join(dir, "agent");
	const project = path.join(dir, "project");
	mkdirSync(path.join(project, ".git"), { recursive: true });
	process.env.DATA_DIR = path.join(dir, "data");
	process.env.PI_CODING_AGENT_DIR = agent;
	// No pi on PATH under this name: the MCP report falls back to the config files.
	process.env.PI_BIN = path.join(dir, "no-such-pi");

	write(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:@acme/pi-tools@1.0.0", { source: "git:github.com/acme/x" }] }));
	write(path.join(agent, "extensions", "hello.ts"), "export default () => {}");
	write(path.join(agent, "extensions", "folder-ext", "index.js"), "");
	write(path.join(agent, "extensions", "notes.txt"), "not an extension");
	write(path.join(agent, "skills", "group", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: Work with PDF files\n---\nBody");
	write(path.join(project, ".pi", "prompts", "fix-tests.md"), "---\ndescription: Fix failing tests\n---\nFix them.");
	write(path.join(agent, "mcp.json"), JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "server-github"], env: { GITHUB_TOKEN: "secret" } }, web: { url: "https://user:pw@mcp.example.com/mcp?token=secret", headers: { Authorization: "Bearer secret" } } } }));
	write(path.join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { github: { enabled: false } } }));

	try {
		const { piResources, mcpReport } = await import("./inventory.js");
		const resources = piResources(project);
		const names = resources.map((r) => `${r.kind}:${r.name}:${r.scope}`).sort();
		assert.deepEqual(names, [
			"extension:folder-ext:user",
			"extension:hello:user",
			"package:git:github.com/acme/x:user",
			"package:npm:@acme/pi-tools@1.0.0:user",
			"prompt:/fix-tests:project",
			"skill:pdf:user",
		]);
		assert.equal(resources.find((r) => r.kind === "skill")?.description, "Work with PDF files");

		const asAdmin = await mcpReport(project, true);
		assert.equal(asAdmin.live, false);
		const github = asAdmin.servers.find((s) => s.name === "github");
		assert.equal(github?.enabled, false, "the project entry overrides enabled");
		assert.equal(github?.target, "npx -y server-github");
		assert.equal(asAdmin.servers.find((s) => s.name === "web")?.target, "https://mcp.example.com/mcp");
		assert.doesNotMatch(JSON.stringify(asAdmin), /secret|pw@/);

		const asMember = await mcpReport(project, false);
		assert.ok(asMember.servers.every((s) => s.target === undefined));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
