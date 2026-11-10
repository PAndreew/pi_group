import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/*
 * Project memory as topics: one Markdown file per category in `memory/topics/<slug>.md`, created, merged and
 * deleted as the project evolves (by the consolidation worker or by people). `MEMORY.md` is an index the
 * server generates from the topic headers; agents get only the index and read topics with project_memory.
 */

export const MAX_TOPICS = 10;
export const TOPIC_MAX = 8000;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const GENERATED = "<!-- Generated from memory/topics; edit the topics, not this file. -->";

export interface Topic { slug: string; title: string; description: string; body: string; updatedAt: string }

export const topicsDir = (projectDir: string) => path.join(projectDir, "memory", "topics");
const indexFile = (projectDir: string) => path.join(projectDir, "MEMORY.md");

export function parseTopic(slug: string, text: string, updatedAt = new Date().toISOString()): Topic {
	const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	const field = (name: string) => match?.[1].match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1].trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
	return { slug, title: field("title") || slug, description: field("description"), body: (match ? match[2] : text).trim(), updatedAt };
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export const formatTopic = (t: Pick<Topic, "title" | "description" | "body">) => `---\ntitle: ${oneLine(t.title)}\ndescription: ${oneLine(t.description)}\n---\n\n${t.body.trim()}\n`;

export function readTopics(dir: string): Topic[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(".md") && SLUG.test(f.slice(0, -3))).sort()
		.map((f) => parseTopic(f.slice(0, -3), readFileSync(path.join(dir, f), "utf8"), statSync(path.join(dir, f)).mtime.toISOString()));
}

/** Why a set of topic files is not acceptable as project memory, or undefined when it is. */
export function invalidTopics(dir: string): string | undefined {
	if (!existsSync(dir)) return;
	const files = readdirSync(dir);
	const stray = files.find((f) => !f.endsWith(".md") || !SLUG.test(f.slice(0, -3)));
	if (stray) return `"${stray}" is not a topic file (<slug>.md, lowercase letters, digits and dashes)`;
	if (files.length > MAX_TOPICS) return `${files.length} topics; at most ${MAX_TOPICS}`;
	for (const t of readTopics(dir)) {
		if (!t.description) return `Topic "${t.slug}" has no description`;
		if (!t.body) return `Topic "${t.slug}" is empty`;
		if (t.body.length > TOPIC_MAX) return `Topic "${t.slug}" has ${t.body.length} characters; at most ${TOPIC_MAX}`;
	}
}

/** The index agents get in front of their first prompt: just the topic list. Empty without topics. */
export function renderIndex(topics: Topic[]) {
	if (!topics.length) return "";
	return [
		GENERATED,
		"# Project memory",
		"",
		"Topics of this project's memory. Read the ones relevant to your current task with the project_memory tool (and only those); skip it when none are.",
		"",
		...topics.map((t) => `- \`${t.slug}\` — ${t.title}: ${t.description} (updated ${t.updatedAt.slice(0, 10)})`),
		"",
	].join("\n");
}

/** Where a master from before topics waits until consolidation has split it into topics. */
export const legacyFile = (projectDir: string) => path.join(projectDir, "memory", "legacy-master.md");

/** Move a MEMORY.md written before topics out of the way of the generated index. */
export function adoptLegacy(projectDir: string) {
	const text = existsSync(indexFile(projectDir)) ? readFileSync(indexFile(projectDir), "utf8") : "";
	if (!text.trim() || text.startsWith(GENERATED)) return;
	mkdirSync(path.dirname(legacyFile(projectDir)), { recursive: true });
	if (existsSync(legacyFile(projectDir))) writeFileSync(legacyFile(projectDir), `${readFileSync(legacyFile(projectDir), "utf8")}\n\n${text}`);
	else writeFileSync(legacyFile(projectDir), text);
	rmSync(indexFile(projectDir));
}

/** The master from before topics, until it has been split into topics. */
export function legacyMaster(projectDir: string) {
	adoptLegacy(projectDir);
	return existsSync(legacyFile(projectDir)) ? readFileSync(legacyFile(projectDir), "utf8").trim() || undefined : undefined;
}

export function writeIndex(projectDir: string) {
	adoptLegacy(projectDir);
	writeFileSync(indexFile(projectDir), renderIndex(readTopics(topicsDir(projectDir))));
}

export function copyTopics(from: string, to: string) {
	rmSync(to, { recursive: true, force: true });
	mkdirSync(to, { recursive: true });
	for (const t of readTopics(from)) writeFileSync(path.join(to, `${t.slug}.md`), formatTopic(t));
}

/** Replace the live topics with a validated staging copy; topics missing from it are deleted. */
export function replaceTopics(staging: string, live: string) {
	mkdirSync(live, { recursive: true });
	const keep = new Set(readdirSync(staging));
	for (const f of keep) {
		const temp = path.join(live, `.${randomUUID()}.tmp`);
		writeFileSync(temp, readFileSync(path.join(staging, f)));
		renameSync(temp, path.join(live, f));
	}
	for (const f of readdirSync(live)) if (!keep.has(f)) rmSync(path.join(live, f), { force: true });
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} …[${text.length - max} more chars]` : text);

/** project_memory tool output: the named topics, search hits across topics, or the index. */
export function topicToolText(dir: string, { topics, query }: { topics?: string[]; query?: string } = {}) {
	const all = readTopics(dir);
	if (!all.length) return "This project has no memory topics yet.";
	const list = all.map((t) => `- ${t.slug}: ${t.title} — ${t.description}`).join("\n");
	if (topics?.length) {
		return topics.map((slug) => {
			const t = all.find((x) => x.slug === slug.trim().toLowerCase());
			return t ? `# ${t.title} (\`${t.slug}\`, updated ${t.updatedAt.slice(0, 10)})\n\n${clip(t.body, TOPIC_MAX * 2)}` : `No topic "${slug}". Topics:\n${list}`;
		}).join("\n\n---\n\n");
	}
	if (query?.trim()) {
		const needle = query.trim().toLowerCase();
		const hits = all.flatMap((t) => t.body.split("\n").filter((l) => l.toLowerCase().includes(needle)).map((l) => `${t.slug}: ${clip(l.trim(), 300)}`));
		return hits.length ? `${hits.slice(0, 40).join("\n")}\n\n[${Math.min(hits.length, 40)} of ${hits.length} matching lines. Read a topic for context.]` : `No topic mentions "${query}". Topics:\n${list}`;
	}
	return `Topics:\n${list}`;
}
