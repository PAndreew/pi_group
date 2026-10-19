import fs from "node:fs/promises";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { creationOptions } from "./preferences.js";
import { mountChats } from "./chats.js";
import { mcpReport, piResources } from "./inventory.js";
import { mountInteractions } from "./interactions.js";
import { mountMemory } from "./memory.js";
import { pushToUser } from "./push.js";
import { attributeMessages, registerPrompt, rekeyAuthors } from "./authorship.js";
import { config } from "./config.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import { contentText, replaceText } from "./harness/live-base.js";
import type { AgentMessage, HarnessAdapter, LiveSession, PromptInput, SessionEvent, SessionListing, SessionState } from "./harness/types.js";
import { type Access, type SessionMeta, save, saveNow, store, type User } from "./store.js";

export type EffectiveAccess = "admin" | "owner" | Access;

export function accessOf(user: User, meta: SessionMeta): EffectiveAccess | undefined {
	if (meta.ownerId === user.id) return "owner";
	if (user.role === "admin") return "admin";
	if (meta.visibility === "shared") return meta.shares.find((s) => s.userId === user.id)?.access;
	return undefined;
}

const canWrite = (a?: EffectiveAccess) => a === "admin" || a === "owner" || a === "write";
const canManage = (a?: EffectiveAccess) => a === "admin" || a === "owner";

/** Users who hear about a session's runs: the owner, people it is shared with, and anyone who prompted it. */
export function involved(user: User, meta: SessionMeta) {
	if (meta.deleted || !accessOf(user, meta)) return false;
	if (meta.ownerId === user.id || (meta.visibility === "shared" && meta.shares.some((s) => s.userId === user.id))) return true;
	const ledger = meta.authorship;
	return Boolean(ledger && (Object.values(ledger.authors).some((a) => a.id === user.id) || ledger.pending.some((p) => p.author.id === user.id)));
}

export interface RunOutcome {
	kind: "finished" | "error" | "aborted";
	text: string;
	/** The final assistant message, for "finished". */
	message?: AgentMessage;
}

export interface RunNotice {
	type: "run";
	kind: "finished" | "error";
	key: string;
	path: string;
	name: string;
	text: string;
}

/** Notification bodies are plain text: drop code blocks and markdown punctuation. */
export function plainText(markdown: string) {
	return markdown
		.replace(/```[\s\S]*?(```|$)/g, " [code] ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`#>|~]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function lastAssistant(state: SessionState) {
	return state.messages.findLast((m) => m.role === "assistant");
}

const firstLine = (text: string) => text.trim().split("\n")[0].slice(0, 200);

/** Fans one live session's events out to every SSE client watching it. */
class Hub {
	private clients = new Map<string, Set<Response>>();

	state(key: string, state: SessionState): SessionState {
		const ledger = store.session(key)?.authorship;
		if (!ledger) return state;
		const pendingCount = ledger.pending.length;
		const messages = attributeMessages(ledger, state.messages);
		if (ledger.pending.length !== pendingCount) saveNow();
		return { ...state, messages };
	}
	private attached = new Map<string, { live: LiveSession; unsubscribe: () => void }>();
	private running = new Map<string, boolean>();
	private watchers = new Set<{ user: User; res: Response }>();
	private runListeners = new Set<(key: string, outcome: RunOutcome) => void>();
	/** Sessions whose outcomes are reported elsewhere (a chat posts pi's reply), so no run notification. */
	quiet: (key: string) => boolean = () => false;

	/** Called when a run ends, including aborted and stopped ones. */
	onRun(listener: (key: string, outcome: RunOutcome) => void) {
		this.runListeners.add(listener);
		return () => this.runListeners.delete(listener);
	}

	/** Send an event on one user's stream (every open tab or device). */
	sendTo(userId: string, event: unknown) {
		for (const { user, res } of this.watchers) if (user.id === userId) send(res, event);
	}

	private finish(key: string, outcome: RunOutcome) {
		for (const listener of this.runListeners) listener(key, outcome);
		if (outcome.kind !== "aborted" && !this.quiet(key)) this.announce(key, outcome.kind, outcome.text);
	}

	/** Per-user stream of run outcomes (finished / failed) for browser notifications. */
	watch(user: User, res: Response) {
		const watcher = { user, res };
		this.watchers.add(watcher);
		return () => this.watchers.delete(watcher);
	}

	private announce(key: string, kind: RunNotice["kind"], text: string) {
		const meta = store.session(key);
		if (!meta) return;
		const notice: RunNotice = { type: "run", kind, key, path: toRel(meta.cwd), name: meta.name || meta.firstMessage || "Untitled session", text: plainText(text).slice(0, 300) };
		for (const { user, res } of this.watchers) {
			// Re-read the user: roles and sharing may have changed since the stream opened.
			const current = store.userById(user.id);
			if (current && involved(current, meta)) send(res, notice);
		}
		// Push reaches devices whose app is closed or frozen; the service worker skips it when the app is in front.
		for (const user of store.data.users) {
			if (involved(user, meta)) void pushToUser(user.id, notice);
		}
	}

	/** Turn running → idle transitions into outcomes; only "finished" and "error" notify, aborts and stopped processes stay quiet. */
	private observe(key: string, live: LiveSession, event: SessionEvent) {
		const running = event.type === "state" ? event.state.running : event.type === "status" ? event.status.running : undefined;
		if (event.type === "notify" && event.level === "error" && !live.state.running) {
			this.finish(key, { kind: "error", text: event.text });
			return;
		}
		if (running === undefined) return;
		const was = this.running.get(key);
		this.running.set(key, running);
		if (!was || running) return;
		const state = live.state;
		const last = lastAssistant(state);
		if (state.notice?.level === "error") this.finish(key, { kind: "error", text: state.notice.text });
		else if (!state.live || last?.stopReason === "aborted") this.finish(key, { kind: "aborted", text: "" });
		else this.finish(key, { kind: "finished", text: contentText(last?.content), message: last });
	}

	count(key: string) {
		return this.clients.get(key)?.size ?? 0;
	}

	add(key: string, res: Response) {
		let set = this.clients.get(key);
		if (!set) this.clients.set(key, (set = new Set()));
		set.add(res);
	}

	remove(key: string, res: Response) {
		this.clients.get(key)?.delete(res);
	}

	broadcast(key: string, event: SessionEvent | { type: string; [k: string]: unknown }) {
		for (const res of this.clients.get(key) ?? []) send(res, event);
	}

	/** Relay a live session's events; the subscription itself delivers the current state first. */
	attach(key: string, live: LiveSession) {
		const current = this.attached.get(key);
		if (current?.live === live) return;
		current?.unsubscribe();
		const unsubscribe = live.subscribe((event) => {
			this.observe(key, live, event);
			if (event.type === "state") this.broadcast(key, { ...event, state: this.state(key, event.state) });
			else if (event.type === "message") {
				const state = this.state(key, live.state);
				this.broadcast(key, { ...event, message: state.messages.at(-1) ?? event.message });
			} else this.broadcast(key, event);
			if (event.type === "state" && !event.state.live) this.detach(key, live);
		});
		this.attached.set(key, { live, unsubscribe });
	}

	isAttached(key: string, live: LiveSession) {
		return this.attached.get(key)?.live === live;
	}

	private detach(key: string, live: LiveSession) {
		const current = this.attached.get(key);
		if (current?.live !== live) return;
		queueMicrotask(() => current.unsubscribe());
		this.attached.delete(key);
	}
}

function send(res: Response, event: unknown) {
	res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Start a server-sent event stream. Browsers retry after 1 s; the ping is a real (named) event so
 * the client can notice a connection that silently died, e.g. after a phone switched networks.
 */
function openStream(req: Request, res: Response, onClose: () => void) {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});
	res.write("retry: 1000\n\n");
	const ping = setInterval(() => res.write("event: ping\ndata: {}\n\n"), 15_000);
	req.on("close", () => {
		clearInterval(ping);
		onClose();
	});
}

export function sessionRoutes(adapters: HarnessAdapter[]): Router {
	const router = express.Router();
	const hub = new Hub();
	const byId = new Map(adapters.map((a) => [a.id, a]));
	router.use(["/sessions", "/harnesses", "/notifications", "/tools", "/mcp"], requireAuth);

	const adapterOf = (id: string) => {
		const adapter = byId.get(id);
		if (!adapter) throw new HttpError(404, `Unknown harness ${id}`);
		return adapter;
	};

	const parseKey = (key: string) => {
		const index = key.indexOf(":");
		if (index < 0) throw new HttpError(400, "Bad session key");
		return { harness: key.slice(0, index), id: key.slice(index + 1) };
	};

	/** Resolve a session and the caller's access; 404 when the caller may not even know it exists. */
	const load = (req: Request) => {
		const key = String(req.params.key);
		const meta = store.session(key);
		const access = meta && !meta.deleted && accessOf(req.user!, meta);
		if (!meta || !access) throw new HttpError(404, "Session not found");
		return { key, meta, access, adapter: adapterOf(meta.harness) };
	};

	mountInteractions(router, load);

	const ensureLive = async (meta: SessionMeta, adapter: HarnessAdapter) => {
		const live = await adapter.open(meta.id, meta.cwd);
		hub.attach(meta.key, live);
		return live;
	};

	/** Start a session for `user` in `cwd` with their saved defaults unless overridden. */
	const createSession = async (
		user: User,
		input: { harness: string; cwd: string; name?: string; model?: { provider: string; id: string }; thinkingLevel?: string; visibility?: SessionMeta["visibility"]; shares?: SessionMeta["shares"] },
	) => {
		const adapter = adapterOf(input.harness);
		const live = await adapter.create(input.cwd, { ...creationOptions(input, user.sessionDefaults), name: input.name });
		const meta = store.upsertSession({
			key: `${adapter.id}:${live.id}`,
			harness: adapter.id,
			id: live.id,
			cwd: input.cwd,
			ownerId: user.id,
			name: input.name || undefined,
			visibility: input.visibility ?? "private",
			shares: (input.shares ?? []).filter((s) => s.userId !== user.id && store.userById(s.userId)),
		});
		hub.attach(meta.key, live);
		return meta;
	};

	/** Send a prompt as `user`, starting the runtime if needed; while a run is going it is queued as a follow-up unless a mode is given. */
	const promptSession = async (meta: SessionMeta, user: User, body: PromptInput) => {
		const live = await ensureLive(meta, adapterOf(meta.harness));
		const input = { ...body, mode: body.mode ?? (live.state.running ? ("followUp" as const) : undefined) };
		const current = store.session(meta.key)!;
		const ledger = current.authorship ??= { authors: {}, pending: [] };
		const promptId = registerPrompt(ledger, live.state.messages, input, { id: user.id, username: user.username });
		saveNow();
		try {
			await live.prompt(input);
		} catch (error) {
			ledger.pending = ledger.pending.filter((p) => p.id !== promptId);
			save();
			throw error;
		}
		store.upsertSession({ ...store.session(meta.key)!, firstMessage: current.firstMessage ?? firstLine(input.text), updatedAt: new Date().toISOString() });
		hub.broadcast(meta.key, { type: "notify", level: "info", text: `${user.username}: ${input.mode ?? "prompt"}`, author: user.username, silent: true });
	};

	/**
	 * Rewrite one message of a session whose agent is not running. An idle process is stopped
	 * first (pi rereads the edited history when the session continues); viewers get the new history.
	 * `pick` chooses the message from the stored history and its new text, or returns undefined to skip.
	 */
	const editSession = async (meta: SessionMeta, pick: (messages: AgentMessage[]) => { index: number; text: string; expect: string } | undefined) => {
		const adapter = adapterOf(meta.harness);
		if (!adapter.editMessage) throw new HttpError(400, `Messages of ${adapter.label} sessions cannot be edited`);
		const live = adapter.live(meta.id);
		if (live?.state.running) throw new HttpError(409, "Wait until the agent has finished before editing");
		const stored = await adapter.readSession(meta.id, meta.cwd);
		const target = stored && pick(stored.messages);
		if (!stored || !target) return false;
		const message = stored.messages[target.index];
		const content = replaceText(message.content, target.text, target.expect);
		if (content === undefined) throw new HttpError(409, "The message changed meanwhile; reload and try again");
		await live?.close();
		await adapter.editMessage(meta.id, meta.cwd, target.index, content);
		const messages = stored.messages.map((m, i) => (i === target.index ? { ...m, content } : m));
		const current = store.session(meta.key)!;
		if (current.authorship) rekeyAuthors(current.authorship, stored.messages, messages);
		if (message.role === "user" && stored.messages.findIndex((m) => m.role === "user") === target.index) current.firstMessage = firstLine(target.text);
		saveNow();
		const state: SessionState = { messages, partial: null, toolOutputs: {}, runningTools: [], running: false, queue: { steering: [], followUp: [] }, dialogs: [], live: false, name: current.name ?? stored.name };
		hub.broadcast(meta.key, { type: "state", state: hub.state(meta.key, state) });
		return true;
	};

	const summary = (meta: SessionMeta, user: User, listing?: SessionListing) => {
		const live = byId.get(meta.harness)?.live(meta.id);
		return {
			key: meta.key,
			harness: meta.harness,
			id: meta.id,
			path: toRel(meta.cwd),
			name: live?.state.name || meta.name || listing?.name,
			firstMessage: meta.firstMessage ?? listing?.firstMessage,
			createdAt: listing?.createdAt ?? meta.createdAt,
			updatedAt: live ? new Date(live.lastActivity).toISOString() : (listing?.updatedAt ?? meta.updatedAt ?? meta.createdAt),
			messageCount: live?.state.messages.length ?? listing?.messageCount ?? 0,
			live: Boolean(live),
			running: Boolean(live?.state.running),
			pinned: Boolean(meta.pinned),
			owner: meta.ownerId ? (store.userById(meta.ownerId)?.username ?? "unknown") : undefined,
			visibility: meta.visibility,
			shares: meta.shares.map((s) => ({ ...s, username: store.userById(s.userId)?.username ?? "unknown" })),
			access: accessOf(user, meta),
		};
	};

	/** Server-sent run outcomes for every session the caller is involved in. */
	router.get("/notifications", (req, res) => {
		openStream(req, res, hub.watch(req.user!, res));
	});

	router.get("/harnesses", async (_req, res) => {
		res.json({
			harnesses: await Promise.all(
				adapters.map(async (a) => ({ id: a.id, label: a.label, description: a.description, durable: a.durable, ...(await a.available()) })),
			),
		});
	});

	router.get("/harnesses/:id/models", async (req, res) => {
		res.json({ models: await adapterOf(String(req.params.id)).listModels() });
	});

	/** Sessions of one folder that `user` may see, running first, then most recent. */
	const folderSessions = async (cwd: string, user: User) => {
		const results = await Promise.all(
			adapters.map(async (adapter) => {
				if (!(await adapter.available()).ok) return [];
				const listings = await adapter.listSessions(cwd).catch(() => []);
				return listings.map((listing) => {
					// Sessions started outside the app get metadata without an owner: only admins see them until claimed.
					const meta = store.session(`${adapter.id}:${listing.id}`) ?? store.upsertSession({ key: `${adapter.id}:${listing.id}`, harness: adapter.id, id: listing.id, cwd });
					return { meta, listing };
				});
			}),
		);
		return results
			.flat()
			.filter(({ meta }) => !meta.deleted && accessOf(user, meta))
			.map(({ meta, listing }) => summary(meta, user, listing))
			.sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt));
	};

	router.get("/sessions", async (req, res) => {
		const cwd = resolveSafe(req.query.path);
		res.json({ path: toRel(cwd), sessions: await folderSessions(cwd, req.user!) });
	});

	/** Session counts of each subfolder, for the badges and accordions of the file explorer. */
	router.get("/sessions/counts", async (req, res) => {
		const cwd = resolveSafe(req.query.path);
		const dirs = (await fs.readdir(cwd, { withFileTypes: true }).catch(() => []))
			.filter((e) => e.isDirectory() && e.name !== "node_modules")
			.slice(0, 300);
		const counts: Record<string, { total: number; running: number }> = {};
		await Promise.all(
			dirs.map(async (dir) => {
				const sessions = await folderSessions(path.join(cwd, dir.name), req.user!);
				if (sessions.length) counts[toRel(path.join(cwd, dir.name))] = { total: sessions.length, running: sessions.filter((s) => s.running).length };
			}),
		);
		res.json({ counts });
	});

	/** Running sessions the caller can see, across all folders (for the "running" indicator). */
	router.get("/sessions/active", (req, res) => {
		const sessions = adapters
			.flatMap((a) => a.liveSessions().map((live) => store.session(`${a.id}:${live.id}`)))
			.filter((meta): meta is SessionMeta => Boolean(meta && !meta.deleted && accessOf(req.user!, meta)))
			.map((meta) => summary(meta, req.user!));
		res.json({ sessions });
	});

	/** The caller's most recently active sessions across all folders, for the home page. */
	router.get("/sessions/recent", (req, res) => {
		const limit = z.coerce.number().int().min(1).max(20).catch(3).parse(req.query.limit);
		const sessions = Object.values(store.data.sessions)
			// Unclaimed sessions are registered on first listing; without activity in the app they are not "recent".
			.filter((meta) => !meta.deleted && (meta.ownerId || meta.updatedAt) && accessOf(req.user!, meta))
			.map((meta) => summary(meta, req.user!))
			.sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, limit);
		res.json({ sessions });
	});

	const shareSchema = z.array(z.object({ userId: z.string(), access: z.enum(["read", "write"]) })).max(100);

	router.post("/sessions", async (req, res) => {
		const body = z
			.object({
				harness: z.string(),
				path: z.string(),
				name: z.string().max(120).optional(),
				model: z.object({ provider: z.string(), id: z.string() }).optional(),
				thinkingLevel: z.string().optional(),
				visibility: z.enum(["private", "shared"]).default("private"),
				shares: shareSchema.default([]),
			})
			.parse(req.body);
		const meta = await createSession(req.user!, { ...body, cwd: resolveSafe(body.path) });
		res.json({ session: summary(meta, req.user!) });
	});

	router.get("/sessions/:key", async (req, res) => {
		const { meta } = load(req);
		res.json({ session: summary(meta, req.user!) });
	});

	/** Server-sent events: full state first, then incremental updates. Viewing never starts a process. */
	router.get("/sessions/:key/events", async (req, res) => {
		const { key, meta, adapter } = load(req);
		openStream(req, res, () => hub.remove(key, res));
		hub.add(key, res);
		const live = adapter.live(meta.id);
		if (live && hub.isAttached(key, live)) send(res, { type: "state", state: hub.state(key, live.state) });
		else if (live) hub.attach(key, live);
		else {
			const stored = await adapter.readSession(meta.id, meta.cwd).catch(() => undefined);
			const state: SessionState = {
				messages: stored?.messages ?? [],
				partial: null,
				toolOutputs: {},
				runningTools: [],
				running: false,
				queue: { steering: [], followUp: [] },
				dialogs: [],
				live: false,
				name: meta.name ?? stored?.name,
			};
			send(res, { type: "state", state: hub.state(key, state) });
		}
	});

	/** Tools, commands and installed pi resources (extensions, skills, prompts, packages) of a session. */
	router.get("/sessions/:key/tools", async (req, res) => {
		const { meta, adapter } = load(req);
		const inventory = await adapter.inventory(meta.id, meta.cwd);
		res.json({ ...inventory, resources: adapter.id === "pi" ? piResources(meta.cwd) : [] });
	});

	/** What pi would have in a folder before any session exists (the home screen's composer). */
	router.get("/tools", (req, res) => {
		const cwd = resolveSafe(req.query.path);
		res.json({
			tools: ["read", "bash", "edit", "write"].map((name) => ({ name, origin: "built-in" })),
			toolsNote: "pi's default tools. A running session also lists its extension and MCP tools.",
			resources: piResources(cwd),
		});
	});

	router.get("/mcp", async (req, res) => {
		res.json(await mcpReport(resolveSafe(req.query.path), req.user!.role === "admin"));
	});

	/** MCP servers available to a session's agent. */
	router.get("/sessions/:key/mcp", async (req, res) => {
		const { meta, adapter } = load(req);
		if (adapter.id !== "pi") return void res.json({ servers: [], live: false, note: "pi durable has no MCP support; open a pi session to use MCP servers." });
		res.json(await mcpReport(meta.cwd, req.user!.role === "admin"));
	});

	const writable = (req: Request) => {
		const loaded = load(req);
		if (!canWrite(loaded.access)) throw new HttpError(403, "You have read-only access to this session");
		return loaded;
	};

	router.post("/sessions/:key/prompt", async (req, res) => {
		const { meta } = writable(req);
		const body = z
			.object({
				text: z.string().min(1).max(200_000),
				images: z.array(z.object({ data: z.string(), mimeType: z.string().regex(/^image\//) })).max(10).optional(),
				mode: z.enum(["steer", "followUp"]).optional(),
			})
			.parse(req.body);
		await promptSession(meta, req.user!, body);
		res.json({ ok: true });
	});

	/**
	 * Edit a prompt (only its author) or an answer (anyone who can write) while the agent is not running.
	 * The message is found by its position, or by its timestamp if the viewer's list differs from the file.
	 */
	router.post("/sessions/:key/messages/edit", async (req, res) => {
		const { meta } = writable(req);
		const body = z.object({ index: z.number().int().min(0), timestamp: z.number().optional(), expect: z.string(), text: z.string().trim().min(1).max(200_000) }).parse(req.body);
		const user = req.user!;
		await editSession(meta, (messages) => {
			const fits = (m: AgentMessage | undefined) => (m?.role === "user" || m?.role === "assistant") && replaceText(m.content, body.text, body.expect) !== undefined;
			let index = fits(messages[body.index]) ? body.index : -1;
			if (index < 0 && body.timestamp !== undefined) index = messages.findIndex((m) => m.timestamp === body.timestamp && fits(m));
			if (index < 0) throw new HttpError(409, "The message changed meanwhile; reload and try again");
			if (messages[index].role === "user") {
				const ledger = store.session(meta.key)?.authorship;
				const author = ledger && attributeMessages(ledger, messages)[index].author;
				if ((author as { id?: string } | undefined)?.id !== user.id) throw new HttpError(403, "You can only edit your own messages");
			}
			return { index, text: body.text, expect: body.expect };
		});
		res.json({ ok: true });
	});

	router.post("/sessions/:key/abort", async (req, res) => {
		const { meta, adapter } = writable(req);
		await adapter.live(meta.id)?.abort();
		res.json({ ok: true });
	});

	router.post("/sessions/:key/model", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ provider: z.string(), id: z.string() }).parse(req.body);
		await (await ensureLive(meta, adapter)).setModel(body.provider, body.id);
		res.json({ ok: true });
	});

	router.post("/sessions/:key/thinking", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ level: z.string() }).parse(req.body);
		await (await ensureLive(meta, adapter)).setThinkingLevel(body.level);
		res.json({ ok: true });
	});

	router.post("/sessions/:key/name", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ name: z.string().max(120) }).parse(req.body);
		meta.name = body.name.trim() || undefined;
		save();
		await adapter.live(meta.id)?.setName(body.name);
		res.json({ ok: true });
	});

	router.post("/sessions/:key/dialog", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ id: z.string(), value: z.string().optional(), confirmed: z.boolean().optional(), cancelled: z.boolean().optional() }).parse(req.body);
		const { id, ...answer } = body;
		adapter.live(meta.id)?.answerDialog(id, answer);
		res.json({ ok: true });
	});

	/** Pinned sessions keep their process even when idle (background work, long waits). */
	router.post("/sessions/:key/pin", async (req, res) => {
		const { meta } = writable(req);
		const body = z.object({ pinned: z.boolean() }).parse(req.body);
		const next = store.upsertSession({ ...meta, pinned: body.pinned });
		res.json({ session: summary(next, req.user!) });
	});

	router.post("/sessions/:key/stop", async (req, res) => {
		const { meta, adapter } = writable(req);
		await adapter.live(meta.id)?.close();
		res.json({ ok: true });
	});

	/** Owners and admins delete sessions; viewers are told so they can leave the page. */
	router.delete("/sessions/:key", async (req, res) => {
		const { key, meta, access, adapter } = load(req);
		if (!canManage(access)) throw new HttpError(403, "Only the owner or an admin can delete this session");
		const purged = await adapter.deleteSession(meta.id, meta.cwd);
		if (purged) store.removeSession(key);
		else {
			meta.deleted = true;
			delete meta.authorship;
		}
		saveNow();
		hub.broadcast(key, { type: "deleted", by: req.user!.username });
		res.json({ ok: true });
	});

	router.put("/sessions/:key/acl", async (req, res) => {
		const { meta, access } = load(req);
		if (!canManage(access)) throw new HttpError(403, "Only the owner or an admin can change sharing");
		const body = z.object({ visibility: z.enum(["private", "shared"]), shares: shareSchema }).parse(req.body);
		const shares = body.shares.filter((s) => s.userId !== meta.ownerId && store.userById(s.userId));
		const next = store.upsertSession({ ...meta, visibility: body.visibility, shares });
		res.json({ session: summary(next, req.user!) });
	});

	/** Admins adopt sessions that were started outside the app, or reassign ownership. */
	router.post("/sessions/:key/owner", async (req, res) => {
		const { meta } = load(req);
		if (req.user!.role !== "admin") throw new HttpError(403, "Admins only");
		const body = z.object({ userId: z.string() }).parse(req.body);
		if (!store.userById(body.userId)) throw new HttpError(400, "No such user");
		const next = store.upsertSession({ ...meta, ownerId: body.userId, shares: meta.shares.filter((s) => s.userId !== body.userId) });
		res.json({ session: summary(next, req.user!) });
	});

	const harnessFor = async (user: User) => {
		const preferred = user.sessionDefaults?.harness;
		for (const adapter of [...(preferred && byId.has(preferred) ? [byId.get(preferred)!] : []), ...adapters]) {
			if ((await adapter.available()).ok) return adapter.id;
		}
		throw new HttpError(503, "No agent harness is available");
	};
	const chatDeps = {
		createSession,
		promptSession,
		harnessFor,
		sendTo: (userId: string, event: unknown) => hub.sendTo(userId, event),
		onRun: (listener: Parameters<Hub["onRun"]>[0]) => void hub.onRun(listener),
		setQuiet: (quiet: (key: string) => boolean) => void (hub.quiet = quiet),
		sessionSummary: (meta: SessionMeta, user: User) => summary(meta, user),
		editSession,
		readMessages: async (meta: SessionMeta) => (await adapterOf(meta.harness).readSession(meta.id, meta.cwd))?.messages ?? [],
	};
	mountChats(router, chatDeps);
	mountMemory(router, chatDeps);

	// Observe every live runtime, including runs resumed at startup that nobody has opened yet.
	setInterval(() => {
		for (const adapter of adapters) for (const live of adapter.liveSessions()) hub.attach(`${adapter.id}:${live.id}`, live);
	}, 5_000).unref();

	// Stop idle runtimes: not running, nobody watching, not pinned, quiet for IDLE_TIMEOUT_MIN.
	setInterval(() => {
		const cutoff = Date.now() - config.idleTimeoutMin * 60_000;
		for (const adapter of adapters) {
			for (const live of adapter.liveSessions()) {
				const key = `${adapter.id}:${live.id}`;
				if (live.state.running || hub.count(key) > 0 || store.session(key)?.pinned || live.lastActivity > cutoff) continue;
				void live.close();
			}
		}
	}, 60_000).unref();

	return router;
}
