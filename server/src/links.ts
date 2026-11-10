import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Router } from "express";
import { stripProjectMemory } from "../extensions/lib/context-policy.mjs";
import { chatsOf, chatMessages, chatTitle } from "./chats.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import type { AgentMessage } from "./harness/types.js";
import { canAccessProject, projectIdOf, tenantProjects } from "./projects.js";
import { accessOf } from "./sessions.js";
import { type SessionMeta, store } from "./store.js";
import { tenantAccess } from "./tenants.js";

/*
 * The project's links: files and web pages that people and agents referred to in its conversations.
 * Only what was said is read (user and assistant text, plus files agents wrote or edited); tool output
 * is not, so the contents of a connected drive or a crawled site never show up, only links someone gave.
 */

export interface FoundLink { kind: "file" | "web"; target: string; label?: string; at?: string }
export interface ProjectLink extends FoundLink { source: { kind: "session" | "chat"; id: string; title: string }; count: number }

const MARKDOWN_LINK = /\[([^\]\n]{0,200})\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()[\]"'`]+/g;
const EDIT_TOOLS = new Set(["write", "write_file", "edit", "multiedit"]);
const MAX_LINKS = 2000;

const timeOf = (m: AgentMessage) => {
	const t = typeof m.timestamp === "number" ? m.timestamp : typeof m.timestamp === "string" ? Date.parse(m.timestamp) : NaN;
	return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** A link target as a root-relative path of an existing file, or undefined (web links, anchors, outside the root). */
function fileTarget(target: string, base: string) {
	let file = target;
	if (/^file:/i.test(file)) {
		try { file = fileURLToPath(file); } catch { return undefined; }
	} else if (/^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file)) return undefined;
	if (file.startsWith("#")) return undefined;
	try { file = decodeURIComponent(file.split("#")[0].split("?")[0]); } catch { return undefined; }
	if (!file) return undefined;
	const abs = path.resolve(base, file);
	const rel = toRel(abs);
	return rel && !rel.startsWith("..") && !path.isAbsolute(rel) && existsSync(abs) ? rel : undefined;
}

/** Every file and web link in some messages; `base` is the absolute folder relative links resolve against. */
export function extractLinks(messages: AgentMessage[], base: string): FoundLink[] {
	const found: FoundLink[] = [];
	for (const m of messages) {
		if (m.role !== "user" && m.role !== "assistant") continue;
		const at = timeOf(m);
		const blocks = (Array.isArray(m.content) ? m.content : [{ type: "text", text: typeof m.content === "string" ? m.content : "" }]) as { type?: string; text?: string; name?: string; arguments?: Record<string, unknown> }[];
		for (const block of blocks) {
			if (block?.type === "toolCall" && EDIT_TOOLS.has(String(block.name).toLowerCase())) {
				const target = block.arguments?.path ?? block.arguments?.file_path ?? block.arguments?.filePath;
				const file = typeof target === "string" ? fileTarget(target, base) : undefined;
				if (file) found.push({ kind: "file", target: file, at });
			}
			if (block?.type !== "text" || !block.text) continue;
			const text = m.role === "user" ? stripProjectMemory(block.text) : block.text;
			const linked = new Set<string>();
			for (const [, label, target] of text.matchAll(MARKDOWN_LINK)) {
				linked.add(target);
				if (/^https?:\/\//i.test(target)) found.push({ kind: "web", target, label: label.trim() || undefined, at });
				else {
					const file = fileTarget(target, base);
					if (file) found.push({ kind: "file", target: file, label: label.trim() || undefined, at });
				}
			}
			for (const [raw] of text.matchAll(BARE_URL)) {
				const url = raw.replace(/[.,;:!?]+$/, "");
				if (!linked.has(url)) found.push({ kind: "web", target: url, at });
			}
		}
	}
	return found;
}

/** Links per conversation, kept until it changes. */
const cache = new Map<string, { version: string; links: FoundLink[] }>();
const cached = async (id: string, version: string, load: () => Promise<FoundLink[]>) => {
	const hit = cache.get(id);
	if (hit?.version === version) return hit.links;
	const links = await load();
	cache.set(id, { version, links });
	return links;
};

export function mountLinks(router: Router, readMessages: (meta: SessionMeta) => Promise<AgentMessage[]>) {
	/** Distinct links of a project's conversations the caller can open, newest first. */
	router.get("/projects/:id/links", async (req, res) => {
		const user = req.user!;
		const project = tenantProjects().find((p) => p.id === String(req.params.id) && canAccessProject(user, p));
		if (!project) throw new HttpError(404, "Project not found");
		const tenant = project.tenantId ?? "work";
		const sources: { kind: "session" | "chat"; id: string; title: string; links: FoundLink[] }[] = [];
		const sessions = Object.values(store.data.sessions).filter((meta) => !meta.deleted && !meta.memory && !meta.applet && !meta.archivedAt && (meta.tenantId ?? "work") === tenant && accessOf(user, meta) && projectIdOf(meta.cwd, meta.projectId, tenant) === project.id);
		for (const meta of sessions) {
			const links = await cached(meta.key, meta.updatedAt ?? meta.createdAt, async () => extractLinks(await readMessages(meta).catch(() => []), meta.cwd));
			sources.push({ kind: "session", id: meta.key, title: meta.name ?? meta.firstMessage ?? "Untitled session", links });
		}
		for (const chat of chatsOf(user.id)) {
			if ((chat.tenantId ?? "work") !== tenant || !tenantAccess(user, chat)) continue;
			let folder: string;
			try { folder = resolveSafe(chat.folder); } catch { continue; }
			if (projectIdOf(folder, chat.projectId, tenant) !== project.id) continue;
			const links = await cached(chat.id, chat.updatedAt, async () => extractLinks(chatMessages(chat.id, 100000).map((m) => m.message), folder));
			sources.push({ kind: "chat", id: chat.id, title: chatTitle(chat, user.id), links });
		}
		const byTarget = new Map<string, ProjectLink>();
		for (const source of sources) {
			for (const link of source.links) {
				const key = `${link.kind}:${link.target}`;
				const seen = byTarget.get(key);
				if (!seen) byTarget.set(key, { ...link, source: { kind: source.kind, id: source.id, title: source.title }, count: 1 });
				else {
					seen.count++;
					if ((link.at ?? "") > (seen.at ?? "")) Object.assign(seen, { at: link.at, label: link.label ?? seen.label, source: { kind: source.kind, id: source.id, title: source.title } });
					else seen.label ??= link.label;
				}
			}
		}
		const links = [...byTarget.values()].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, MAX_LINKS);
		res.json({ links });
	});
}
