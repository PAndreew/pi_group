import { createHash } from "node:crypto";
import { contentText } from "./harness/live-base.js";
import type { AgentMessage } from "./harness/types.js";
import { platform, type SqlDatabase, type SqlValue } from "./ports/index.js";

/*
 * The archive: every turn of agent threads, side threads and agentic chats, one row each, with a
 * full-text index. Agents see only the last day of conversation in their context (see
 * extensions/context-window.mjs); anything older is found here with history_search / history_read.
 * Rows only describe turns; who may read a conversation is checked by the caller at query time.
 * Private chats are never archived.
 */

export type ConversationKind = "main" | "side" | "session" | "chat";

export interface Turn {
	id: number;
	tenantId: string;
	projectId?: string;
	/** `session:<key>` or `chat:<id>`. */
	conversation: string;
	kind: ConversationKind;
	title?: string;
	/** Milliseconds since the epoch. */
	ts: number;
	senderId?: string;
	senderName: string;
	role: "user" | "assistant" | "tool";
	text: string;
	attachments?: string[];
}

export interface ConversationInfo {
	conversation: string;
	tenantId: string;
	projectId?: string;
	kind: ConversationKind;
	title?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS turns (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	tenant_id TEXT NOT NULL, project_id TEXT, conversation TEXT NOT NULL, kind TEXT NOT NULL, title TEXT,
	ts INTEGER NOT NULL, sender_id TEXT, sender_name TEXT NOT NULL, role TEXT NOT NULL,
	text TEXT NOT NULL, attachments TEXT, turn_key TEXT NOT NULL,
	UNIQUE (conversation, turn_key)
);
CREATE INDEX IF NOT EXISTS turns_by_conversation ON turns (conversation, ts);
CREATE INDEX IF NOT EXISTS turns_by_time ON turns (tenant_id, ts);
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(text, sender_name, title, content='turns', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
	INSERT INTO turns_fts (rowid, text, sender_name, title) VALUES (new.id, new.text, new.sender_name, new.title);
END;
CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
	INSERT INTO turns_fts (turns_fts, rowid, text, sender_name, title) VALUES ('delete', old.id, old.text, old.sender_name, old.title);
END;
CREATE TRIGGER IF NOT EXISTS turns_au AFTER UPDATE ON turns BEGIN
	INSERT INTO turns_fts (turns_fts, rowid, text, sender_name, title) VALUES ('delete', old.id, old.text, old.sender_name, old.title);
	INSERT INTO turns_fts (rowid, text, sender_name, title) VALUES (new.id, new.text, new.sender_name, new.title);
END;
`;

let ready = false;
/**
 * Run `fn` on the archive database. Each call opens and closes its own connection: writes come in
 * small bursts (a message, a finished run), and no file handle stays open between them.
 */
function use<T>(fn: (db: SqlDatabase) => T): T {
	const db = platform().openSql("archive");
	try {
		if (!ready) {
			db.exec("PRAGMA journal_mode = WAL");
			db.exec(SCHEMA);
			ready = true;
		}
		return fn(db);
	} finally {
		db.close();
	}
}

type Row = Record<string, unknown>;
const MAX_TEXT = 8000;
const TOOL_TEXT = 600;

const toTurn = (row: Row): Turn => ({
	id: Number(row.id),
	tenantId: String(row.tenant_id),
	projectId: row.project_id ? String(row.project_id) : undefined,
	conversation: String(row.conversation),
	kind: String(row.kind) as ConversationKind,
	title: row.title ? String(row.title) : undefined,
	ts: Number(row.ts),
	senderId: row.sender_id ? String(row.sender_id) : undefined,
	senderName: String(row.sender_name),
	role: String(row.role) as Turn["role"],
	text: String(row.text),
	attachments: row.attachments ? (JSON.parse(String(row.attachments)) as string[]) : undefined,
});

const hash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

/** The text of a message worth searching: what was said, plus one line per tool call and short tool results. */
export function turnText(message: AgentMessage): { role: Turn["role"]; text: string } | undefined {
	const content = message.content;
	if (message.role === "toolResult") {
		const text = (contentText(content as never) || "").trim();
		if (!text) return undefined;
		const name = typeof message.toolName === "string" ? message.toolName : "tool";
		return { role: "tool", text: `${name}${message.isError ? " (error)" : ""}: ${text.slice(0, TOOL_TEXT)}${text.length > TOOL_TEXT ? "…" : ""}` };
	}
	if (message.role !== "user" && message.role !== "assistant") return undefined;
	const parts: string[] = [];
	const said = typeof content === "string" ? content : contentText(content as never);
	if (said?.trim()) parts.push(said.trim());
	if (Array.isArray(content)) {
		for (const block of content as { type?: string; name?: string; arguments?: Record<string, unknown> }[]) {
			if (block?.type !== "toolCall") continue;
			const args = block.arguments ?? {};
			const target = args.path ?? args.file_path ?? args.command ?? args.query ?? args.url;
			parts.push(`→ ${block.name}${typeof target === "string" ? ` ${target.slice(0, 200)}` : ""}`);
		}
	}
	const text = parts.join("\n").slice(0, MAX_TEXT);
	return text ? { role: message.role, text } : undefined;
}

/** Root-relative paths named in backticks or attachment lists: uploads and files a turn refers to. */
const attachmentsOf = (text: string) => {
	const found = [...text.matchAll(/`([^`\n]+\/[^`\n]+\.[a-z0-9]{1,8})`/gi)].map((m) => m[1]);
	return found.length ? [...new Set(found)].slice(0, 20) : undefined;
};

/**
 * Archive the messages of a session (all of them each time; rows already there are kept). The key of
 * a message is its role, time and text, so edits add a new row rather than rewriting history.
 */
export function archiveMessages(info: ConversationInfo, messages: AgentMessage[], senders: (message: AgentMessage) => { id?: string; name: string }) {
	return use((db) => {
		const insert = db.prepare(
			"INSERT OR IGNORE INTO turns (tenant_id, project_id, conversation, kind, title, ts, sender_id, sender_name, role, text, attachments, turn_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		);
		let added = 0;
		let last = 0;
		db.exec("BEGIN");
		try {
			for (const message of messages) {
				const turn = turnText(message);
				if (!turn) continue;
				// Messages without a time (old transcripts) keep their order after the previous one.
				const ts = typeof message.timestamp === "number" && message.timestamp > 0 ? message.timestamp : last + 1;
				last = ts;
				const sender = senders(message);
				const files = attachmentsOf(turn.text);
				const result = insert.run(info.tenantId, info.projectId ?? null, info.conversation, info.kind, info.title ?? null, ts, sender.id ?? null, sender.name, turn.role, turn.text, files ? JSON.stringify(files) : null, `${turn.role}:${ts}:${hash(turn.text)}`);
				added += Number(result.changes);
			}
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
		return added;
	});
}

/** Archive one chat message, or replace it after an edit (chat messages have stable ids). */
export function archiveChatMessage(info: ConversationInfo, messageId: number, message: AgentMessage, sender: { id?: string; name: string }) {
	const turn = turnText(message);
	if (!turn) return;
	const ts = typeof message.timestamp === "number" ? message.timestamp : Date.now();
	const files = attachmentsOf(turn.text);
	use((db) => db
		.prepare(
			`INSERT INTO turns (tenant_id, project_id, conversation, kind, title, ts, sender_id, sender_name, role, text, attachments, turn_key)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (conversation, turn_key) DO UPDATE SET text = excluded.text, attachments = excluded.attachments, title = excluded.title, project_id = excluded.project_id`,
		)
		.run(info.tenantId, info.projectId ?? null, info.conversation, info.kind, info.title ?? null, ts, sender.id ?? null, sender.name, turn.role, turn.text, files ? JSON.stringify(files) : null, `msg:${messageId}`));
}

/** Remove one chat message (deleted in the chat). */
export function forgetChatMessage(conversation: string, messageId: number) {
	use((db) => db.prepare("DELETE FROM turns WHERE conversation = ? AND turn_key = ?").run(conversation, `msg:${messageId}`));
}

/** Remove a whole conversation: a chat made private or deleted, a session deleted. */
export function forgetConversation(conversation: string) {
	use((db) => db.prepare("DELETE FROM turns WHERE conversation = ?").run(conversation));
}

/** Keep a conversation's title and project current on all its rows (renamed, moved). */
export function relabelConversation(conversation: string, labels: { title?: string; projectId?: string }) {
	use((db) => {
		if (labels.title !== undefined) db.prepare("UPDATE turns SET title = ? WHERE conversation = ?").run(labels.title, conversation);
		if (labels.projectId !== undefined) db.prepare("UPDATE turns SET project_id = ? WHERE conversation = ?").run(labels.projectId, conversation);
	});
}

export interface SearchQuery {
	tenantId: string;
	/** Words to look for; quoted phrases and prefix* work. Without it, the newest turns match. */
	text?: string;
	projectId?: string;
	conversation?: string;
	sender?: string;
	since?: number;
	until?: number;
	limit?: number;
}

/** Make free text safe for FTS5: each word quoted (a trailing * stays a prefix search). */
export function ftsQuery(text: string) {
	const words = text.match(/"[^"]+"|\S+/g) ?? [];
	return words
		.map((w) => {
			if (w.startsWith('"') && w.endsWith('"') && w.length > 2) return w;
			const prefix = w.endsWith("*");
			const clean = w.replace(/\*+$/, "").replace(/"/g, "");
			return clean ? `"${clean}"${prefix ? "*" : ""}` : "";
		})
		.filter(Boolean)
		.join(" ");
}

/**
 * Turns matching a query, best first (newest first without text). `canRead` filters by conversation;
 * it is asked once per conversation.
 */
export function searchTurns(query: SearchQuery, canRead: (conversation: string) => boolean): Turn[] {
	const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
	const where: string[] = ["t.tenant_id = ?"];
	const params: SqlValue[] = [query.tenantId];
	if (query.projectId) (where.push("t.project_id = ?"), params.push(query.projectId));
	if (query.conversation) (where.push("t.conversation = ?"), params.push(query.conversation));
	if (query.sender) (where.push("LOWER(t.sender_name) LIKE ?"), params.push(`%${query.sender.toLowerCase()}%`));
	if (query.since) (where.push("t.ts >= ?"), params.push(query.since));
	if (query.until) (where.push("t.ts <= ?"), params.push(query.until));
	const match = query.text ? ftsQuery(query.text) : "";
	const sql = match
		? `SELECT t.* FROM turns_fts f JOIN turns t ON t.id = f.rowid WHERE turns_fts MATCH ? AND ${where.join(" AND ")} ORDER BY bm25(turns_fts), t.ts DESC LIMIT ?`
		: `SELECT t.* FROM turns t WHERE ${where.join(" AND ")} ORDER BY t.ts DESC LIMIT ?`;
	// Read more than asked, since some conversations may be off limits for the caller.
	const rows = use((db) => db.prepare(sql).all(...(match ? [match] : []), ...params, limit * 5) as Row[]);
	const allowed = new Map<string, boolean>();
	const out: Turn[] = [];
	for (const row of rows) {
		const turn = toTurn(row);
		if (!allowed.has(turn.conversation)) allowed.set(turn.conversation, canRead(turn.conversation));
		if (allowed.get(turn.conversation)) out.push(turn);
		if (out.length >= limit) break;
	}
	return out;
}

/** A stretch of one conversation: around a moment, or its latest turns. */
export function readConversation(conversation: string, options: { around?: number; before?: number; after?: number } = {}): Turn[] {
	const before = Math.min(options.before ?? 20, 200);
	const after = Math.min(options.after ?? 20, 200);
	const around = options.around;
	return use((db) => {
		if (around === undefined) {
			const rows = db.prepare("SELECT * FROM (SELECT * FROM turns WHERE conversation = ? ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts, id").all(conversation, before + after) as Row[];
			return rows.map(toTurn);
		}
		const earlier = db.prepare("SELECT * FROM turns WHERE conversation = ? AND ts < ? ORDER BY ts DESC, id DESC LIMIT ?").all(conversation, around, before) as Row[];
		const later = db.prepare("SELECT * FROM turns WHERE conversation = ? AND ts >= ? ORDER BY ts, id LIMIT ?").all(conversation, around, after) as Row[];
		return [...earlier.reverse(), ...later].map(toTurn);
	});
}

/** Recent turns of several conversations (the agentic chats an agent is told about). */
export function recentTurns(conversations: string[], since: number, perConversation = 40): Turn[] {
	if (!conversations.length) return [];
	return use((db) => {
		const stmt = db.prepare("SELECT * FROM (SELECT * FROM turns WHERE conversation = ? AND ts >= ? ORDER BY ts DESC LIMIT ?) ORDER BY ts");
		return conversations.flatMap((c) => (stmt.all(c, since, perConversation) as Row[]).map(toTurn));
	});
}

/** Plain text for an agent: one line per turn, with time, conversation and sender. */
export function formatTurns(turns: Turn[], options: { conversation?: boolean } = {}) {
	return turns
		.map((t) => {
			const when = new Date(t.ts).toISOString().replace("T", " ").slice(0, 16);
			const where = options.conversation ? ` [${t.title ? `${t.title} · ` : ""}${t.conversation}]` : "";
			return `${when}${where} ${t.senderName}: ${t.text.replace(/\s+\n/g, "\n")}`;
		})
		.join("\n");
}

export function archiveStats() {
	const row = use((db) => db.prepare("SELECT COUNT(*) AS turns, COUNT(DISTINCT conversation) AS conversations FROM turns").get() as Row);
	return { turns: Number(row.turns), conversations: Number(row.conversations) };
}
