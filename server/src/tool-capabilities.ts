import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { HttpError } from "./paths.js";
import type { Project } from "./projects.js";

export type CapabilityAccess = "off" | "read" | "write";
const toolSchema = z.object({ name: z.string().min(1).max(200), access: z.enum(["read", "write"]), allow: z.record(z.string(), z.array(z.string()).min(1)).optional() }).strict();
const definitionSchema = z.object({
	id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
	name: z.string().min(1).max(100),
	description: z.string().max(1000).default(""),
	/** Trusted Pi extension files, including CLI/HTTP adapters. Not model-supplied commands. */
	extensions: z.array(z.string().refine(p => path.isAbsolute(p), "Extension paths must be absolute")).default([]),
	tools: z.array(toolSchema).min(1).max(200),
}).strict();
export type ToolCapability = z.infer<typeof definitionSchema>;
export const accessSchema = z.enum(["off", "read", "write"]);

// These escape hatches cannot be re-enabled by a capability manifest. A CLI adapter
// must expose a constrained operation, not forward arbitrary commands to a host shell.
const reserved = new Set(["scope", "scoped_bash", "delegate_project", "butler_sessions", "web_search", "read", "write", "edit", "bash", "powershell", "grep", "find", "ls", "codemode", "mcp", "tool_search", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);
export function parseCapabilities(value: unknown): ToolCapability[] {
	const definitions = z.array(definitionSchema).max(100).parse(value);
	const ids = new Set(["web-search"]);
	const names = new Set(reserved);
	for (const definition of definitions) {
		if (ids.has(definition.id)) throw new Error(`Duplicate/reserved capability: ${definition.id}`);
		ids.add(definition.id);
		for (const tool of definition.tools) {
			if (names.has(tool.name)) throw new Error(`Duplicate/reserved capability tool: ${tool.name}`);
			if (tool.name.includes("*")) throw new Error("Capability tools must use exact names, not wildcards");
			names.add(tool.name);
		}
	}
	return definitions;
}

/** Operator-owned manifest. Never discovered from a writable project directory. */
/** Reuse the existing audited, read-only Workspace MCP registration. No new credentials. */
export function existingWorkspaceCapability(): ToolCapability[] {
	const file = path.join(config.piAgentDir, "mcp.json");
	if (!existsSync(file)) return [];
	const server = JSON.parse(readFileSync(file, "utf8"))?.mcpServers?.["google-workspace"];
	if (!server || server.enabled === false || typeof server.command !== "string" || path.basename(server.command) !== "workspace-mcp" || !Array.isArray(server.args) || !server.args.includes("--read-only")) return [];
	return [{
		id: "google-workspace", name: "Google Drive", description: "Your existing Google Workspace MCP connection. Read-only Drive search and file access; reuses existing authentication.",
		extensions: [path.resolve(import.meta.dirname, "../extensions/registered-mcp.mjs")],
		tools: ["search_drive_files", "get_drive_file_content", "get_drive_file_download_url", "get_drive_shareable_link"].map(name => ({ name: `mcp__google_workspace__${name}`, access: "read" as const })),
	}];
}

export function toolCapabilities(): ToolCapability[] {
	const file = path.join(config.dataDir, "tool-capabilities.json");
	return [
		{ id: "web-search", name: "Web search", description: "Search the public web. Enabled by default; no account access or arbitrary URL fetching.", extensions: [], tools: [{ name: "web_search", access: "read" }] },
		...existingWorkspaceCapability(),
		...parseCapabilities(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []),
	];
}
export const capabilityAccess = (project: Project, id: string): CapabilityAccess => project.capabilities?.[id] ?? (id === "web-search" ? "read" : "off");
export function capabilityTools(project: Project, readOnly = false) {
	return toolCapabilities().flatMap(capability => {
		const access = capabilityAccess(project, capability.id);
		return capability.tools.filter(tool => access !== "off" && (tool.access === "read" || (access === "write" && !readOnly))).map(tool => tool.name);
	});
}
export function requireCapabilityTool(project: Project, name: string, readOnly = false, input: Record<string, unknown> = {}) {
	if (!capabilityTools(project, readOnly).includes(name)) throw new HttpError(403, `Tool ${name} is not enabled for this project/access level`);
	const definition = toolCapabilities().flatMap(c => c.tools).find(t => t.name === name)!;
	for (const [key, allowed] of Object.entries(definition.allow ?? {})) {
		if (typeof input[key] !== "string" || !allowed.includes(input[key])) throw new HttpError(403, `Tool ${name}: ${key} is outside the approved operations`);
	}
}
export function capabilityExtensions() {
	return [...new Set(toolCapabilities().flatMap(c => c.extensions))];
}

function decodeHtml(text: string) {
	return text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))).trim();
}
export function parseSearchResults(html: string) {
	const results: { title: string; url: string }[] = [];
	for (const match of html.matchAll(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)) {
		const href = decodeHtml(match[1]);
		try {
			const link = new URL(href, "https://html.duckduckgo.com");
			const url = new URL(link.searchParams.get("uddg") ?? link.href);
			if (!["https:", "http:"].includes(url.protocol)) continue;
			results.push({ title: decodeHtml(match[2]), url: url.href });
			if (results.length === 10) break;
		} catch { /* malformed search result */ }
	}
	return results;
}
/** Fixed public endpoint, no caller-controlled host, no redirects, bounded response. */
export async function searchWeb(query: string, signal?: AbortSignal) {
	const url = new URL("https://html.duckduckgo.com/html/");
	url.searchParams.set("q", query);
	const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]), headers: { "User-Agent": "Beezy/0.1 web-search", Accept: "text/html" } });
	if (!response.ok || !response.body) throw new HttpError(502, "Web search provider unavailable");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 1_000_000) throw new HttpError(502, "Web search response too large");
			chunks.push(value);
		}
	} finally { await reader.cancel(); }
	const html = Buffer.concat(chunks).toString("utf8");
	if (/anomaly\.js|challenge-form/.test(html)) throw new HttpError(502, "Web search provider requires a CAPTCHA; try again later");
	return { query, results: parseSearchResults(html), source: "DuckDuckGo" };
}
