import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { runPi } from "./harness/pi-rpc.js";

/**
 * What pi has installed for a folder, read from disk without starting pi: the user's agent dir
 * (~/.pi/agent) and the project's .pi dir (pi only loads the latter for trusted projects).
 */
export interface PiResource {
	kind: "package" | "extension" | "skill" | "prompt";
	name: string;
	scope: "user" | "project";
	path?: string;
	description?: string;
}

function readJson(file: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

const entries = (dir: string) => {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
};

/** `description:` from a SKILL.md / prompt template frontmatter. */
function frontmatterDescription(file: string) {
	try {
		const text = readFileSync(file, "utf8").slice(0, 4000);
		const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
		return block && /^description:\s*["']?(.+?)["']?\s*$/m.exec(block)?.[1];
	} catch {
		return undefined;
	}
}

function skillsIn(dir: string, scope: PiResource["scope"], out: PiResource[], depth = 0) {
	if (depth > 3) return;
	for (const entry of entries(dir)) {
		if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const folder = path.join(dir, entry.name);
		const skill = path.join(folder, "SKILL.md");
		if (existsSync(skill)) out.push({ kind: "skill", name: entry.name, scope, path: skill, description: frontmatterDescription(skill) });
		else skillsIn(folder, scope, out, depth + 1);
	}
}

function scanDir(base: string, scope: PiResource["scope"], out: PiResource[]) {
	const settings = readJson(path.join(base, "settings.json"));
	for (const pkg of (settings?.packages as unknown[]) ?? []) {
		const source = typeof pkg === "string" ? pkg : (pkg as { source?: string })?.source;
		if (source) out.push({ kind: "package", name: source, scope });
	}
	for (const entry of entries(path.join(base, "extensions"))) {
		const file = path.join(base, "extensions", entry.name);
		const isModule = entry.isFile() && /\.(ts|js|mjs)$/.test(entry.name);
		const isFolder = entry.isDirectory() && ["index.ts", "index.js", "package.json"].some((f) => existsSync(path.join(file, f)));
		if (isModule || isFolder) out.push({ kind: "extension", name: entry.name.replace(/\.(ts|js|mjs)$/, ""), scope, path: file });
	}
	skillsIn(path.join(base, "skills"), scope, out);
	for (const entry of entries(path.join(base, "prompts"))) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const file = path.join(base, "prompts", entry.name);
		out.push({ kind: "prompt", name: `/${entry.name.slice(0, -3)}`, scope, path: file, description: frontmatterDescription(file) });
	}
}

export function piResources(cwd: string): PiResource[] {
	const out: PiResource[] = [];
	scanDir(config.piAgentDir, "user", out);
	skillsIn(path.join(os.homedir(), ".agents", "skills"), "user", out);
	// Project resources: .pi in the folder, and .agents/skills there and in parents up to the repo root.
	scanDir(path.join(cwd, ".pi"), "project", out);
	for (let dir = cwd; ; dir = path.dirname(dir)) {
		skillsIn(path.join(dir, ".agents", "skills"), "project", out);
		if (existsSync(path.join(dir, ".git")) || path.dirname(dir) === dir) break;
	}
	return out;
}

export interface McpServerInfo {
	name: string;
	scope?: string;
	transport?: string;
	enabled: boolean;
	state?: string;
	tools?: string[];
	error?: string;
	/** Launch command or URL; admins only, and never env or headers (they hold secrets). */
	target?: string;
}

export interface McpReport {
	servers: McpServerInfo[];
	/** Whether the states come from pi actually connecting, or only from the config files. */
	live: boolean;
	note?: string;
}

/** Config entries from mcp.json files; a project entry replaces the user one with the same name. */
function configuredServers(cwd: string, admin: boolean): McpServerInfo[] {
	const byName = new Map<string, McpServerInfo>();
	for (const [scope, file] of [
		["user", path.join(config.piAgentDir, "mcp.json")],
		["project", path.join(cwd, ".pi", "mcp.json")],
	] as const) {
		const servers = (readJson(file)?.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
		for (const [name, entry] of Object.entries(servers)) {
			const url = typeof entry.url === "string" ? safeUrl(entry.url) : undefined;
			const command = typeof entry.command === "string" ? [entry.command, ...((entry.args as string[]) ?? [])].join(" ") : undefined;
			const previous = byName.get(name);
			byName.set(name, {
				name,
				scope,
				transport: (entry.type as string) ?? (url ? "http" : command ? "stdio" : previous?.transport),
				enabled: entry.enabled !== false,
				target: admin ? (command ?? url ?? previous?.target) : undefined,
			});
		}
	}
	return [...byName.values()];
}

/** Drop credentials and query strings from a server URL. */
function safeUrl(value: string) {
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return undefined;
	}
}

/** MCP servers pi would load in `cwd`: `pi mcp list --json` connects to each; the config files are the fallback. */
export async function mcpReport(cwd: string, admin: boolean): Promise<McpReport> {
	const configured = configuredServers(cwd, admin);
	const result = await runPi(["mcp", "list", "--json"], cwd, 45_000);
	try {
		const data = JSON.parse(result.stdout) as { servers: Record<string, unknown>[]; errors?: unknown[]; note?: string };
		const servers = data.servers.map((s) => ({
			name: String(s.name),
			scope: s.scope as string | undefined,
			transport: s.transport as string | undefined,
			enabled: s.enabled !== false,
			state: s.state as string | undefined,
			tools: Array.isArray(s.tools) ? s.tools.map(String) : undefined,
			error: s.error ? String(s.error) : undefined,
			target: configured.find((c) => c.name === s.name)?.target,
		}));
		const errors = (data.errors ?? []).map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
		return { servers, live: true, note: [data.note, ...errors].filter(Boolean).join(" ") || undefined };
	} catch {
		const reason = result.stderr.trim().split("\n").at(-1) || `pi mcp list exited with ${result.code}`;
		return { servers: configured, live: false, note: `Showing the config files only; pi could not report live status (${reason}).` };
	}
}

