import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "./auth.js";
import { generateSessionTitle } from "./session-title.js";
import { gitStatus } from "./git-status.js";
import { creationOptions } from "./preferences.js";
import { availablePreferredModel, piProfile } from "./pi-profiles.js";
import { lithosVaultProfile } from "./lithos-vault.js";
import { getChat, mountChats } from "./chats.js";
import { mcpReport, piResources } from "./inventory.js";
import { mountInteractions, withNewSessionOwner } from "./interactions.js";
import { mountJobs } from "./jobs.js";
import { mountWatches } from "./watches.js";
import { mountApplets } from "./applets.js";
import { checkProject, mountProjects, projectIdOf } from "./projects.js";
import { isConsolidating, mountMemory, noteSessionActivity, projectMemory } from "./memory.js";
import { mountLinks } from "./links.js";
import { lastMemoryAt, wrapProjectMemory } from "../extensions/lib/context-policy.mjs";
import { remoteMachinesNote } from "./remote-machines.js";
import { platform } from "./ports/index.js";
import { pushToUser } from "./push.js";
import { attributeMessages, dropAuthor, registerPrompt, rekeyAuthors } from "./authorship.js";
import { config } from "./config.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import { contentText, replaceText } from "./harness/live-base.js";
import type { AgentMessage, HarnessAdapter, LiveSession, PromptInput, SessionEvent, SessionListing, SessionState } from "./harness/types.js";
import { type Access, type PendingDelete, type SessionMeta, save, saveNow, store, type User } from "./store.js";

import { tenantAccess, isTenantMember, tenantOf } from "./tenants.js";
import { currentTenant, inTenant, tenantId } from "./tenant-context.js";

export type EffectiveAccess = "admin" | "owner" | Access;

export function accessOf(user: User, meta: SessionMeta): EffectiveAccess | undefined {
	if (!tenantAccess(user, meta)) return undefined;
	if (meta.ownerId === user.id) return "owner";
	if (user.role === "admin") return "admin";
	if (meta.visibility === "shared") return meta.shares.find((s) => s.userId === user.id)?.access;
	return undefined;
}

const canWrite = (a?: EffectiveAccess) => a === "admin" || a === "owner" || a === "write";
const canManage = (a?: EffectiveAccess) => a === "admin" || a === "owner";

/** Users who hear about a session's runs: the owner, people it is shared with, and anyone who prompted it. */
const editTools = new Set(["write", "write_file", "edit", "multiedit"]);
/** The last existing file inside the root that a write/edit tool call touched, root-relative. */
export function lastEditedFile(messages: AgentMessage[], cwd: string) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const content = (messages[i]?.role === "assistant" && Array.isArray(messages[i].content) ? messages[i].content : []) as { type?: string; name?: string; arguments?: Record<string, unknown> }[];
		for (let j = content.length - 1; j >= 0; j--) {
			const block = content[j];
			if (block?.type !== "toolCall" || !editTools.has(String(block.name).toLowerCase())) continue;
			const target = block.arguments?.path ?? block.arguments?.file_path ?? block.arguments?.filePath;
			if (typeof target !== "string") continue;
			const rel = toRel(path.resolve(cwd, target));
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel) && existsSync(path.resolve(cwd, target))) return rel;
		}
	}
	return undefined;
}

export function involved(user: User, meta: SessionMeta) {
	if (meta.deleted || !accessOf(user, meta)) return false;
	if (meta.ownerId === user.id || (meta.visibility === "shared" && meta.shares.some((s) => s.userId === user.id))) return true;
	const ledger = meta.authorship;
	return Boolean(ledger && (Object.values(ledger.authors).some((a) => a.id === user.id) || ledger.pending.some((p) => p.author.id === user.id)));
}

const MEMORY_REPEAT_MS = 24 * 3_600_000;

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

/** A message rewrite: new text replacing `expect`, or removal. */
export type Rewrite = { index: number; expect: string; text: string } | { index: number; expect: string; remove: true };

const messageText = (m: AgentMessage) => contentText(m.content) || (typeof m.content === "string" ? m.content : "");

const firstLine = (text: string) => text.trim().split("\n")[0].slice(0, 200);

/** An event on a user's stream, delivered to their streams that have `tenantId` selected. */
type UserEnvelope = { tenantId: string; event: unknown };

/** Fans one live session's events out to every SSE client watching it. */
class Hub {
	/** Each viewer's subscription, to end it when the viewer leaves. */
	private viewers = new Map<Response, () => void>();

	state(key: string, state: SessionState): SessionState {
		const pendingDeletes = this.pendingDeletes(key);
		const ledger = store.session(key)?.authorship;
		if (!ledger) return { ...state, pendingDeletes };
		const pendingCount = ledger.pending.length;
		const messages = attributeMessages(ledger, state.messages);
		if (ledger.pending.length !== pendingCount) saveNow();
		return { ...state, messages, pendingDeletes };
	}

	/** Prompts waiting to be deleted when the run ends, for viewers to mark. */
	pendingDeletes(key: string) {
		return store.session(key)?.pendingDeletes?.flatMap((d) => (d.expect !== undefined ? [{ timestamp: d.timestamp, text: d.expect }] : [])) ?? [];
	}
	private attached = new Map<string, { live: LiveSession; unsubscribe: () => void }>();
	private running = new Map<string, boolean>();
	private runListeners = new Set<(key: string, outcome: RunOutcome) => void>();
	/** Sessions whose outcomes are reported elsewhere (a chat posts pi's reply), so no run notification. */
	quiet: (key: string) => boolean = () => false;

	/** Called when a run ends, including aborted and stopped ones. */
	onRun(listener: (key: string, outcome: RunOutcome) => void) {
		this.runListeners.add(listener);
		return () => this.runListeners.delete(listener);
	}

	/** Send an event on one user's stream (every open tab or device that has its tenant selected). */
	sendTo(userId: string, event: unknown) {
		const id = (event as { tenantId?: string })?.tenantId ?? tenantId();
		if (isTenantMember(userId, id)) this.toUser(userId, id, event);
	}

	private toUser(userId: string, tenant: string, event: unknown) {
		platform().realtime.publish(`user:${userId}`, { tenantId: tenant, event } satisfies UserEnvelope);
	}

	private finish(key: string, outcome: RunOutcome) {
		for (const listener of this.runListeners) listener(key, outcome);
		if (outcome.kind !== "aborted" && !this.quiet(key)) this.announce(key, outcome.kind, outcome.text);
	}

	/** Per-user stream of run outcomes (finished / failed) for browser notifications. */
	watch(user: User, res: Response) {
		const selected = tenantId();
		return platform().realtime.subscribe(`user:${user.id}`, (message) => {
			const { tenantId: tenant, event } = message as UserEnvelope;
			if (tenant === selected) send(res, event);
		});
	}

	private announce(key: string, kind: RunNotice["kind"], text: string) {
		const meta = store.session(key);
		if (!meta) return;
		const notice: RunNotice = { type: "run", kind, key, path: toRel(meta.cwd), name: meta.name || meta.firstMessage || "Untitled session", text: plainText(text).slice(0, 300) };
		// Current roles and sharing decide, not those when a stream opened. Push reaches devices whose
		// app is closed or frozen; the service worker skips it when the app is in front.
		for (const user of store.data.users) {
			if (!involved(user, meta)) continue;
			this.toUser(user.id, meta.tenantId ?? "work", notice);
			void pushToUser(user.id, { ...notice, tenantId: meta.tenantId ?? "work" });
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
		return platform().realtime.subscribers(key);
	}

	add(key: string, res: Response) {
		this.viewers.get(res)?.();
		this.viewers.set(res, platform().realtime.subscribe(key, (event) => send(res, event)));
	}

	remove(_key: string, res: Response) {
		this.viewers.get(res)?.();
		this.viewers.delete(res);
	}

	broadcast(key: string, event: SessionEvent | { type: string; [k: string]: unknown }) {
		platform().realtime.publish(key, event);
	}

	/** Relay a live session's events; the subscription itself delivers the current state first. */
	attach(key: string, live: LiveSession) {
		const current = this.attached.get(key);
		if (current?.live === live) return;
		current?.unsubscribe();
		if (!this.running.has(key)) this.running.set(key, live.state.running);
		const relay = (event: SessionEvent) => {
			this.observe(key, live, event);
			if (event.type === "state") this.broadcast(key, { ...event, state: this.state(key, event.state) });
			else if (event.type === "message") {
				const state = this.state(key, live.state);
				this.broadcast(key, { ...event, message: state.messages.at(-1) ?? event.message });
			} else this.broadcast(key, event);
			if (event.type === "state" && !event.state.live) this.detach(key, live);
		};
		const unsubscribe = live.subscribe(event => {
			const tenant = tenantOf(store.session(key)?.tenantId ?? "work");
			if (tenant) inTenant(tenant, () => relay(event));
			else relay(event);
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
	const deleting = new Set<string>();
	const loadSession = (key: string, user: User) => {
		const meta = store.session(key);
		const access = meta && !meta.deleted && accessOf(user, meta);
		if (!meta || !access) throw new HttpError(404, "Session not found");
		if (deleting.has(key)) throw new HttpError(409, "This session is being deleted");
		return { key, meta, access, adapter: adapterOf(meta.harness) };
	};
	const load = (req: Request) => loadSession(String(req.params.key), req.user!);

	mountInteractions(router, load);

	const ensureLive = async (meta: SessionMeta, adapter: HarnessAdapter) => {
		const live = await adapter.open(meta.id, meta.cwd);
		hub.attach(meta.key, live);
		return live;
	};

	const pickedModels = new Map<string, { provider: string; id: string }>();
	const modelPickKey = (meta: SessionMeta, user: User) => JSON.stringify([tenantId(), meta.key, user.id]);

	/** Start a session for `user` in `cwd` with their saved defaults unless overridden. */
	const createSession = async (
		user: User,
		input: { harness: string; cwd: string; name?: string; model?: { provider: string; id: string }; thinkingLevel?: string; visibility?: SessionMeta["visibility"]; shares?: SessionMeta["shares"]; projectId?: string },
	) => {
		if (!isTenantMember(user.id)) throw new HttpError(403, "Tenant unavailable");
		resolveSafe(toRel(input.cwd));
		const adapter = adapterOf(input.harness);
		const explicit = adapter.id === "pi" ? input.model : undefined;
		const usesLithos = explicit?.provider === "lithosai";
		const profile = usesLithos ? await lithosVaultProfile(user.id) : await piProfile(user.id);
		if (usesLithos && !profile) throw new HttpError(400, "Add LITHOS_Key to your Personal vault to use LithosAI");
		if (profile && adapter.id !== "pi") throw new HttpError(400, "Personal Pi profiles require the Pi RPC runtime");
		if (explicit && !availablePreferredModel(await adapter.listModels(profile), explicit)) throw new HttpError(400, "This model is not available to your account");
		const live = await withNewSessionOwner(user.id, tenantId(), () => adapter.create(input.cwd, {
			...(profile && !explicit ? {} : creationOptions(input, user.sessionDefaults)), name: input.name, authProfile: profile,
		}));
		const meta = store.upsertSession({
			key: `${adapter.id}:${live.id}`,
			harness: adapter.id,
			id: live.id,
			cwd: input.cwd,
			ownerId: user.id,
			name: input.name || undefined,
			projectId: input.projectId,
			visibility: input.visibility ?? "private",
			shares: (input.shares ?? []).filter((s) => s.userId !== user.id && isTenantMember(s.userId)),
		});
		if (explicit) pickedModels.set(modelPickKey(meta, user), explicit);
		hub.attach(meta.key, live);
		return meta;
	};

	const titleSession = async (meta: SessionMeta, user: User, firstPrompt?: { text: string; authProfile?: string }) => {
		const adapter = adapterOf(meta.harness);
		const live = adapter.live(meta.id);
		const previous = meta.name;
		const state = live?.state ?? await adapter.readSession(meta.id, meta.cwd);
		if (!state?.model) throw new HttpError(400, "Select a model before generating a title");
		const text = firstPrompt?.text ?? state.messages.filter(m => m.role === "user" || m.role === "assistant").map(m => `${m.role}: ${messageText(m)}`).join("\n");
		if (!text) throw new HttpError(400, "Session has no messages");
		// Automatic titles use the same credentials as the accepted turn. Manual titles never borrow another user's profile.
		const authProfile = firstPrompt ? firstPrompt.authProfile : meta.harness !== "pi" ? undefined : state.model.provider === "lithosai" ? await lithosVaultProfile(user.id) : await piProfile(user.id);
		if (!firstPrompt && !authProfile && (live?.authProfile || state.model.provider === "lithosai")) throw new HttpError(400, "Connect your own Pi profile to generate a title for this model");
		const name = await generateSessionTitle(state.model, text, authProfile);
		const current = store.session(meta.key);
		if (!current || current.deleted) throw new HttpError(404, "Session unavailable");
		if (current.name !== previous) return current.name ?? "";
		current.name = name;
		save();
		chats.titleChanged(meta.key);
		await adapter.live(meta.id)?.setName(name);
		return name;
	};

	const sharedFallback = () => store.data.sharedPiFallbacks?.[tenantId()];
	router.get("/harnesses/pi/shared-fallback", (_req, res) => res.json({ model: sharedFallback() ?? null }));
	router.get("/harnesses/pi/shared-models", requireAdmin, async (_req, res) => res.json({ models: await adapterOf("pi").listModels() }));
	router.put("/harnesses/pi/shared-fallback", requireAdmin, async (req, res) => {
		const { model } = z.object({ model: z.object({ provider: z.string().max(120), id: z.string().max(200) }).nullable() }).parse(req.body);
		if (model && !availablePreferredModel(await adapterOf("pi").listModels(), model)) throw new HttpError(400, "Choose a model available to the server’s Pi login");
		store.data.sharedPiFallbacks ??= {};
		if (model) store.data.sharedPiFallbacks[tenantId()] = model;
		else delete store.data.sharedPiFallbacks[tenantId()];
		saveNow();
		res.json({ model });
	});

	/** When this runtime last got project memory (also before the prompt shows up in its messages). */
	const loadedMemory = new WeakMap<object, number>();
	/** `background` prompts (memory updates) neither title the session nor move it up the list. */
	const submitPrompt = async (meta: SessionMeta, user: User, { fromBrowser, ...body }: PromptInput & { fromBrowser?: boolean }, options: { background?: boolean } = {}) => {
		if (!canWrite(accessOf(user, meta))) throw new HttpError(403, "Session unavailable in this tenant");
		const adapter = adapterOf(meta.harness);
		const picked = meta.harness === "pi" ? pickedModels.get(modelPickKey(meta, user)) : undefined;
		const wantsLithos = meta.harness === "pi" && (picked ?? (user.sessionDefaults?.harness === "pi" ? user.sessionDefaults.model : undefined))?.provider === "lithosai";
		const lithos = wantsLithos ? await lithosVaultProfile(user.id) : undefined;
		if (wantsLithos && !lithos) throw new HttpError(400, "Add LITHOS_Key to your Personal vault to use LithosAI");
		const profile = lithos ?? await piProfile(user.id);
		if (profile && meta.harness !== "pi") throw new HttpError(400, "Personal Pi profiles require the Pi RPC runtime");
		const active = adapter.live(meta.id);
		if (active?.state.running && (active.authProfile !== profile || profile)) throw new HttpError(409, "Wait for the active Pi run to finish");
		const defaults = user.sessionDefaults;
		let selectedModel: { provider: string; id: string } | undefined;
		let useShared = false;
		if (picked && body.mode !== "steer") {
			if (active?.state.running) throw new HttpError(409, "Wait for the active Pi run to finish");
			selectedModel = picked;
		} else if ((profile || defaults?.useModelPerMessage) && defaults?.harness === meta.harness && body.mode !== "steer") {
			if (active?.state.running) throw new HttpError(409, "Wait for the active Pi run to finish");
			const available = await adapter.listModels(profile);
			selectedModel = availablePreferredModel(available, defaults.model, defaults.fallbackModel);
			const fallback = profile && sharedFallback();
			if (!selectedModel && fallback) {
				selectedModel = availablePreferredModel(await adapter.listModels(), fallback);
				useShared = !!selectedModel;
			}
			if (!selectedModel) throw new HttpError(400, "Neither your preferred model nor a configured fallback is available.");
		} else if (profile) throw new HttpError(400, "Save your Pi RPC model defaults before sending with your profile");
		const live = await adapter.open(meta.id, meta.cwd, useShared ? null : profile ?? null);
		hub.attach(meta.key, live);
		if (meta.archivedAt) throw new HttpError(409, "Restore this archived session before sending messages");
		// Project memory goes in front of a prompt at most once per rolling 24 hours, so it does not pile up in the context.
		const memory = meta.memory || options.background ? "" : projectMemory(meta, user);
		const lastInjected = Math.max(lastMemoryAt(live.state.messages) || 0, loadedMemory.get(live) ?? 0);
		const injectMemory = Boolean(memory && Date.now() - lastInjected > MEMORY_REPEAT_MS);
		// #name mentions of remote machines get a note on how to reach them, hidden in the web like memory.
		const machines = options.background ? "" : remoteMachinesNote(body.text);
		const input = { ...body, text: (injectMemory ? wrapProjectMemory(memory) : "") + body.text + machines, mode: body.mode ?? (live.state.running ? ("followUp" as const) : undefined) };
		const current = store.session(meta.key)!;
		const ledger = current.authorship ??= { authors: {}, pending: [] };
		const autoTitle = !options.background && user.sessionDefaults?.autoTitle === true && !current.firstMessage && !current.name;
		const promptId = registerPrompt(ledger, live.state.messages, input, { id: user.id, username: user.username }, fromBrowser);
		saveNow();
		try {
			if (selectedModel && (live.state.model?.provider !== selectedModel.provider || live.state.model?.id !== selectedModel.id)) await live.setModel(selectedModel.provider, selectedModel.id);
			await live.prompt(input);
			if (useShared) hub.broadcast(meta.key, { type: "notify", level: "info", text: `Using workspace fallback: ${selectedModel!.provider}/${selectedModel!.id}` });
			if (injectMemory) loadedMemory.set(live, Date.now());
		} catch (error) {
			ledger.pending = ledger.pending.filter((p) => p.id !== promptId);
			save();
			throw error;
		}
		if (!options.background) store.upsertSession({ ...store.session(meta.key)!, firstMessage: current.firstMessage ?? firstLine(body.text), updatedAt: new Date().toISOString() });
		noteSessionActivity(meta.key, body.text);
		if (autoTitle) void titleSession(store.session(meta.key)!, user, { text: body.text, authProfile: live.authProfile }).catch(error => console.error("Auto title generation failed:", error));
		hub.broadcast(meta.key, { type: "notify", level: "info", text: `${user.username}: ${input.mode ?? "prompt"}`, author: user.username, silent: true });
	};

	// Serialize admission (including asynchronous model checks), otherwise two shared
	// submissions could replace one another's initiating user/settings before acceptance.
	const submissions = new Map<string, Promise<void>>();
	const serializeSessionChange = (meta: SessionMeta, action: () => Promise<void>) => {
		const prior = submissions.get(meta.key) ?? Promise.resolve();
		const next = prior.catch(() => {}).then(action);
		submissions.set(meta.key, next);
		void next.finally(() => { if (submissions.get(meta.key) === next) submissions.delete(meta.key); }).catch(() => {});
		return next;
	};

	const promptSession = (meta: SessionMeta, user: User, body: PromptInput & { fromBrowser?: boolean }, options?: { background?: boolean }) => {
		if (deleting.has(meta.key)) return Promise.reject(new HttpError(409, "This session is being deleted"));
		return serializeSessionChange(meta, () => submitPrompt(meta, user, body, options));
	};

	const isRunning = (key?: string) => {
		const meta = key ? store.session(key) : undefined;
		return Boolean(meta && byId.get(meta.harness)?.live(meta.id)?.state.running);
	};

	/** Set once the chat routes are mounted below. */
	let chats: ReturnType<typeof mountChats>;
	/** Where a shared message comes from or goes to: a session, or a chat with people (and maybe pi). */
	type ShareRef = { kind: "session" | "chat"; id: string };
	const busy = (ref?: ShareRef) => (ref?.kind === "chat" ? chats.busy(ref.id) : isRunning(ref?.id));
	const sameRef = (a?: ShareRef, b?: ShareRef) => Boolean(a && b && a.kind === b.kind && a.id === b.id);

	/** Messages shared elsewhere, waiting until neither their source nor their target agent is running. */
	const forwards: { from?: ShareRef; to: ShareRef; userId: string; text: string; tenantId: string }[] = [];
	let delivering = false;
	const deliverForwards = async () => {
		if (delivering) return;
		delivering = true;
		try {
			// One per session and pass: a delivered prompt starts a run, and the next one waits for it.
			const started = new Set<string>();
			for (const item of [...forwards]) {
				if (started.has(item.to.id) || busy(item.from) || busy(item.to)) continue;
				forwards.splice(forwards.indexOf(item), 1);
				const user = store.userById(item.userId);
				if (!user) continue;
				const tenant = tenantOf(item.tenantId);
				const deliver = async () => {
					if (item.to.kind === "chat") {
						if (chats.isMember(item.to.id, user)) chats.post(item.to.id, user, item.text);
						return;
					}
					const meta = store.session(item.to.id);
					if (!meta || meta.deleted || !canWrite(accessOf(user, meta))) return;
					started.add(item.to.id);
					await promptSession(meta, user, { text: item.text }).catch((error) => console.error(`Sharing into ${item.to.id} failed:`, error));
				};
				if (tenant) await inTenant(tenant, deliver);
			}
		} finally {
			delivering = false;
		}
	};
	// After the other run listeners: a chat marks pi's reply done in its own listener.
	hub.onRun(() => void setTimeout(() => void deliverForwards(), 0));

	/**
	 * Rewrite or remove one message of a session whose agent is not running. An idle process is stopped
	 * first (pi rereads the edited history when the session continues); viewers get the new history.
	 * `pick` chooses the message from the stored history and its new text (or `remove`), or returns undefined to skip.
	 */
	const editSession = async (meta: SessionMeta, pick: (messages: AgentMessage[]) => Rewrite | undefined) => {
		const adapter = adapterOf(meta.harness);
		const running = () => Boolean(adapter.live(meta.id)?.state.running);
		if (running()) throw new HttpError(409, "Wait until the agent has finished before editing");
		const stored = await adapter.readSession(meta.id, meta.cwd);
		const target = stored && pick(stored.messages);
		if (!stored || !target) return false;
		if (!("remove" in target ? adapter.deleteMessage : adapter.editMessage)) throw new HttpError(400, `Messages of ${adapter.label} sessions cannot be changed`);
		const message = stored.messages[target.index];
		const content = "remove" in target ? undefined : replaceText(message.content, target.text, target.expect);
		if (!("remove" in target) && content === undefined) throw new HttpError(409, "The message changed meanwhile; reload and try again");
		// A run may have started while the history was read.
		if (running()) throw new HttpError(409, "Wait until the agent has finished before editing");
		await adapter.live(meta.id)?.close();
		const current = store.session(meta.key)!;
		let messages: AgentMessage[];
		if ("remove" in target) {
			await adapter.deleteMessage!(meta.id, meta.cwd, target.index);
			messages = stored.messages.filter((_, i) => i !== target.index);
			if (current.authorship) dropAuthor(current.authorship, stored.messages, target.index);
		} else {
			await adapter.editMessage!(meta.id, meta.cwd, target.index, content);
			messages = stored.messages.map((m, i) => (i === target.index ? { ...m, content } : m));
			if (current.authorship) rekeyAuthors(current.authorship, stored.messages, messages);
		}
		if (message.role === "user" && stored.messages.findIndex((m) => m.role === "user") === target.index) {
			const firstUser = messages.find((m) => m.role === "user");
			current.firstMessage = firstUser ? firstLine(messageText(firstUser)) : undefined;
		}
		saveNow();
		const state: SessionState = { messages, partial: null, toolOutputs: {}, runningTools: [], running: false, queue: { steering: [], followUp: [] }, dialogs: [], live: false, name: current.name ?? stored.name };
		hub.broadcast(meta.key, { type: "state", state: hub.state(meta.key, state) });
		return true;
	};

	/**
	 * Remove the last turn whose prompt contains `marker`: the prompt and everything the agent did for it, up to
	 * the next prompt. False when the agent is running (try again later); harnesses that cannot delete keep it.
	 */
	const dropTurn = async (meta: SessionMeta, marker: string) => {
		const adapter = adapterOf(meta.harness);
		if (!adapter.deleteMessage) return true;
		if (adapter.live(meta.id)?.state.running) return false;
		const stored = await adapter.readSession(meta.id, meta.cwd);
		if (!stored) return false;
		const start = stored.messages.findLastIndex((m) => m.role === "user" && messageText(m).includes(marker));
		if (start < 0) return true;
		let end = stored.messages.findIndex((m, i) => i > start && m.role === "user");
		if (end < 0) end = stored.messages.length;
		if (adapter.live(meta.id)?.state.running) return false;
		await adapter.live(meta.id)?.close();
		for (let i = end - 1; i >= start; i--) await adapter.deleteMessage(meta.id, meta.cwd, i);
		const current = store.session(meta.key)!;
		const messages = stored.messages.filter((_, i) => i < start || i >= end);
		let remaining = stored.messages;
		for (let i = end - 1; i >= start; i--) {
			if (current.authorship) dropAuthor(current.authorship, remaining, i);
			remaining = remaining.filter((_, j) => j !== i);
		}
		saveNow();
		const state: SessionState = { messages, partial: null, toolOutputs: {}, runningTools: [], running: false, queue: { steering: [], followUp: [] }, dialogs: [], live: false, name: current.name ?? stored.name };
		hub.broadcast(meta.key, { type: "state", state: hub.state(meta.key, state) });
		return true;
	};

	/** The prompt a deletion means, checked against `messages`: the caller's own, at its index or else its timestamp. */
	const locatePrompt = (meta: SessionMeta, messages: AgentMessage[], request: Omit<PendingDelete, "id">) => {
		const fits = (m: AgentMessage | undefined) => m?.role === "user" && messageText(m) === request.expect;
		let index = request.index !== undefined && fits(messages[request.index]) ? request.index : -1;
		if (index < 0 && request.timestamp !== undefined) index = messages.findIndex((m) => m.timestamp === request.timestamp && fits(m));
		if (index < 0) throw new HttpError(409, "The message changed meanwhile; reload and try again");
		const ledger = store.session(meta.key)?.authorship;
		const author = ledger && (attributeMessages(ledger, messages)[index].author as { id?: string } | undefined);
		if (author?.id !== request.userId) throw new HttpError(403, "You can only delete your own messages");
		return index;
	};

	/** A chat message inside pi's transcript prompts: cut its "author: text" block, or the whole prompt when nothing else is left. */
	const locateTranscript = (messages: AgentMessage[], needle: string, nth: number): Rewrite | undefined => {
		let seen = 0;
		for (const [index, m] of messages.entries()) {
			if (m.role !== "user") continue;
			const expect = messageText(m);
			for (let at = expect.indexOf(needle); at >= 0; at = expect.indexOf(needle, at + needle.length)) {
				if (seen++ !== nth) continue;
				const text = `${expect.slice(0, at).replace(/\n+$/, "")}\n\n${expect.slice(at + needle.length).replace(/^\n+/, "")}`.trim();
				return text ? { index, expect, text } : { index, expect, remove: true };
			}
		}
		return undefined;
	};

	const applyDelete = (meta: SessionMeta, request: Omit<PendingDelete, "id">) =>
		editSession(meta, (messages) => {
			if (request.needle !== undefined) return locateTranscript(messages, request.needle, request.nth ?? 0);
			return { index: locatePrompt(meta, messages, request), expect: request.expect ?? "", remove: true };
		});

	/** Delete now, or once the run ends when the agent is busy. Resolves true when queued. */
	const deleteFromSession = async (meta: SessionMeta, request: Omit<PendingDelete, "id">) => {
		const adapter = adapterOf(meta.harness);
		if (!adapter.deleteMessage) throw new HttpError(400, `Messages of ${adapter.label} sessions cannot be deleted`);
		const live = adapter.live(meta.id);
		if (!live?.state.running) {
			await applyDelete(meta, request);
			return false;
		}
		const current = store.session(meta.key)!;
		(current.pendingDeletes ??= []).push({ id: randomUUID(), ...request });
		saveNow();
		hub.broadcast(meta.key, { type: "pending_deletes", pendingDeletes: hub.pendingDeletes(meta.key) });
		return true;
	};

	/** Apply an idle session's queued deletions in order; one blocked by a new run waits for the next pass. */
	const draining = new Set<string>();
	const drainDeletes = async (key: string) => {
		if (draining.has(key) || isRunning(key) || !store.session(key)?.pendingDeletes?.length) return;
		draining.add(key);
		try {
			for (let next = store.session(key)?.pendingDeletes?.[0]; next && !isRunning(key); next = store.session(key)?.pendingDeletes?.[0]) {
				const item = next;
				const meta = store.session(key)!;
				const tenant = tenantOf(meta.tenantId ?? "work");
				try {
					await (tenant ? inTenant(tenant, () => applyDelete(meta, item)) : applyDelete(meta, item));
				} catch (error) {
					if (error instanceof HttpError && error.status === 409 && isRunning(key)) break;
					console.error(`Deleting a message from ${key} failed:`, (error as Error).message);
				}
				const current = store.session(key)!;
				current.pendingDeletes = current.pendingDeletes?.filter((d) => d.id !== item.id);
				if (!current.pendingDeletes?.length) delete current.pendingDeletes;
				saveNow();
				// The deletion's own broadcast went out before the queue shrank.
				hub.broadcast(key, { type: "pending_deletes", pendingDeletes: hub.pendingDeletes(key) });
			}
		} finally {
			draining.delete(key);
		}
	};
	hub.onRun((key) => void setTimeout(() => void drainDeletes(key), 0));

	const deleteBlockedReason = (meta: SessionMeta) => {
		if (deleting.has(meta.key)) return "This session is being deleted";
		if (byId.get(meta.harness)?.live(meta.id)?.state.running || submissions.has(meta.key)) return "The agent is running";
		if (hub.count(meta.key) > 0) return "Someone is viewing this session";
		if (isConsolidating(meta.key)) return "Project memory is being updated";
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
			deleteBlockedReason: deleteBlockedReason(meta),
			pinned: Boolean(meta.pinned),
			owner: meta.ownerId ? (store.userById(meta.ownerId)?.username ?? "unknown") : undefined,
			visibility: meta.visibility,
			memoryPrivate: Boolean(meta.memoryPrivate),
			keepLive: Boolean(meta.keepLive),
			archivedAt: meta.archivedAt,
			shares: meta.shares.map((s) => ({ ...s, username: store.userById(s.userId)?.username ?? "unknown" })),
			access: accessOf(user, meta),
			projectId: projectIdOf(meta.cwd, meta.projectId, meta.tenantId ?? "work"),
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
		const id = String(req.params.id);
		const adapter = adapterOf(id);
		const models = await adapter.listModels(id === "pi" ? await piProfile(req.user!.id) : undefined);
		const lithos = id === "pi" ? await lithosVaultProfile(req.user!.id) : undefined;
		const extra = lithos ? await adapter.listModels(lithos) : [];
		res.json({ models: [...models.filter(model => !extra.some(other => other.provider === model.provider && other.id === model.id)), ...extra] });
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
			.filter(({ meta }) => !meta.deleted && !meta.archivedAt && !meta.memory && accessOf(user, meta))
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
			.filter((meta): meta is SessionMeta => Boolean(meta && !meta.deleted && !meta.archivedAt && !meta.memory && accessOf(req.user!, meta)))
			.map((meta) => summary(meta, req.user!));
		res.json({ sessions });
	});

	/** The caller's most recently active sessions across all folders, for the home page. */
	router.get("/sessions/recent", (req, res) => {
		const limit = z.coerce.number().int().min(1).max(20).catch(3).parse(req.query.limit);
		const sessions = Object.values(store.data.sessions)
			// Unclaimed sessions are registered on first listing; without activity in the app they are not "recent".
			.filter((meta) => !meta.deleted && !meta.archivedAt && !meta.memory && (meta.ownerId || meta.updatedAt) && accessOf(req.user!, meta))
			.map((meta) => summary(meta, req.user!))
			.sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, limit);
		res.json({ sessions });
	});

	/** The file pi last wrote or edited, in one session or across a project's recent sessions (the file preview sidebar). */
	router.get("/sessions/last-edit", async (req, res) => {
		const user = req.user!;
		const { session, project } = z.object({ session: z.string().optional(), project: z.string().optional() }).parse(req.query);
		const candidates = Object.values(store.data.sessions)
			.filter((meta) => !meta.deleted && accessOf(user, meta) && (session ? meta.key === session : !project || projectIdOf(meta.cwd, meta.projectId, meta.tenantId ?? "work") === project))
			.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
			.slice(0, 10);
		for (const meta of candidates) {
			const adapter = byId.get(meta.harness);
			if (!adapter) continue;
			const messages = adapter.live(meta.id)?.state.messages ?? (await adapter.readSession(meta.id, meta.cwd).catch(() => undefined))?.messages ?? [];
			const file = lastEditedFile(messages, meta.cwd);
			if (file) return void res.json({ file, sessionKey: meta.key });
		}
		res.json({ file: null });
	});

	/** Sessions and chats the caller can send messages into (the share-to picker); sessions behind a chat and memory are left out. */
	router.get("/sessions/targets", (req, res) => {
		const sessions = Object.values(store.data.sessions)
			.filter((meta) => !meta.deleted && !meta.archivedAt && !meta.memory && (meta.ownerId || meta.updatedAt) && canWrite(accessOf(req.user!, meta)) && !hub.quiet(meta.key))
			.map((meta) => {
				const s = summary(meta, req.user!);
				return { kind: "session" as const, id: meta.key, title: s.name || s.firstMessage || "Untitled session", folder: s.path, running: s.running, updatedAt: s.updatedAt };
			});
		const targets = [...chats.shareTargets(req.user!), ...sessions].sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt.localeCompare(a.updatedAt));
		res.json({ targets });
	});

	/**
	 * Share a message into other sessions (as a prompt) and chats (as the caller's message);
	 * it waits while the source or the target agent is running.
	 */
	router.post("/sessions/forward", async (req, res) => {
		const ref = z.object({ kind: z.enum(["session", "chat"]), id: z.string() });
		const body = z.object({ text: z.string().trim().min(1).max(200_000), from: ref.optional(), to: z.array(ref).min(1).max(50) }).parse(req.body);
		const user = req.user!;
		const sessionOf = (id: string) => {
			const meta = store.session(id);
			if (!meta || meta.deleted || !accessOf(user, meta)) throw new HttpError(404, "Session not found");
			return meta;
		};
		const chatTitle = (id: string) => {
			if (!chats.isMember(id, user)) throw new HttpError(404, "Chat not found");
			return chats.title(id, user.id)!;
		};
		// The header links back to the source in the app (a hash route), so the card can open it.
		const title = (name: string) => `“${firstLine(name).replace(/[[\]]/g, "").slice(0, 80)}”`;
		let label: string | undefined;
		if (body.from?.kind === "chat") label = `[chat ${title(chatTitle(body.from.id))}](#${new URLSearchParams({ c: body.from.id })})`;
		else if (body.from) {
			const source = sessionOf(body.from.id);
			const name = source.name || source.firstMessage;
			label = `[${name ? `session ${title(name)}` : "another session"}](#${new URLSearchParams({ f: toRel(source.cwd), s: source.key })})`;
		}
		const targets = body.to.filter((to, i) => !sameRef(to, body.from) && body.to.findIndex((other) => sameRef(other, to)) === i);
		for (const to of targets) {
			if (to.kind === "chat") {
				chatTitle(to.id);
				continue;
			}
			const meta = sessionOf(to.id);
			if (!canWrite(accessOf(user, meta))) throw new HttpError(403, `You have read-only access to “${meta.name || meta.firstMessage || "Untitled session"}”`);
		}
		const text = `Shared from ${label ?? "another session"}:\n\n${body.text}`;
		// Watch the sessions involved now, so their runs ending delivers without waiting for the periodic attach.
		for (const key of [body.from, ...targets].map((r) => (r?.kind === "chat" ? getChat(r.id)?.sessionKey : r?.id))) {
			const meta = key ? store.session(key) : undefined;
			const live = meta && byId.get(meta.harness)?.live(meta.id);
			if (live) hub.attach(key!, live);
		}
		const waiting = targets.filter((to) => busy(body.from) || busy(to)).length;
		forwards.push(...targets.map((to) => ({ from: body.from, to, userId: user.id, text, tenantId: tenantId() })));
		await deliverForwards();
		res.json({ shared: targets.length, waiting });
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
				projectId: z.string().optional(),
				memoryPrivate: z.boolean().default(false),
			})
			.parse(req.body);
		const meta = await createSession(req.user!, { ...body, cwd: resolveSafe(body.path), projectId: checkProject(body.projectId, req.user!) });
		store.upsertSession({ ...meta, memoryPrivate: body.memoryPrivate });
		res.json({ session: summary(store.session(meta.key)!, req.user!) });
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
				model: stored?.model,
				thinkingLevel: stored?.thinkingLevel,
			};
			send(res, { type: "state", state: hub.state(key, state) });
		}
	});

	/** The session folder's git state (null outside a repository), shown under the session title. */
	router.get("/sessions/:key/git", async (req, res) => {
		const { meta } = load(req);
		res.setHeader("Cache-Control", "no-store");
		res.json({ git: await gitStatus(meta.cwd) });
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
				fromBrowser: z.boolean().optional(),
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

	/** Delete one of the caller's own prompts; while the agent runs, the deletion waits until the run ends. */
	router.post("/sessions/:key/messages/delete", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ index: z.number().int().min(0), timestamp: z.number().optional(), expect: z.string() }).parse(req.body);
		const request = { userId: req.user!.id, ...body };
		const live = adapter.live(meta.id);
		locatePrompt(meta, live?.state.messages ?? (await adapter.readSession(meta.id, meta.cwd))?.messages ?? [], request);
		res.json({ queued: await deleteFromSession(meta, request) });
	});

	router.post("/sessions/:key/abort", async (req, res) => {
		const { meta, adapter } = writable(req);
		await adapter.live(meta.id)?.abort();
		res.json({ ok: true });
	});

	router.post("/sessions/:key/model", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ provider: z.string(), id: z.string() }).parse(req.body);
		const user = req.user!;
		await serializeSessionChange(meta, async () => {
			if (meta.harness !== "pi") {
				await (await ensureLive(meta, adapter)).setModel(body.provider, body.id);
				return;
			}
			if (adapter.live(meta.id)?.state.running) throw new HttpError(409, "Wait for the active Pi run to finish");
			const profile = body.provider === "lithosai" ? await lithosVaultProfile(user.id) : await piProfile(user.id);
			if (body.provider === "lithosai" && !profile) throw new HttpError(400, "Add LITHOS_Key to your Personal vault to use LithosAI");
			if (!availablePreferredModel(await adapter.listModels(profile), body)) throw new HttpError(400, "This model is not available to your account");
			const live = await adapter.open(meta.id, meta.cwd, profile ?? null);
			hub.attach(meta.key, live);
			await live.setModel(body.provider, body.id);
			pickedModels.set(modelPickKey(meta, user), body);
		});
		res.json({ ok: true });
	});

	router.post("/sessions/:key/thinking", async (req, res) => {
		const { meta, adapter } = writable(req);
		const body = z.object({ level: z.string() }).parse(req.body);
		await (await ensureLive(meta, adapter)).setThinkingLevel(body.level);
		res.json({ ok: true });
	});

	router.post("/sessions/:key/generate-title", async (req, res) => {
		const { meta } = writable(req);
		res.json({ name: await titleSession(meta, req.user!) });
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

	/** Check current eligibility immediately before each deletion, not just when the list was loaded. */
	const removeSession = async (key: string, user: User) => {
		const { meta, access, adapter } = loadSession(key, user);
		if (!canManage(access)) throw new HttpError(403, "Only the owner or an admin can delete this session");
		const blocked = deleteBlockedReason(meta);
		if (blocked) throw new HttpError(409, blocked);
		deleting.add(key);
		try {
			const purged = await adapter.deleteSession(meta.id, meta.cwd);
			if (purged) store.removeSession(key);
			else {
				const current = store.session(key) ?? meta;
				current.deleted = true;
				delete current.authorship;
			}
			saveNow();
			hub.broadcast(key, { type: "deleted", by: user.username });
		} finally {
			deleting.delete(key);
		}
	};
	router.post("/sessions/batch-delete", async (req, res) => {
		const { keys } = z.object({ keys: z.array(z.string().min(1)).min(1) }).parse(req.body);
		const deleted: string[] = [];
		const skipped: { key: string; reason: string }[] = [];
		for (const key of new Set(keys)) {
			try {
				await removeSession(key, req.user!);
				deleted.push(key);
			} catch (error) {
				if (!(error instanceof HttpError)) console.error("Session deletion failed:", error);
				skipped.push({ key, reason: error instanceof HttpError ? error.message : "Could not delete this session" });
			}
		}
		res.json({ deleted, skipped });
	});
	router.delete("/sessions/:key", async (req, res) => {
		await removeSession(String(req.params.key), req.user!);
		res.json({ ok: true });
	});

	router.put("/sessions/:key/acl", async (req, res) => {
		const { meta, access } = load(req);
		if (!canManage(access)) throw new HttpError(403, "Only the owner or an admin can change sharing");
		const body = z.object({ visibility: z.enum(["private", "shared"]), shares: shareSchema }).parse(req.body);
		if (body.shares.some(s => !isTenantMember(s.userId, meta.tenantId ?? "work"))) throw new HttpError(400, "Cannot share across tenants");
		const shares = body.shares.filter((s) => s.userId !== meta.ownerId && store.userById(s.userId));
		const next = store.upsertSession({ ...meta, visibility: body.visibility, shares });
		res.json({ session: summary(next, req.user!) });
	});

	/** Admins adopt sessions that were started outside the app, or reassign ownership. */
	router.post("/sessions/:key/owner", async (req, res) => {
		const { meta } = load(req);
		if (req.user!.role !== "admin") throw new HttpError(403, "Admins only");
		const body = z.object({ userId: z.string() }).parse(req.body);
		if (!store.userById(body.userId) || !isTenantMember(body.userId, meta.tenantId ?? "work")) throw new HttpError(400, "No such tenant member");
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
		deleteFromSession,
		readMessages: async (meta: SessionMeta) => (await adapterOf(meta.harness).readSession(meta.id, meta.cwd))?.messages ?? [],
		listModels: (harness: string) => adapterOf(harness).listModels(),
	};
	chats = mountChats(router, chatDeps);
	mountMemory(router, {
		...chatDeps,
		isDeleting: (key) => deleting.has(key),
		sessionProvider: (meta) => byId.get(meta.harness)?.live(meta.id)?.state.model?.provider ?? store.userById(meta.ownerId ?? "")?.sessionDefaults?.model.provider,
		providers: async (user) => [...new Set((await adapterOf(await harnessFor(user)).listModels()).map((m) => m.provider))],
		chatTurn: (chatId, since, run) => chats.memoryTurn(chatId, since, run),
		dropTurn,
	});
	mountJobs(router, {
		...chatDeps,
		isRunning,
		isQuiet: (key) => hub.quiet(key),
		canWrite: (user, meta) => canWrite(accessOf(user, meta)),
	});
	mountWatches(router, {
		...chatDeps,
		isRunning,
		isQuiet: (key) => hub.quiet(key),
		canRead: (user, meta) => Boolean(accessOf(user, meta)),
		canWrite: (user, meta) => canWrite(accessOf(user, meta)),
		involved,
	});
	mountApplets(router, chatDeps);
	mountProjects(router, chatDeps);
	mountLinks(router, chatDeps.readMessages);

	// Observe every live runtime, including runs resumed at startup that nobody has opened yet.
	platform().scheduler.every(5_000, () => {
		for (const adapter of adapters) for (const live of adapter.liveSessions()) hub.attach(`${adapter.id}:${live.id}`, live);
		if (forwards.length) void deliverForwards();
		for (const meta of Object.values(store.data.sessions)) if (meta.pendingDeletes?.length) void drainDeletes(meta.key);
	});

	// Stop idle runtimes: not running, nobody watching, not pinned, quiet for IDLE_TIMEOUT_MIN.
	platform().scheduler.every(60_000, () => {
		const cutoff = Date.now() - config.idleTimeoutMin * 60_000;
		for (const adapter of adapters) {
			for (const live of adapter.liveSessions()) {
				const key = `${adapter.id}:${live.id}`;
				if (live.state.running || hub.count(key) > 0 || store.session(key)?.pinned || live.lastActivity > cutoff) continue;
				void live.close();
			}
		}
	});

	return router;
}
