import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import { contentText, replaceText } from "./harness/live-base.js";
import type { AgentMessage, PromptInput } from "./harness/types.js";
import { pushToUser } from "./push.js";
import { accessOf, involved, type RunOutcome } from "./sessions.js";
import { type SessionMeta, store, type User } from "./store.js";

/*
 * Chats between people, optionally with pi. Messages are stored in pi's message shape
 * ({ role, content, timestamp, author }) so a chat converts to a pi session as is. A chat with
 * only pi is just a session; a chat with people links to one pi session (in the chat's fixed
 * folder) the first time someone mentions @pi, and pi's replies are posted back.
 */

export type PiStatus = "working" | "done" | "error" | "aborted";

export interface ChatMessage {
	id: number;
	chatId: string;
	message: AgentMessage;
	/** For pi's messages: still working, or how the run ended. */
	status?: PiStatus;
	sessionKey?: string;
	createdAt: string;
	editedAt?: string;
	/** Emoji reactions on people's messages: emoji → ids of the users who reacted. */
	reactions?: Record<string, string[]>;
}

export interface Chat {
	id: string;
	title?: string;
	/** Fixed folder, relative to FS_ROOT. */
	folder: string;
	sessionKey?: string;
	pi: boolean;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	/** Last message pi has seen; later human messages are sent as context with the next mention. */
	piCursor: number;
	consolidatedAt?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
	id TEXT PRIMARY KEY, title TEXT, folder TEXT NOT NULL, session_key TEXT, pi INTEGER NOT NULL DEFAULT 0,
	created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
	pi_cursor INTEGER NOT NULL DEFAULT 0, consolidated_at TEXT
);
CREATE TABLE IF NOT EXISTS members (chat_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chat_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, message TEXT NOT NULL,
	status TEXT, session_key TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat_id, id);
CREATE INDEX IF NOT EXISTS chats_by_session ON chats (session_key);
`;

let db: DatabaseSync | undefined;
function database() {
	if (!db) {
		mkdirSync(config.dataDir, { recursive: true });
		db = new DatabaseSync(path.join(config.dataDir, "chats.sqlite"));
		db.exec("PRAGMA journal_mode = WAL");
		db.exec(SCHEMA);
		const columns = (db.prepare("PRAGMA table_info(messages)").all() as Row[]).map((c) => String(c.name));
		if (!columns.includes("edited_at")) db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT");
		if (!columns.includes("reactions")) db.exec("ALTER TABLE messages ADD COLUMN reactions TEXT");
	}
	return db;
}

/** Close the database (shutdown, tests). */
export function closeChats() {
	db?.close();
	db = undefined;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));

function toChat(row: Row): Chat {
	return {
		id: String(row.id),
		title: str(row.title),
		folder: String(row.folder),
		sessionKey: str(row.session_key),
		pi: Boolean(row.pi),
		createdBy: String(row.created_by),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at),
		piCursor: Number(row.pi_cursor),
		consolidatedAt: str(row.consolidated_at),
	};
}

function toMessage(row: Row): ChatMessage {
	const reactions = row.reactions ? (JSON.parse(String(row.reactions)) as Record<string, string[]>) : undefined;
	return {
		id: Number(row.id),
		chatId: String(row.chat_id),
		message: JSON.parse(String(row.message)),
		status: str(row.status) as PiStatus | undefined,
		sessionKey: str(row.session_key),
		createdAt: String(row.created_at),
		editedAt: str(row.edited_at),
		reactions: reactions && Object.keys(reactions).length ? reactions : undefined,
	};
}

export function getChat(id: string) {
	const row = database().prepare("SELECT * FROM chats WHERE id = ?").get(id) as Row | undefined;
	return row && toChat(row);
}

export function chatOfSession(key: string) {
	// Asked on every finished run: no need to create the database before the first chat.
	if (!db && !existsSync(path.join(config.dataDir, "chats.sqlite"))) return undefined;
	const row = database().prepare("SELECT * FROM chats WHERE session_key = ?").get(key) as Row | undefined;
	return row && toChat(row);
}

export function memberIds(chatId: string) {
	return (database().prepare("SELECT user_id FROM members WHERE chat_id = ? ORDER BY rowid").all(chatId) as Row[]).map((r) => String(r.user_id));
}

export function chatMessages(chatId: string, limit = 300) {
	return (database().prepare("SELECT * FROM (SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(chatId, limit) as Row[]).map(toMessage);
}

/** Chats nobody touched since `before` and not consolidated since their last activity. */
export function staleChats(before: string) {
	return (database().prepare("SELECT * FROM chats WHERE updated_at < ? AND (consolidated_at IS NULL OR consolidated_at < updated_at) AND EXISTS (SELECT 1 FROM messages WHERE chat_id = chats.id)").all(before) as Row[]).map(toChat);
}

export function markChatConsolidated(id: string, at = new Date().toISOString()) {
	database().prepare("UPDATE chats SET consolidated_at = ? WHERE id = ?").run(at, id);
}

const textOf = (message: AgentMessage) => contentText(message.content as never) || (typeof message.content === "string" ? message.content : "");
const authorName = (message: AgentMessage) => (message.role === "assistant" ? "pi" : ((message.author as { username?: string } | undefined)?.username ?? "someone"));

/** Plain-text transcript, "author: text" per message. */
export function transcript(messages: ChatMessage[]) {
	return messages
		.map((m) => ({ who: authorName(m.message), text: textOf(m.message).trim() }))
		.filter((m) => m.text)
		.map((m) => `${m.who}: ${m.text}`)
		.join("\n\n");
}

export function chatTitle(chat: Chat, viewerId?: string) {
	if (chat.title) return chat.title;
	const names = memberIds(chat.id)
		.filter((id) => id !== viewerId)
		.map((id) => store.userById(id)?.username ?? "unknown");
	if (chat.pi) names.push("pi");
	return names.join(", ") || "Just you";
}

/** The shared chat folder; its AGENTS.md points every pi session started there at the consolidated memory. */
export function ensureChatFolder() {
	mkdirSync(config.chatFolder, { recursive: true });
	const agents = path.join(config.chatFolder, "AGENTS.md");
	if (!existsSync(agents)) {
		writeFileSync(
			agents,
			[
				"# Chat folder",
				"",
				"This folder belongs to the π group chat. Long-term memory of earlier conversations lives in `MEMORY.md`",
				"(an index, one line per conversation) and in `memory/` (one file per conversation).",
				"Read `MEMORY.md` when earlier context, decisions or preferences could help, and open the matching file in `memory/` for details.",
				"",
			].join("\n"),
		);
	}
	return config.chatFolder;
}

/** What the chat module needs from the session layer. */
export interface ChatDeps {
	createSession: (user: User, input: { harness: string; cwd: string; name?: string; model?: { provider: string; id: string }; thinkingLevel?: string; visibility?: SessionMeta["visibility"]; shares?: SessionMeta["shares"] }) => Promise<SessionMeta>;
	promptSession: (meta: SessionMeta, user: User, input: PromptInput) => Promise<void>;
	/** Harness for a user's new sessions: their saved default if available, else the first that works. */
	harnessFor: (user: User) => Promise<string>;
	sendTo: (userId: string, event: unknown) => void;
	onRun: (listener: (key: string, outcome: RunOutcome) => void) => void;
	setQuiet: (quiet: (key: string) => boolean) => void;
	/** Summary of a session for the chat list. */
	sessionSummary: (meta: SessionMeta, user: User) => { running: boolean; live: boolean; name?: string; firstMessage?: string; updatedAt: string; path: string; harness: string };
	/** Rewrite one message of a session that is not running; `pick` returns undefined when there is nothing to change. */
	editSession: (meta: SessionMeta, pick: (messages: AgentMessage[]) => { index: number; text: string; expect: string } | undefined) => Promise<boolean>;
}

const MENTION = /(^|\s)@([\w.-]+)/g;
const mentions = (text: string) => [...text.matchAll(MENTION)].map((m) => m[2].toLowerCase());

export function mountChats(router: Router, deps: ChatDeps) {
	router.use(["/chats", "/folders"], requireAuth);

	const now = () => new Date().toISOString();
	const insert = (chatId: string, message: AgentMessage, extra: { status?: PiStatus; sessionKey?: string } = {}) => {
		const at = now();
		const result = database()
			.prepare("INSERT INTO messages (chat_id, message, status, session_key, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(chatId, JSON.stringify(message), extra.status ?? null, extra.sessionKey ?? null, at);
		database().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(at, chatId);
		return { id: Number(result.lastInsertRowid), chatId, message, ...extra, createdAt: at } as ChatMessage;
	};
	const update = (message: ChatMessage) => {
		database().prepare("UPDATE messages SET message = ?, status = ?, session_key = ? WHERE id = ?").run(JSON.stringify(message.message), message.status ?? null, message.sessionKey ?? null, message.id);
		database().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), message.chatId);
	};

	/** Live event to every member; a push to the others when it is someone's message. */
	const fanOut = (chat: Chat, type: "chat_message" | "chat_update", message: ChatMessage, pushText?: { author: string; text: string; except?: string }) => {
		for (const userId of memberIds(chat.id)) {
			deps.sendTo(userId, { type, chatId: chat.id, message });
			if (pushText && userId !== pushText.except) void pushToUser(userId, { type: "chat", chatId: chat.id, title: chatTitle(chat, userId), author: pushText.author, text: pushText.text.slice(0, 300) });
		}
	};

	const addMembers = (chat: Chat, userIds: string[]) => {
		const stmt = database().prepare("INSERT OR IGNORE INTO members (chat_id, user_id) VALUES (?, ?)");
		for (const id of userIds) if (store.userById(id)) stmt.run(chat.id, id);
		// People in the chat can follow (and steer) pi's session.
		const meta = chat.sessionKey ? store.session(chat.sessionKey) : undefined;
		if (meta) {
			const shares = memberIds(chat.id).filter((id) => id !== meta.ownerId).map((userId) => ({ userId, access: "write" as const }));
			store.upsertSession({ ...meta, visibility: "shared", shares });
		}
	};

	const membership = (chatId: string, user: User) => {
		const chat = getChat(chatId);
		if (!chat || !memberIds(chatId).includes(user.id)) throw new HttpError(404, "Chat not found");
		return chat;
	};

	// One active chat turn at a time. Resolve only when the harness reports the run outcome,
	// not when prompt() returns (that only acknowledges receipt).
	const turns = new Map<string, Promise<void>>();
	const completed = new Map<string, () => void>();
	/** pi has a turn going or queued in the chat. */
	const busy = (chatId: string) => turns.has(chatId) || Boolean(database().prepare("SELECT 1 FROM messages WHERE chat_id = ? AND status = 'working'").get(chatId));
	const askPi = (chat: Chat, user: User, upTo: number, options: { model?: { provider: string; id: string }; thinkingLevel?: string } = {}) => {
		const previous = turns.get(chat.id) ?? Promise.resolve();
		const turn = previous.catch(() => {}).then(async () => {
			const done = new Promise<void>((resolve) => completed.set(chat.id, resolve));
			try {
				if (await performAskPi(getChat(chat.id)!, user, upTo, options)) await done;
			} finally {
				completed.delete(chat.id);
			}
		});
		turns.set(chat.id, turn);
		void turn.finally(() => { if (turns.get(chat.id) === turn) turns.delete(chat.id); }).catch(() => {});
		return turn;
	};

	/** Hand the human messages since pi's last turn to its session (created on first mention), and post a "working" reply. */
	const performAskPi = async (chat: Chat, user: User, upTo: number, options: { model?: { provider: string; id: string }; thinkingLevel?: string } = {}) => {
		// pi knows its own replies; it only needs what people said since.
		const fresh = (database().prepare("SELECT * FROM messages WHERE chat_id = ? AND id > ? AND id <= ? ORDER BY id").all(chat.id, chat.piCursor, upTo) as Row[])
			.map(toMessage)
			.filter((m) => m.message.role !== "assistant");
		database().prepare("UPDATE chats SET pi = 1, pi_cursor = ? WHERE id = ?").run(upTo, chat.id);
		// Shown at once; any failure below (no harness, bad folder, pi not starting) turns it into an error in the chat.
		const pending = insert(chat.id, { role: "assistant", content: [], timestamp: Date.now() }, { status: "working", sessionKey: chat.sessionKey });
		fanOut(chat, "chat_message", pending);
		try {
			let meta = chat.sessionKey ? store.session(chat.sessionKey) : undefined;
			let intro = "";
			if (!meta) {
				const cwd = resolveSafe(chat.folder);
				if (cwd === config.chatFolder) ensureChatFolder();
				meta = await deps.createSession(user, { harness: await deps.harnessFor(user), cwd, ...options, name: chatTitle({ ...chat, pi: true }) });
				database().prepare("UPDATE chats SET session_key = ? WHERE id = ?").run(meta.key, chat.id);
				chat = { ...chat, sessionKey: meta.key, pi: true };
				addMembers(chat, []);
				pending.sessionKey = meta.key;
				update(pending);
				const people = memberIds(chat.id).map((id) => store.userById(id)?.username ?? "unknown");
				intro = `You are pi, taking part in a group chat with ${people.join(", ")}. Each message below is prefixed with its author. Reply to what is asked of you; your reply is posted back to the chat.\n\n`;
			}
			await deps.promptSession(meta, user, { text: intro + transcript(fresh) });
			return true;
		} catch (error) {
			pending.status = "error";
			pending.message = { ...pending.message, content: [{ type: "text", text: `Could not reach pi: ${(error as Error).message}` }] };
			update(pending);
			fanOut(chat, "chat_update", pending);
			return false;
		}
	};

	/** pi finished a run in a chat's session: fill in the oldest reply still marked working. */
	deps.onRun((key, outcome) => {
		const chat = chatOfSession(key);
		if (!chat) return;
		const row = database().prepare("SELECT * FROM messages WHERE chat_id = ? AND status = 'working' ORDER BY id LIMIT 1").get(chat.id) as Row | undefined;
		if (!row) return;
		const reply = toMessage(row);
		reply.status = outcome.kind === "finished" ? "done" : outcome.kind;
		const text = outcome.kind === "aborted" ? "Stopped." : outcome.text;
		reply.message = outcome.message ? { ...outcome.message, author: undefined } : { ...reply.message, content: [{ type: "text", text }] };
		update(reply);
		fanOut(chat, "chat_update", reply, outcome.kind === "aborted" ? undefined : { author: "pi", text: outcome.kind === "error" ? `Error: ${text}` : text });
		completed.get(chat.id)?.();
	});
	// Chats post pi's replies themselves; memory runs are background work.
	deps.setQuiet((key) => Boolean(chatOfSession(key)) || Boolean(store.session(key)?.memory));

	const configSchema = z.object({ model: z.object({ provider: z.string().min(1), id: z.string().min(1) }).optional(), thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional() });
	const sendSchema = configSchema.extend({ text: z.string().trim().min(1).max(50_000) });

	/** Start a chat: with only @pi it is a plain session; with people it is a chat (pi joins if mentioned). */
	router.post("/chats", async (req, res) => {
		const user = req.user!;
		const body = z
			.object({ ...configSchema.shape, text: z.string().trim().min(1).max(50_000), pi: z.boolean().default(false), userIds: z.array(z.string()).max(50).default([]), folder: z.string().max(4000).optional() })
			.parse(req.body);
		const others = [...new Set(body.userIds)].filter((id) => id !== user.id && store.userById(id));
		if (!body.pi && others.length === 0) throw new HttpError(400, "Mention @pi or at least one person");
		const cwd = body.folder ? resolveSafe(body.folder) : ensureChatFolder();
		if (!statSync(cwd).isDirectory()) throw new HttpError(400, "Not a folder");

		if (others.length === 0) {
			const meta = await deps.createSession(user, { harness: await deps.harnessFor(user), cwd, model: body.model, thinkingLevel: body.thinkingLevel });
			await deps.promptSession(meta, user, { text: body.text });
			return void res.json({ session: meta.key });
		}

		const at = now();
		const id = randomUUID();
		database().prepare("INSERT INTO chats (id, folder, pi, created_by, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)").run(id, toRel(cwd), user.id, at, at);
		const chat = getChat(id)!;
		addMembers(chat, [user.id, ...others]);
		const first = insert(id, { role: "user", content: [{ type: "text", text: body.text }], timestamp: Date.now(), author: { id: user.id, username: user.username } });
		fanOut(chat, "chat_message", first, { author: user.username, text: body.text, except: user.id });
		if (body.pi) void askPi(chat, user, first.id, body).catch((error) => console.error("chat: pi failed", error));
		res.json({ chat: id });
	});

	/** The chat list: chats the caller is in, plus their sessions as pi-only chats. */
	router.get("/chats", (req, res) => {
		const user = req.user!;
		const rows = database()
			.prepare(
				`SELECT c.*, m.last_read,
					(SELECT COUNT(*) FROM messages x WHERE x.chat_id = c.id AND x.id > m.last_read AND COALESCE(json_extract(x.message, '$.author.id'), '') != ?) AS unread,
					(SELECT message FROM messages x WHERE x.chat_id = c.id ORDER BY x.id DESC LIMIT 1) AS last,
					(SELECT status FROM messages x WHERE x.chat_id = c.id AND x.status = 'working' LIMIT 1) AS working
				FROM chats c JOIN members m ON m.chat_id = c.id AND m.user_id = ? ORDER BY c.updated_at DESC LIMIT 300`,
			)
			.all(user.id, user.id) as Row[];
		const linked = new Set<string>();
		const chats = rows.map((row) => {
			const chat = toChat(row);
			if (chat.sessionKey) linked.add(chat.sessionKey);
			const last = row.last ? (JSON.parse(String(row.last)) as AgentMessage) : undefined;
			return {
				kind: "chat" as const,
				id: chat.id,
				title: chatTitle(chat, user.id),
				folder: chat.folder,
				pi: chat.pi,
				members: memberIds(chat.id).map((id) => ({ id, username: store.userById(id)?.username ?? "unknown" })),
				running: Boolean(row.working),
				updatedAt: chat.updatedAt,
				unread: Number(row.unread),
				last: last && { author: authorName(last), text: textOf(last).slice(0, 200) },
			};
		});
		const sessions = Object.values(store.data.sessions)
			.filter((meta) => !linked.has(meta.key) && involved(user, meta))
			.map((meta) => {
				const s = deps.sessionSummary(meta, user);
				return { kind: "session" as const, id: meta.key, title: s.name || s.firstMessage || "Untitled session", folder: s.path, harness: s.harness, running: s.running, live: s.live, updatedAt: s.updatedAt, memory: Boolean(meta.memory), canDelete: ["owner", "admin"].includes(accessOf(user, meta) ?? "") };
			});
		const items = [...chats, ...sessions].sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt));
		res.json({ chats: items });
	});

	router.get("/chats/:id", (req, res) => {
		const chat = membership(String(req.params.id), req.user!);
		res.json({
			chat: { ...chat, title: chatTitle(chat, req.user!.id), members: memberIds(chat.id).map((id) => ({ id, username: store.userById(id)?.username ?? "unknown" })) },
			messages: chatMessages(chat.id),
		});
	});

	/** Post a message; @username adds that person, @pi asks pi with everything said since its last turn. */
	router.post("/chats/:id/messages", (req, res) => {
		const user = req.user!;
		let chat = membership(String(req.params.id), user);
		const { text, ...options } = sendSchema.parse(req.body);
		const names = mentions(text);
		const newcomers = names.map((n) => store.userByName(n)?.id).filter((id): id is string => Boolean(id));
		if (newcomers.length) addMembers(chat, newcomers);
		const message = insert(chat.id, { role: "user", content: [{ type: "text", text }], timestamp: Date.now(), author: { id: user.id, username: user.username } });
		database().prepare("UPDATE members SET last_read = ? WHERE chat_id = ? AND user_id = ?").run(message.id, chat.id, user.id);
		chat = getChat(chat.id)!;
		fanOut(chat, "chat_message", message, { author: user.username, text, except: user.id });
		if (names.includes("pi")) void askPi(chat, user, message.id, options).catch((error) => console.error("chat: pi failed", error));
		res.json({ message });
	});

	const chatMessage = (chat: Chat, id: unknown) => {
		const row = database().prepare("SELECT * FROM messages WHERE chat_id = ? AND id = ?").get(chat.id, Number(id)) as Row | undefined;
		if (!row) throw new HttpError(404, "Message not found");
		return toMessage(row);
	};

	/**
	 * Edit a message while pi is not working: people edit their own, any member edits pi's replies.
	 * What pi has already seen is corrected in its session too, so its next turn reads the new text.
	 */
	router.post("/chats/:id/messages/:messageId/edit", async (req, res) => {
		const user = req.user!;
		const chat = membership(String(req.params.id), user);
		const message = chatMessage(chat, req.params.messageId);
		const { text } = z.object({ text: z.string().trim().min(1).max(50_000) }).parse(req.body);
		const assistant = message.message.role === "assistant";
		if (!assistant && (message.message.author as { id?: string } | undefined)?.id !== user.id) throw new HttpError(403, "You can only edit your own messages");
		if (busy(chat.id)) throw new HttpError(409, "Wait until pi has finished before editing");
		if (assistant && message.status !== "done") throw new HttpError(400, "Only finished replies can be edited");
		const before = textOf(message.message);
		const content = replaceText(message.message.content, text, before);
		if (content === undefined) throw new HttpError(409, "The message changed meanwhile; reload and try again");
		const meta = chat.sessionKey ? store.session(chat.sessionKey) : undefined;
		if (meta && (assistant || message.id <= chat.piCursor)) {
			// pi got people's words as "author: text" lines of a transcript, and its reply as is.
			// The same words can occur more than once, so find the occurrence matching this message's place.
			const name = authorName(message.message);
			const needle = assistant ? before : `${name}: ${before.trim()}`;
			const nth = (database().prepare("SELECT * FROM messages WHERE chat_id = ? AND id < ?").all(chat.id, message.id) as Row[])
				.map(toMessage)
				.filter((m) => m.message.role === message.message.role && authorName(m.message) === name && textOf(m.message).trim() === before.trim()).length;
			await deps.editSession(meta, (messages) => {
				let seen = 0;
				for (const [index, m] of messages.entries()) {
					if (m.role !== message.message.role) continue;
					const expect = textOf(m);
					if (assistant) {
						if (expect === needle && seen++ === nth) return { index, expect, text };
						continue;
					}
					for (let at = expect.indexOf(needle); at >= 0; at = expect.indexOf(needle, at + needle.length)) {
						if (seen++ === nth) return { index, expect, text: `${expect.slice(0, at)}${name}: ${text}${expect.slice(at + needle.length)}` };
					}
				}
				return undefined;
			}).catch((error) => {
				// Harnesses that cannot rewrite history (400) keep the old text; the chat still changes.
				if (!(error instanceof HttpError && error.status === 400)) throw error;
			});
		}
		message.message = { ...message.message, content };
		message.editedAt = now();
		database().prepare("UPDATE messages SET message = ?, edited_at = ? WHERE id = ?").run(JSON.stringify(message.message), message.editedAt, message.id);
		fanOut(chat, "chat_update", message);
		res.json({ message });
	});

	/** Toggle the caller's emoji reaction on someone's message (pi's replies take none). */
	router.post("/chats/:id/messages/:messageId/reactions", (req, res) => {
		const user = req.user!;
		const chat = membership(String(req.params.id), user);
		const message = chatMessage(chat, req.params.messageId);
		if (message.message.role !== "user") throw new HttpError(400, "Only people's messages take reactions");
		const { emoji } = z.object({ emoji: z.string().regex(/^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]*$/u).max(16) }).parse(req.body);
		const reactions = { ...message.reactions };
		const users = reactions[emoji] ?? [];
		reactions[emoji] = users.includes(user.id) ? users.filter((id) => id !== user.id) : [...users, user.id];
		if (!reactions[emoji].length) delete reactions[emoji];
		message.reactions = Object.keys(reactions).length ? reactions : undefined;
		database().prepare("UPDATE messages SET reactions = ? WHERE id = ?").run(message.reactions ? JSON.stringify(message.reactions) : null, message.id);
		fanOut(chat, "chat_update", message);
		res.json({ message });
	});

	router.post("/chats/:id/read", (req, res) => {
		const chat = membership(String(req.params.id), req.user!);
		const { upTo } = z.object({ upTo: z.number().int().min(0) }).parse(req.body);
		database().prepare("UPDATE members SET last_read = MAX(last_read, ?) WHERE chat_id = ? AND user_id = ?").run(upTo, chat.id, req.user!.id);
		res.json({ ok: true });
	});

	/** Messages after `after`, plus the current state of `check` (pi replies the client still shows as working): the catch-up after a dropped connection. */
	router.get("/chats/:id/messages", (req, res) => {
		const chat = membership(String(req.params.id), req.user!);
		const after = z.coerce.number().int().min(0).catch(0).parse(req.query.after);
		const check = String(req.query.check ?? "")
			.split(",")
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0)
			.slice(0, 100);
		const fresh = database().prepare("SELECT * FROM messages WHERE chat_id = ? AND id > ? ORDER BY id LIMIT 500").all(chat.id, after) as Row[];
		const updated = check.length ? (database().prepare(`SELECT * FROM messages WHERE chat_id = ? AND id IN (${check.map(() => "?").join(",")})`).all(chat.id, ...check) as Row[]) : [];
		res.json({ messages: [...updated, ...fresh].map(toMessage) });
	});

	/** Fuzzy search for #mentions: folders, or with files=1 files and folders. */
	router.get("/folders/search", (req, res) => {
		ensureChatFolder();
		const q = String(req.query.q ?? "").toLowerCase();
		const withFiles = req.query.files === "1";
		const entries = withFiles ? allEntries() : allFolders().map((p) => ({ path: p, type: "dir" as const }));
		const scored = q ? entries.map((e) => ({ e, score: fuzzyScore(e.path.toLowerCase(), q) })).filter((x) => x.score > 0) : entries.slice(0, 200).map((e) => ({ e, score: 1 }));
		scored.sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length);
		const top = scored.slice(0, 15).map((x) => x.e);
		res.json({ folders: top.filter((e) => e.type === "dir").map((e) => e.path), entries: top, chatFolder: toRel(config.chatFolder) });
	});

	const isMember = (chatId: string, user: User) => Boolean(getChat(chatId) && memberIds(chatId).includes(user.id));
	return {
		busy,
		isMember,
		title: (chatId: string, viewerId: string) => {
			const chat = getChat(chatId);
			return chat ? chatTitle(chat, viewerId) : undefined;
		},
		/** Chats `user` is in, newest first, for the share-to picker. */
		shareTargets: (user: User) =>
			(database().prepare("SELECT c.* FROM chats c JOIN members m ON m.chat_id = c.id AND m.user_id = ? ORDER BY c.updated_at DESC LIMIT 300").all(user.id) as Row[])
				.map(toChat)
				.map((chat) => ({ kind: "chat" as const, id: chat.id, title: chatTitle(chat, user.id), folder: chat.folder, running: busy(chat.id), updatedAt: chat.updatedAt })),
		/** Post a message shared from elsewhere as `user`'s; pi reads it with the rest on its next turn. */
		post: (chatId: string, user: User, text: string) => {
			const chat = getChat(chatId);
			if (!chat || !isMember(chatId, user)) return;
			const message = insert(chat.id, { role: "user", content: [{ type: "text", text }], timestamp: Date.now(), author: { id: user.id, username: user.username } });
			fanOut(chat, "chat_message", message, { author: user.username, text, except: user.id });
		},
	};
}

/** Every folder under FS_ROOT a few levels deep (relative paths), cached briefly. */
let folderCache: { at: number; folders: string[] } | undefined;
const SKIP = new Set(["node_modules", "__pycache__", "venv", ".venv", "dist", "build", "target"]);
function allFolders() {
	if (folderCache && Date.now() - folderCache.at < 60_000) return folderCache.folders;
	const folders: string[] = [];
	const queue: { dir: string; depth: number }[] = [{ dir: config.fsRoot, depth: 0 }];
	while (queue.length && folders.length < 20_000) {
		const { dir, depth } = queue.shift()!;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			folders.push(toRel(full));
			if (depth < 5) queue.push({ dir: full, depth: depth + 1 });
		}
	}
	folderCache = { at: Date.now(), folders };
	return folders;
}

/** Files and folders under FS_ROOT a few levels deep, for #file mentions; cached briefly. */
let entryCache: { at: number; entries: { path: string; type: "dir" | "file" }[] } | undefined;
function allEntries() {
	if (entryCache && Date.now() - entryCache.at < 60_000) return entryCache.entries;
	const entries: { path: string; type: "dir" | "file" }[] = [];
	const queue: { dir: string; depth: number }[] = [{ dir: config.fsRoot, depth: 0 }];
	while (queue.length && entries.length < 50_000) {
		const { dir, depth } = queue.shift()!;
		let list;
		try {
			list = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of list) {
			if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				entries.push({ path: toRel(full), type: "dir" });
				if (depth < 5) queue.push({ dir: full, depth: depth + 1 });
			} else if (entry.isFile()) entries.push({ path: toRel(full), type: "file" });
		}
	}
	entryCache = { at: Date.now(), entries };
	return entries;
}

/** Subsequence match; contiguous runs, segment starts and hits in the last segment score higher. */
export function fuzzyScore(target: string, query: string) {
	let score = 0;
	let t = 0;
	let run = 0;
	const lastSlash = target.lastIndexOf("/");
	for (const ch of query) {
		const found = target.indexOf(ch, t);
		if (found < 0) return 0;
		run = found === t ? run + 1 : 1;
		score += run * 2 + (found === 0 || target[found - 1] === "/" || target[found - 1] === "-" || target[found - 1] === "_" ? 3 : 0) + (found > lastSlash ? 2 : 0);
		t = found + 1;
	}
	return score;
}
