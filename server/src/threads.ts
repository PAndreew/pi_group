import os from "node:os";
import type { Router } from "express";
import { z } from "zod";
import { archiveMessages, archiveStats, type ConversationInfo, forgetConversation, formatTurns, readConversation, recentTurns, relabelConversation, searchTurns } from "./archive.js";
import { requireAuth } from "./auth.js";
import { agenticChatIds, chatOfSession, chatReadable, ensureChatFolder, importChatsToArchive } from "./chats.js";
import { HttpError } from "./files.js";
import { runPi } from "./harness/pi-rpc.js";
import { contentText } from "./harness/live-base.js";
import type { AgentMessage, PromptInput } from "./harness/types.js";
import { bridgeCredentialValid } from "./interactions.js";
import { platform } from "./ports/index.js";
import { canAccessProject, projectIdOf, tenantProjects, type Project } from "./projects.js";
import { saveNow, type SessionMeta, store, type User } from "./store.js";
import { inTenant } from "./tenant-context.js";
import { isTenantMember, tenantOf } from "./tenants.js";

/*
 * The conversation model. Each person has one agent thread per project: the only place they write
 * to their agent. Long tasks run in side threads that post a summary back to the agent thread when
 * they finish, fail or are stopped. People talk in chats, agentic (the agents of the people in them
 * see them, and @pi gets the asker's agent) or private (no agent ever sees them).
 *
 * Agents keep only the last CONTEXT_HOURS of conversation in their model context
 * (extensions/context-window.mjs); everything older is in the archive (archive.ts), which they search
 * with history_search / history_read (extensions/threads.mjs). Both extensions reach the server
 * through the session's bridge credential at /api/threads-bridge/<session>.
 */

const HOURS = Math.max(1, Number(process.env.CONTEXT_HOURS ?? 24) || 24);
const DIGEST_CHARS = 6000;

type Outcome = { kind: "finished" | "error" | "aborted"; text: string; message?: AgentMessage };

export interface ThreadDeps {
	createSession: (user: User, input: { harness: string; cwd: string; name?: string; projectId?: string }) => Promise<SessionMeta>;
	promptSession: (meta: SessionMeta, user: User, input: PromptInput) => Promise<void>;
	harnessFor: (user: User) => Promise<string>;
	onRun: (listener: (key: string, outcome: Outcome) => void) => void;
	/** A session's messages, with prompt authors: the live state when running, else its transcript. */
	messagesOf: (meta: SessionMeta) => Promise<AgentMessage[]>;
	summary: (meta: SessionMeta, user: User) => unknown;
	canRead: (user: User, meta: SessionMeta) => boolean;
	canWrite: (user: User, meta: SessionMeta) => boolean;
}

export const conversationOf = (meta: SessionMeta) => `session:${meta.key}`;
const kindOf = (meta: SessionMeta) => (meta.thread === "main" ? "main" : meta.thread === "side" ? "side" : "session") as ConversationInfo["kind"];
/** Chat agents' turns are archived as the chat's own messages; memory and applet runs are background work. */
const archived = (meta: SessionMeta) => !meta.deleted && meta.thread !== "chat" && !meta.memory && !meta.applet;
const windowed = (meta: SessionMeta) => meta.thread === "main" || meta.thread === "side" || meta.thread === "chat";
const agentName = (meta: SessionMeta) => `${store.userById(meta.ownerId ?? "")?.username ?? "someone"}'s agent`;

function infoOf(meta: SessionMeta): ConversationInfo {
	let projectId = meta.projectId;
	try {
		projectId = projectIdOf(meta.cwd, meta.projectId, meta.tenantId ?? "work");
	} catch {
		/* folders outside the tenant root keep their explicit project */
	}
	return { conversation: conversationOf(meta), tenantId: meta.tenantId ?? "work", projectId, kind: kindOf(meta), title: meta.name ?? meta.firstMessage };
}

const senderOf = (meta: SessionMeta) => (message: AgentMessage) => {
	if (message.role === "user") {
		const author = message.author as { id?: string; username?: string } | undefined;
		const owner = store.userById(meta.ownerId ?? "");
		return { id: author?.id ?? owner?.id, name: author?.username ?? owner?.username ?? "someone" };
	}
	if (message.role === "toolResult") return { name: "tool" };
	return { name: agentName(meta) };
};

/** One short title for a conversation: pi in print mode, or its first words when that is not possible. */
export async function generateTitle(text: string) {
	const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 4000);
	const fallback = () => {
		const words = excerpt.replace(/^[^:]{1,40}:\s*/, "").split(" ").filter(Boolean).slice(0, 6).join(" ");
		return words ? (words.length > 60 ? `${words.slice(0, 57)}…` : words) : "Untitled";
	};
	if (!excerpt) return "Untitled";
	try {
		const prompt = `Write a title of at most 6 words for this conversation. Reply with the title only, no quotes or punctuation at the end.\n\n${excerpt}`;
		const { code, stdout } = await runPi(["--print", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", prompt], os.tmpdir(), 45_000);
		const line = stdout.split("\n").map((l) => l.trim()).find(Boolean);
		const title = line?.replace(/^["'“”#*\s]+|["'“”.*\s]+$/g, "").slice(0, 60);
		return code === 0 && title ? title : fallback();
	} catch {
		return fallback();
	}
}

/** The text a title is made from: what was said, author first. */
export const titleSource = (messages: AgentMessage[]) =>
	messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.slice(0, 12)
		.map((m) => `${m.role === "user" ? ((m.author as { username?: string } | undefined)?.username ?? "user") : "agent"}: ${(contentText(m.content as never) || (typeof m.content === "string" ? m.content : "")).slice(0, 400)}`)
		.join("\n");

export function mountThreads(router: Router, deps: ThreadDeps) {
	router.use(["/agent-thread", "/archive"], requireAuth);

	const ownerOf = (meta: SessionMeta) => {
		const owner = meta.ownerId ? store.userById(meta.ownerId) : undefined;
		if (!owner || !isTenantMember(owner.id, meta.tenantId ?? "work")) throw new HttpError(403, "The session's owner is no longer in this tenant");
		return owner;
	};

	/** Who may read an archived conversation: the session's readers, or the members of an agentic chat. */
	const reader = (user: User) => (conversation: string) => {
		if (conversation.startsWith("session:")) {
			const meta = store.session(conversation.slice("session:".length));
			return Boolean(meta && !meta.deleted && deps.canRead(user, meta));
		}
		if (conversation.startsWith("chat:")) return chatReadable(user.id, conversation.slice("chat:".length));
		return false;
	};

	// ---- Archiving ----------------------------------------------------------------------------

	const archiveSession = async (meta: SessionMeta) => {
		if (!archived(meta)) return 0;
		return archiveMessages(infoOf(meta), await deps.messagesOf(meta), senderOf(meta));
	};

	// ---- Agent threads ------------------------------------------------------------------------

	/** A person's agent thread in a project, if it exists. */
	const findThread = (user: User, project: Project) =>
		Object.values(store.data.sessions).find((m) => m.thread === "main" && !m.deleted && m.ownerId === user.id && (m.tenantId ?? "work") === (project.tenantId ?? "work") && m.projectId === project.id);

	/** A person's agent thread in a project, created on first use (in the project's folder; General: the chat folder). */
	const agentThreadFor = async (user: User, projectId?: string) => {
		const project = tenantProjects().find((p) => (projectId ? p.id === projectId : p.general));
		if (!project || !canAccessProject(user, project)) throw new HttpError(404, "Project not found");
		const existing = findThread(user, project);
		if (existing) return existing;
		const cwd = project.general ? ensureChatFolder() : project.cwd;
		const meta = await deps.createSession(user, { harness: await deps.harnessFor(user), cwd, name: project.general ? "Agent" : `Agent · ${project.name}`, projectId: project.id });
		return store.upsertSession({ ...meta, thread: "main" });
	};

	router.get("/agent-thread", (req, res) => {
		const project = tenantProjects().find((p) => (typeof req.query.project === "string" ? p.id === req.query.project : p.general));
		if (!project || !canAccessProject(req.user!, project)) throw new HttpError(404, "Project not found");
		const meta = findThread(req.user!, project);
		res.json({ session: meta ? deps.summary(meta, req.user!) : null });
	});

	router.post("/agent-thread", async (req, res) => {
		const { project } = z.object({ project: z.string().optional() }).parse(req.body ?? {});
		const meta = await agentThreadFor(req.user!, project);
		res.json({ session: deps.summary(meta, req.user!) });
	});

	// ---- Side threads -------------------------------------------------------------------------

	const sidePrompt = (main: SessionMeta, task: string) =>
		[
			`You are a side thread of the agent thread "${main.name ?? "Agent"}", working on one longer task on your own.`,
			`When you are done (or cannot go on), end with a short summary: what you did, the outcome, and anything the person must decide. It is posted back to the agent thread.`,
			`If you need the agent thread's earlier context, use history_read with conversation "${conversationOf(main)}".`,
			"",
			`Task: ${task}`,
		].join("\n");

	const startSide = async (main: SessionMeta, user: User, task: string, name?: string) => {
		if (main.thread !== "main") throw new HttpError(400, "Side threads start from an agent thread");
		const created = await deps.createSession(user, { harness: main.harness, cwd: main.cwd, name: name?.trim() || (await generateTitle(task)), projectId: main.projectId });
		const side = store.upsertSession({ ...created, thread: "side", parentKey: main.key, sideStatus: "running" });
		await deps.promptSession(side, user, { text: sidePrompt(main, task) });
		return side;
	};

	const lastAnswer = (messages: AgentMessage[]) => {
		const last = messages.findLast((m) => m.role === "assistant" && (contentText(m.content as never) || "").trim());
		return last ? contentText(last.content as never).trim() : "";
	};

	/** Post a side thread's result into its agent thread (as its owner), and mark how it ended. */
	const merge = async (side: SessionMeta, status: NonNullable<SessionMeta["sideStatus"]>, text: string) => {
		const main = side.parentKey ? store.session(side.parentKey) : undefined;
		store.upsertSession({ ...side, sideStatus: status });
		if (!main || main.deleted) return;
		const owner = ownerOf(main);
		const verb = status === "merged" ? "finished" : status === "failed" ? "failed" : "was stopped";
		const body = text.trim().slice(0, 6000) || "(no summary)";
		await deps.promptSession(main, owner, { text: `[Side thread "${side.name ?? "side thread"}" ${verb}]\n\n${body}\n\n(Full side thread: history_read conversation "${conversationOf(side)}".)` });
	};

	deps.onRun((key, outcome) => {
		const meta = store.session(key);
		if (!meta) return;
		void archiveSession(meta).catch((error) => console.error("archive:", error));
		if (meta.thread === "side" && meta.sideStatus === "running") {
			const status = outcome.kind === "finished" ? "merged" : outcome.kind === "aborted" ? "aborted" : "failed";
			const text = outcome.kind === "aborted" ? "Stopped before finishing." : outcome.text;
			void inTenant(tenantOf(meta.tenantId ?? "work")!, () => merge(meta, status, text)).catch((error) => console.error("side thread merge:", error));
		}
	});

	router.post("/sessions/:key/side", async (req, res) => {
		const main = store.session(String(req.params.key));
		if (!main || main.deleted || !deps.canWrite(req.user!, main)) throw new HttpError(404, "Session not found");
		const body = z.object({ task: z.string().trim().min(1).max(20_000), name: z.string().max(120).optional() }).parse(req.body);
		const side = await startSide(main, req.user!, body.task, body.name);
		res.json({ session: deps.summary(side, req.user!) });
	});

	/** Post a side thread's latest answer into its agent thread now (again, if it was merged before). */
	router.post("/sessions/:key/merge", async (req, res) => {
		const side = store.session(String(req.params.key));
		if (!side || side.deleted || side.thread !== "side" || !deps.canWrite(req.user!, side)) throw new HttpError(404, "Side thread not found");
		await merge(side, "merged", lastAnswer(await deps.messagesOf(side)));
		res.json({ session: deps.summary(store.session(side.key)!, req.user!) });
	});

	/** Name a session from its conversation. */
	router.post("/sessions/:key/title", async (req, res) => {
		const meta = store.session(String(req.params.key));
		if (!meta || meta.deleted || !deps.canWrite(req.user!, meta)) throw new HttpError(404, "Session not found");
		const name = await generateTitle(titleSource(await deps.messagesOf(meta)));
		store.upsertSession({ ...meta, name });
		relabelConversation(conversationOf(meta), { title: name });
		res.json({ name });
	});

	// ---- Archive search for people ------------------------------------------------------------

	const time = (value: unknown) => {
		if (value === undefined || value === "") return undefined;
		const n = typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : Date.parse(String(value));
		return Number.isFinite(n) ? n : undefined;
	};

	router.get("/archive/search", (req, res) => {
		const q = z.object({ q: z.string().max(500).optional(), project: z.string().optional(), conversation: z.string().optional(), since: z.string().optional(), limit: z.coerce.number().optional() }).parse(req.query);
		const turns = searchTurns({ tenantId: tenantOf()?.id ?? "work", text: q.q, projectId: q.project, conversation: q.conversation, since: time(q.since), limit: q.limit }, reader(req.user!));
		res.json({ turns });
	});

	// ---- The agents' bridge ---------------------------------------------------------------------

	/** The agentic chats of the last window, in brief, for an agent's context. */
	const digest = (meta: SessionMeta, owner: User) => {
		const since = Date.now() - HOURS * 3_600_000;
		// A chat agent already has its own chat in context.
		const own = meta.thread === "chat" ? chatOfSession(meta.key)?.id : undefined;
		const chats = agenticChatIds(owner.id, meta.tenantId ?? "work").filter((id) => id !== own);
		const turns = recentTurns(chats.map((id) => `chat:${id}`), since);
		if (!turns.length) return "";
		let text = formatTurns(turns, { conversation: true });
		if (text.length > DIGEST_CHARS) text = `…\n${text.slice(-DIGEST_CHARS)}`;
		return `## Recent agentic chats (last ${HOURS}h) of ${owner.username}\nYou can see these chats; reply in them only when asked there with @pi.\n${text}`;
	};
	const bridgeBody = z.discriminatedUnion("action", [
		z.object({ action: z.literal("context") }),
		z.object({ action: z.literal("search"), query: z.string().max(500).optional(), conversation: z.string().max(300).optional(), sender: z.string().max(100).optional(), since: z.union([z.string(), z.number()]).optional(), until: z.union([z.string(), z.number()]).optional(), project: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
		z.object({ action: z.literal("read"), conversation: z.string().max(300), around: z.union([z.string(), z.number()]).optional(), before: z.number().int().min(0).max(200).optional(), after: z.number().int().min(0).max(200).optional() }),
		z.object({ action: z.literal("side"), task: z.string().trim().min(1).max(20_000), name: z.string().max(120).optional() }),
	]);

	router.post("/threads-bridge/:key", async (req, res) => {
		const key = String(req.params.key);
		if (!bridgeCredentialValid(key, req.headers.authorization)) throw new HttpError(403, "Invalid bridge credential");
		const meta = store.session(key);
		if (!meta || meta.deleted) throw new HttpError(404, "Session not found");
		const owner = ownerOf(meta);
		const tenant = tenantOf(meta.tenantId ?? "work");
		if (!tenant) throw new HttpError(403, "Tenant unavailable");
		const body = bridgeBody.parse(req.body);
		await inTenant(tenant, async () => {
			if (body.action === "context") {
				if (!windowed(meta)) return void res.json({ windowHours: null });
				return void res.json({
					windowHours: HOURS,
					note: `Only the last ${HOURS} hours of this conversation are in your context. Earlier turns, and other conversations you may read, are in the archive: use history_search to find them and history_read to read around a result.`,
					digest: digest(meta, owner),
				});
			}
			if (body.action === "search") {
				const turns = searchTurns(
					{ tenantId: tenant.id, text: body.query, conversation: body.conversation, sender: body.sender, since: time(body.since), until: time(body.until), projectId: body.project, limit: body.limit },
					reader(owner),
				);
				return void res.json({ count: turns.length, results: formatTurns(turns, { conversation: true }) || "No matching turns." });
			}
			if (body.action === "read") {
				if (!reader(owner)(body.conversation)) throw new HttpError(404, "Conversation unavailable");
				const turns = readConversation(body.conversation, { around: time(body.around), before: body.before, after: body.after });
				return void res.json({ count: turns.length, turns: formatTurns(turns) || "Nothing archived for this conversation yet." });
			}
			const side = await startSide(meta, owner, body.task, body.name);
			res.json({ sessionKey: side.key, name: side.name, status: "started" });
		});
	});

	// ---- One-time import of what existed before the archive -------------------------------------

	const importAll = async () => {
		if (store.data.archiveImportedAt) return;
		let sessions = 0;
		for (const meta of Object.values(store.data.sessions)) {
			if (!archived(meta)) continue;
			try {
				const tenant = tenantOf(meta.tenantId ?? "work");
				if (tenant) sessions += await inTenant(tenant, () => archiveSession(meta));
			} catch (error) {
				console.error(`archive import: ${meta.key}:`, (error as Error).message);
			}
		}
		const chats = importChatsToArchive();
		store.data.archiveImportedAt = new Date().toISOString();
		saveNow();
		const stats = archiveStats();
		console.log(`archive: imported ${sessions} session turns and ${chats} chat turns (${stats.turns} turns in ${stats.conversations} conversations)`);
	};
	platform().scheduler.every(24 * 3_600_000, () => void importAll().catch((error) => console.error("archive import:", error)), 15_000);

	return {
		agentThreadFor,
		forgetSession: (meta: SessionMeta) => forgetConversation(conversationOf(meta)),
		archiveSession,
	};
}
