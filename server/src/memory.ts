import type { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "./auth.js";
import { type ChatDeps, type ChatMessage, chatMessages, chatOfSession, chatTitle, ensureChatFolder, markChatConsolidated, memberIds, staleChats, transcript } from "./chats.js";
import { config } from "./config.js";
import { toRel } from "./files.js";
import type { AgentMessage } from "./harness/types.js";
import { platform } from "./ports/index.js";
import type { RunOutcome } from "./sessions.js";
import { type SessionMeta, store } from "./store.js";
import { inTenant, tenantId } from "./tenant-context.js";
import { isTenantMember } from "./tenants.js";

/*
 * Memory consolidation: chats nobody touched for MEMORY_AFTER_DAYS are handed, one at a time, to a
 * master "Memory" pi session in the chat folder, which keeps MEMORY.md (an index) and memory/<chat>.md
 * up to date. The folder's AGENTS.md tells every pi session there to consult them.
 */

const MAX_TRANSCRIPT = 40_000;
const RUN_TIMEOUT_MS = 20 * 60_000;

export interface MemoryDeps extends ChatDeps {
	/** Stored messages of a session, without starting it. */
	readMessages: (meta: SessionMeta) => Promise<AgentMessage[]>;
}

interface Candidate {
	kind: "chat" | "session";
	id: string;
	title: string;
	participants: string[];
	lastActive: string;
	load: () => Promise<string>;
	done: (at: string) => void;
}

const instructions = [
	"Consolidate the conversation below into long-term memory, working in this folder:",
	"- Keep one file per conversation in `memory/` (create the folder if needed); name it after the conversation (kebab-case) and update it if it exists.",
	"- Keep `MEMORY.md` as a short index: one line per conversation with its date, participants, file link and the key facts.",
	"- Record durable facts, decisions, preferences, people, open questions and where work lives (folders, files); skip small talk.",
	"- Merge with what is already there instead of duplicating it. Do not change anything outside `MEMORY.md` and `memory/`.",
	"Reply with one line saying what you recorded.",
].join("\n");

export function mountMemory(router: Router, deps: MemoryDeps) {
	router.use("/memory", requireAuth, requireAdmin);

	const waiters = new Map<string, (outcome: RunOutcome) => void>();
	deps.onRun((key, outcome) => {
		waiters.get(key)?.(outcome);
		waiters.delete(key);
	});

	const running = new Set<string>();
	const lastRuns = new Map<string, { at: string; consolidated: number; error?: string }>();

	const masterSession = async () => {
		const existing = Object.values(store.data.sessions).find((s) => s.memory && !s.deleted && (s.tenantId ?? "work") === tenantId());
		if (existing) return existing;
		const admin = store.data.users.find((u) => u.role === "admin" && isTenantMember(u.id));
		if (!admin) throw new Error("No admin user to own the memory session");
		const meta = await deps.createSession(admin, { harness: await deps.harnessFor(admin), cwd: ensureChatFolder(), name: "Memory" });
		return store.upsertSession({ ...meta, memory: true });
	};

	const candidates = async (before: string): Promise<Candidate[]> => {
		const chats: Candidate[] = staleChats(before).filter(chat => (chat.tenantId ?? "work") === tenantId()).map((chat) => ({
			kind: "chat",
			id: chat.id,
			title: chatTitle(chat),
			participants: [...memberIds(chat.id).map((id) => store.userById(id)?.username ?? "unknown"), ...(chat.pi ? ["pi"] : [])],
			lastActive: chat.updatedAt,
			load: async () => transcript(chatMessages(chat.id, 2000)),
			done: (at) => markChatConsolidated(chat.id, at),
		}));
		// pi-only chats started without a folder live in the chat folder.
		const sessions: Candidate[] = Object.values(store.data.sessions)
			.filter((s) => !s.deleted && !s.memory && (s.tenantId ?? "work") === tenantId() && s.cwd === config.chatFolder && !chatOfSession(s.key))
			.filter((s) => (s.updatedAt ?? s.createdAt) < before && (!s.consolidatedAt || s.consolidatedAt < (s.updatedAt ?? s.createdAt)))
			.map((s) => ({
				kind: "session",
				id: s.key,
				title: s.name || s.firstMessage || "Untitled session",
				participants: [store.userById(s.ownerId ?? "")?.username ?? "someone", "pi"],
				lastActive: s.updatedAt ?? s.createdAt,
				load: async () => {
					const messages = await deps.readMessages(s);
					return transcript(messages.filter((m) => m.role === "user" || m.role === "assistant").map((message, i) => ({ id: i, chatId: s.key, message, createdAt: "" }) as ChatMessage));
				},
				done: (at) => store.upsertSession({ ...store.session(s.key)!, consolidatedAt: at }),
			}));
		return [...chats, ...sessions].sort((a, b) => a.lastActive.localeCompare(b.lastActive));
	};

	/** Fold every stale conversation into memory, one run at a time. */
	const consolidate = async (before: string) => {
		const id = tenantId();
		if (running.has(id)) return 0;
		running.add(id);
		let count = 0;
		try {
			const todo = await candidates(before);
			if (!todo.length) return 0;
			const master = await masterSession();
			const owner = store.userById(master.ownerId ?? "") ?? store.data.users.find((u) => u.role === "admin")!;
			for (const item of todo) {
				const text = await item.load();
				const startedAt = new Date().toISOString();
				if (text.trim()) {
					const body = text.length > MAX_TRANSCRIPT ? `[earlier part omitted]\n\n${text.slice(-MAX_TRANSCRIPT)}` : text;
					const header = `Conversation "${item.title}" (${item.kind} ${item.id}) · participants: ${item.participants.join(", ")} · last active ${item.lastActive.slice(0, 10)}`;
					const finished = new Promise<RunOutcome>((resolve, reject) => {
						const timer = setTimeout(() => reject(new Error("The memory session did not finish in time")), RUN_TIMEOUT_MS);
						waiters.set(master.key, (outcome) => {
							clearTimeout(timer);
							resolve(outcome);
						});
					});
					await deps.promptSession(store.session(master.key)!, owner, { text: `${instructions}\n\n${header}\n\n${body}` });
					const outcome = await finished;
					if (outcome.kind !== "finished") throw new Error(`Memory run ${outcome.kind}: ${outcome.text}`.trim());
				}
				item.done(startedAt);
				count++;
			}
			lastRuns.set(id, { at: new Date().toISOString(), consolidated: count });
			return count;
		} catch (error) {
			lastRuns.set(id, { at: new Date().toISOString(), consolidated: count, error: (error as Error).message });
			console.error("memory:", (error as Error).message);
			return count;
		} finally {
			running.delete(id);
		}
	};

	const cutoff = () => new Date(Date.now() - config.memoryAfterDays * 86_400_000).toISOString();
	if (config.memoryAfterDays > 0) {
		const tick = () => {
			for (const tenant of store.data.tenants) void inTenant(tenant, () => consolidate(cutoff()));
		};
		platform().scheduler.every(60 * 60_000, tick, 2 * 60_000);
	}

	router.get("/memory", async (_req, res) => {
		const master = Object.values(store.data.sessions).find((s) => s.memory && !s.deleted && (s.tenantId ?? "work") === tenantId());
		res.json({
			enabled: config.memoryAfterDays > 0,
			afterDays: config.memoryAfterDays,
			folder: toRel(config.chatFolder),
			sessionKey: master?.key,
			running: running.has(tenantId()),
			lastRun: lastRuns.get(tenantId()),
			pending: config.memoryAfterDays > 0 ? (await candidates(cutoff())).length : 0,
		});
	});

	/** Consolidate now; `all` ignores the age limit (everything not consolidated since its last activity). */
	router.post("/memory/consolidate", async (req, res) => {
		const { all } = z.object({ all: z.boolean().default(false) }).parse(req.body ?? {});
		if (running.has(tenantId())) return void res.json({ started: false, reason: "Already running" });
		const before = all ? new Date(Date.now() + 1000).toISOString() : cutoff();
		const pending = (await candidates(before)).length;
		void consolidate(before);
		res.json({ started: pending > 0, pending });
	});
}
