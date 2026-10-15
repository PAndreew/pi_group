import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { attributeMessages, registerPrompt } from "./authorship.js";
import { config } from "./config.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import type { HarnessAdapter, LiveSession, SessionEvent, SessionListing, SessionState } from "./harness/types.js";
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

export function sessionRoutes(adapters: HarnessAdapter[]): Router {
	const router = express.Router();
	const hub = new Hub();
	const byId = new Map(adapters.map((a) => [a.id, a]));
	router.use(["/sessions", "/harnesses"], requireAuth);

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
		const access = meta && accessOf(req.user!, meta);
		if (!meta || !access) throw new HttpError(404, "Session not found");
		return { key, meta, access, adapter: adapterOf(meta.harness) };
	};

	const ensureLive = async (meta: SessionMeta, adapter: HarnessAdapter) => {
		const live = await adapter.open(meta.id, meta.cwd);
		hub.attach(meta.key, live);
		return live;
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

	router.get("/sessions", async (req, res) => {
		const cwd = resolveSafe(req.query.path);
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
		const sessions = results
			.flat()
			.filter(({ meta }) => accessOf(req.user!, meta))
			.map(({ meta, listing }) => summary(meta, req.user!, listing))
			.sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt));
		res.json({ path: toRel(cwd), sessions });
	});

	/** Running sessions the caller can see, across all folders (for the "running" indicator). */
	router.get("/sessions/active", (req, res) => {
		const sessions = adapters
			.flatMap((a) => a.liveSessions().map((live) => store.session(`${a.id}:${live.id}`)))
			.filter((meta): meta is SessionMeta => Boolean(meta && accessOf(req.user!, meta)))
			.map((meta) => summary(meta, req.user!));
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
		const adapter = adapterOf(body.harness);
		const cwd = resolveSafe(body.path);
		const live = await adapter.create(cwd, { model: body.model, thinkingLevel: body.thinkingLevel, name: body.name });
		const meta = store.upsertSession({
			key: `${adapter.id}:${live.id}`,
			harness: adapter.id,
			id: live.id,
			cwd,
			ownerId: req.user!.id,
			name: body.name || undefined,
			visibility: body.visibility,
			shares: body.shares.filter((s) => s.userId !== req.user!.id && store.userById(s.userId)),
		});
		hub.attach(meta.key, live);
		res.json({ session: summary(meta, req.user!) });
	});

	router.get("/sessions/:key", async (req, res) => {
		const { meta } = load(req);
		res.json({ session: summary(meta, req.user!) });
	});

	/** Server-sent events: full state first, then incremental updates. Viewing never starts a process. */
	router.get("/sessions/:key/events", async (req, res) => {
		const { key, meta, adapter } = load(req);
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write("retry: 3000\n\n");
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
		const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
		req.on("close", () => {
			clearInterval(ping);
			hub.remove(key, res);
		});
	});

	const writable = (req: Request) => {
		const loaded = load(req);
		if (!canWrite(loaded.access)) throw new HttpError(403, "You have read-only access to this session");
		return loaded;
	};

	router.post("/sessions/:key/prompt", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z
			.object({
				text: z.string().min(1).max(200_000),
				images: z.array(z.object({ data: z.string(), mimeType: z.string().regex(/^image\//) })).max(10).optional(),
				mode: z.enum(["steer", "followUp"]).optional(),
			})
			.parse(req.body);
		const live = await ensureLive(meta, adapter);
		const current = store.session(meta.key)!;
		const ledger = current.authorship ??= { authors: {}, pending: [] };
		const promptId = registerPrompt(ledger, live.state.messages, body, { id: req.user!.id, username: req.user!.username });
		saveNow();
		try {
			await live.prompt(body);
		} catch (error) {
			ledger.pending = ledger.pending.filter((p) => p.id !== promptId);
			save();
			throw error;
		}
		store.upsertSession({ ...store.session(meta.key)!, firstMessage: current.firstMessage ?? firstLine(body.text), updatedAt: new Date().toISOString() });
		hub.broadcast(meta.key, { type: "notify", level: "info", text: `${req.user!.username}: ${body.mode ?? "prompt"}`, author: req.user!.username, silent: true });
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
