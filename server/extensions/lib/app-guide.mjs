// What Beezy offers, for its own agents: the parts of the app they may point people to with
// ```beezy-action buttons, and the beezy_docs tool that reads Beezy's documentation and lists its API.
// Shared by the pi RPC extension (../app-guide.mjs) and the pi-durable adapter. The web app keeps the
// same ids in web/src/lib/surfaces.ts (a web test checks they match). See docs/app-guide.md.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
export const DOCS_DIR = path.resolve(here, "..", "..", "..", "docs");
const SERVER_SRC = path.resolve(here, "..", "..", "src");

/**
 * The parts of the app a button can open. `when` tells the agent when to suggest it; `params` are
 * optional prefills (the person still reviews and saves). `admin`: only admins see the button.
 */
export const SURFACES = [
	{ id: "remote-machines", title: "Remote machines", doc: "remote-machines", when: "the person wants to work on or connect to another machine: a server, GPU box, SSH host, cluster. Only admins can add one", params: { host: "host name or user@host:port to prefill", name: "short #name" } },
	{ id: "scheduled-jobs", title: "Scheduled jobs", doc: "scheduled-jobs", when: "they want something to happen regularly or later (\"every morning\", \"remind me\", \"each week\") or keep asking for the same thing. Prefer proposing the job with propose_scheduled_job, then point here to review and approve it" },
	{ id: "applets", title: "Applets", doc: "applets", when: "they repeat the same kind of task with different inputs (translate this file, summarise that report). Prefer proposing one with propose_applet, then point here" },
	{ id: "vault", title: "Secret vault", doc: "vault", when: "a password, API key or token is needed. Never ask for it in the chat: send them here and use {{vault:KEY}} placeholders", params: { key: "the KEY to prefill, e.g. OPENAI_API_KEY", description: "what the secret is for" } },
	{ id: "model-settings", title: "Model settings", doc: "pi-profiles", when: "they want another model, to connect a provider or change defaults, project memory or context settings" },
	{ id: "tools", title: "Tools", when: "they ask which tools, skills, extensions or MCP servers this agent has" },
	{ id: "resource-monitor", title: "Resource monitor", when: "they ask about CPU, memory, disk, running sessions or usage and cost" },
	{ id: "files", title: "Folders and files", when: "they want to browse, find, upload or open files", params: { folder: "folder to start in, relative to the shared root" } },
	{ id: "links", title: "Links", when: "they look for a link or URL shared earlier in this project" },
	{ id: "new-session", title: "New session", when: "the task deserves its own agent session, or needs the shared browser (browser: true)", params: { folder: "folder to work in", browser: "true to open it with the shared browser" } },
	{ id: "terminal", title: "Terminal", admin: true, when: "an admin wants a shell on the server themselves" },
	{ id: "users", title: "Manage users", admin: true, when: "an admin wants to add people or change roles" },
];

export const SURFACE_IDS = SURFACES.map((s) => s.id);

const example = '```beezy-action\n{"open": "remote-machines", "label": "Add your GPU server", "params": {"host": "gpu01.example.org"}}\n```';

/** The system prompt section: what the buttons are, when to offer them, and the ids. */
export function appGuide() {
	const list = SURFACES.map((s) => {
		const params = s.params ? ` Params: ${Object.entries(s.params).map(([k, v]) => `${k} (${v})`).join(", ")}.` : "";
		return `- \`${s.id}\`${s.admin ? " (admins only)" : ""}: ${s.when}.${params}`;
	}).join("\n");
	return `

## Suggesting parts of beezy
You can show buttons that open parts of beezy for the person. Write a \`\`\`beezy-action block holding JSON: "open" (an id below), "label" (a short call to action), optional "params" (prefills; the person still reviews and saves). Several buttons: a JSON array (up to 3). Example:
${example}
Offer one only when it clearly helps with what the person is doing right now: at most one or two per reply, not again after they declined, and never instead of doing a task you can do yourself. If you can create the thing yourself (a scheduled job, an applet), propose it with its tool and add a button to review it. Buttons only open and prefill; they never change anything. Ids:
${list}
For how beezy works (features, settings, its HTTP API), use the beezy_docs tool instead of guessing.`;
}

export const DOCS_TOOL = {
	name: "beezy_docs",
	label: "Beezy docs",
	description: [
		"Read beezy's own documentation: how its features work (sessions, chats, projects, memory, scheduled jobs, applets, vault, remote machines, process watches, the shared browser…) and its HTTP API.",
		"With nothing, lists the topics. Give `topic` to read one (topic \"api\" lists the HTTP endpoints), or `query` to find lines across all topics.",
	].join(" "),
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			topic: { type: "string", maxLength: 60, description: "A topic name from the list, e.g. \"scheduled-jobs\", or \"api\"." },
			query: { type: "string", maxLength: 200, description: "Case-insensitive text to find across all topics." },
		},
	},
};

const docTopics = () => readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
const title = (text, fallback) => /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? fallback;

/** The HTTP endpoints, read from the server's route definitions (internal agent bridges left out). */
export function apiRoutes(dir = SERVER_SRC) {
	const routes = new Map();
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
		const source = readFileSync(path.join(dir, file), "utf8");
		for (const m of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|"[^"]+"|'[^']+')([^\n]*)/g)) {
			const paths = [...m[2].matchAll(/["']([^"']+)["']/g)].map((p) => p[1]);
			const admin = /requireAdmin/.test(m[3]);
			for (const p of paths) {
				if (/-bridge\b|^\/internal\//.test(p)) continue;
				const line = `${m[1].toUpperCase()} /api${p}${admin ? " (admin)" : ""}`;
				routes.set(line, `${file.replace(/\.ts$/, "")}`);
			}
		}
	}
	const byArea = new Map();
	for (const [line, area] of routes) byArea.set(area, [...(byArea.get(area) ?? []), line]);
	return [...byArea].sort(([a], [b]) => a.localeCompare(b)).map(([area, lines]) => `## ${area}\n${lines.join("\n")}`).join("\n\n");
}

const API_INTRO = "# Beezy HTTP API\nAll endpoints are under /api and need a signed-in browser session (cookie); you cannot call them from here. This list is for explaining what the app can do. JSON in, JSON out.\n\n";

/** The answer of beezy_docs. */
export function docsAnswer({ topic, query } = {}) {
	const topics = docTopics();
	if (topic) {
		const name = String(topic).toLowerCase().replace(/\.md$/, "");
		if (name === "api") return API_INTRO + apiRoutes();
		if (!topics.includes(name)) return `No topic "${topic}". Topics: ${[...topics, "api"].join(", ")}`;
		return readFileSync(path.join(DOCS_DIR, `${name}.md`), "utf8").slice(0, 40000);
	}
	if (query) {
		const needle = String(query).toLowerCase();
		const hits = [];
		for (const name of topics) {
			const lines = readFileSync(path.join(DOCS_DIR, `${name}.md`), "utf8").split("\n");
			lines.forEach((line, i) => { if (line.toLowerCase().includes(needle)) hits.push(`${name}:${i + 1}: ${line.trim().slice(0, 300)}`); });
		}
		for (const line of apiRoutes().split("\n")) if (line.toLowerCase().includes(needle) && !line.startsWith("##")) hits.push(`api: ${line}`);
		return hits.length ? hits.slice(0, 60).join("\n") : `Nothing mentions "${query}".`;
	}
	const rows = topics.map((name) => `- ${name}: ${title(readFileSync(path.join(DOCS_DIR, `${name}.md`), "utf8"), name)}`);
	return `Beezy documentation topics (read one with topic):\n${rows.join("\n")}\n- api: the HTTP endpoints`;
}
