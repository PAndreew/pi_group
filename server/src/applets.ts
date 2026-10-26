import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import type { Request, Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import { bridgeCredentialValid } from "./interactions.js";
import { pushToUser } from "./push.js";
import type { RunOutcome } from "./sessions.js";
import { saveNow, type SessionMeta, store, type User } from "./store.js";
import { tenantAccess, isTenantMember, tenantOf } from "./tenants.js";
import { inTenant } from "./tenant-context.js";

/*
 * Applets: small forms an agent designs from a closed set of fields, saved for good and opened from
 * the grid icon or /apps/<slug>. Each button fills a prompt template with the form's values and
 * starts a fresh agent session in the applet's folder. Agents propose them through the
 * propose_applet tool (extensions/applets.mjs); nobody else sees or runs one until its owner (or an
 * admin) approves it, and an approved applet keeps running its approved version while a change waits.
 * See docs/applets.md.
 */

const MAX_APPLETS_PER_OWNER = 30;
const MAX_RUNS_KEPT = 30;
const MAX_OUTPUT = 20_000;

const text = (max: number) => z.string().trim().min(1).max(max);
const fieldId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "Field IDs are a letter followed by letters, digits or underscores");
const common = { id: fieldId, label: text(120), help: z.string().trim().max(500).optional(), optional: z.boolean().default(false) };
const choices = z.array(text(100)).min(1).max(100).refine((o) => new Set(o).size === o.length, "Options must be unique");
export const fieldSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("markdown"), text: text(4000) }).strict(),
	z.object({ type: z.literal("text"), ...common, placeholder: z.string().max(200).optional(), default: z.string().max(2000).optional() }).strict(),
	z.object({ type: z.literal("textarea"), ...common, placeholder: z.string().max(200).optional(), default: z.string().max(20_000).optional() }).strict(),
	z.object({ type: z.literal("number"), ...common, min: z.number().optional(), max: z.number().optional(), step: z.number().positive().optional(), default: z.number().optional() }).strict(),
	z.object({ type: z.literal("select"), ...common, options: choices, multiple: z.boolean().default(false), default: z.union([z.string(), z.array(z.string())]).optional() }).strict(),
	z.object({ type: z.literal("radio"), ...common, options: choices.refine((o) => o.length <= 12, "At most 12 radio options; use a select"), default: z.string().optional() }).strict(),
	z.object({ type: z.literal("checkbox"), id: fieldId, label: text(120), help: z.string().trim().max(500).optional(), default: z.boolean().default(false) }).strict(),
	z.object({ type: z.literal("file"), ...common, accept: z.array(z.string().regex(/^\.[a-zA-Z0-9]{1,10}$/, "Extensions look like .docx")).max(20).optional(), multiple: z.boolean().default(false) }).strict(),
	z.object({ type: z.literal("folder"), ...common }).strict(),
]);
export type AppletField = z.infer<typeof fieldSchema>;
type InputField = Exclude<AppletField, { type: "markdown" }>;

const actionSchema = z.object({ id: fieldId, label: text(60), prompt: text(20_000) }).strict();
const SECTION = /\{\{([#^])([a-zA-Z][a-zA-Z0-9_]*)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
const VARIABLE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

export const appletSpec = z
	.object({
		slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, "Slugs are 2-48 lowercase letters, digits and dashes"),
		title: text(80),
		description: z.string().trim().max(300).default(""),
		fields: z.array(fieldSchema).max(25),
		actions: z.array(actionSchema).min(1).max(5),
	})
	.strict()
	.superRefine((spec, ctx) => {
		const inputs = spec.fields.filter((f): f is InputField => f.type !== "markdown");
		const ids = new Set(inputs.map((f) => f.id));
		if (ids.size !== inputs.length) ctx.addIssue({ code: "custom", message: "Field IDs must be unique" });
		if (new Set(spec.actions.map((a) => a.id)).size !== spec.actions.length) ctx.addIssue({ code: "custom", message: "Action IDs must be unique" });
		for (const action of spec.actions) {
			const used = [...action.prompt.matchAll(SECTION)].map((m) => m[2]).concat([...action.prompt.replace(SECTION, "$3").matchAll(VARIABLE)].map((m) => m[1]));
			for (const id of used) if (!ids.has(id)) ctx.addIssue({ code: "custom", message: `Action “${action.label}” uses {{${id}}}, which is not a field` });
		}
		for (const field of inputs) {
			if ((field.type === "select" || field.type === "radio") && field.default !== undefined) {
				const defaults = Array.isArray(field.default) ? field.default : [field.default];
				if (defaults.some((d) => !field.options.includes(d))) ctx.addIssue({ code: "custom", message: `The default of “${field.label}” is not one of its options` });
			}
		}
	});
export type AppletSpec = z.infer<typeof appletSpec>;

export interface Applet {
	tenantId?: string;
	id: string;
	ownerId: string;
	/** Absolute folder runs start in: where the proposing session worked. */
	cwd: string;
	spec: AppletSpec;
	version: number;
	/** A change waiting for approval while the approved `spec` keeps running. */
	draft?: AppletSpec;
	approvedBy?: string;
	approvedAt?: string;
	proposedIn?: string;
	note?: string;
	createdAt: string;
	updatedAt: string;
}

export interface AppletRun {
	tenantId?: string;
	id: string;
	appletId: string;
	userId: string;
	action: string;
	values: Record<string, unknown>;
	sessionKey: string;
	status: "running" | "finished" | "error" | "aborted";
	output?: string;
	startedAt: string;
	finishedAt?: string;
}

export type AppletValue = string | number | boolean | string[];

/** The form's values for `spec`, checked and normalised; file and folder paths stay root-relative. */
export function checkValues(spec: AppletSpec, raw: Record<string, unknown>) {
	const values: Record<string, AppletValue> = {};
	for (const field of spec.fields) {
		if (field.type === "markdown") continue;
		const value = raw[field.id];
		const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
		if (field.type === "checkbox") {
			values[field.id] = value === true;
			continue;
		}
		if (empty) {
			if (!field.optional) throw new HttpError(400, `“${field.label}” is required`);
			values[field.id] = field.type === "number" ? "" : (field.type === "select" && field.multiple) || (field.type === "file" && field.multiple) ? [] : "";
			continue;
		}
		const fail = (why: string): never => {
			throw new HttpError(400, `“${field.label}” ${why}`);
		};
		switch (field.type) {
			case "text":
			case "textarea":
				if (typeof value !== "string" || value.length > (field.type === "text" ? 2000 : 20_000)) fail("is not valid text");
				values[field.id] = value as string;
				break;
			case "number": {
				const n = typeof value === "number" ? value : Number(value);
				if (!Number.isFinite(n)) fail("is not a number");
				if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) fail(`must be between ${field.min ?? "-∞"} and ${field.max ?? "∞"}`);
				values[field.id] = n;
				break;
			}
			case "select":
			case "radio": {
				const picked = Array.isArray(value) ? value : [value];
				if (field.type === "radio" || !field.multiple) {
					if (picked.length !== 1) fail("takes one option");
				}
				if (picked.some((p) => typeof p !== "string" || !field.options.includes(p))) fail("has an unknown option");
				values[field.id] = field.type === "select" && field.multiple ? (picked as string[]) : (picked[0] as string);
				break;
			}
			case "file":
			case "folder": {
				const paths = Array.isArray(value) ? value : [value];
				if (paths.length > 50 || (field.type === "folder" || !field.multiple ? paths.length !== 1 : false)) fail(field.type === "folder" ? "takes one folder" : "takes one file");
				for (const p of paths) {
					if (typeof p !== "string") fail("is not a path");
					const abs = resolveSafe(p);
					const stat = statSync(abs, { throwIfNoEntry: false });
					if (field.type === "folder" ? !stat?.isDirectory() : !stat?.isFile()) fail(`gets ${p}, which is not a ${field.type}`);
					if (field.type === "file" && field.accept?.length && !field.accept.some((ext) => abs.toLowerCase().endsWith(ext.toLowerCase()))) fail(`takes ${field.accept.join(", ")} files, not ${p}`);
				}
				values[field.id] = field.type === "file" && field.multiple ? (paths as string[]).map((p) => toRel(resolveSafe(p))) : toRel(resolveSafe(paths[0] as string));
				break;
			}
		}
	}
	return values;
}

/** How a value reads inside a prompt; paths are made relative to the run's folder, where the agent works. */
function show(field: InputField, value: AppletValue, cwd: string, root: string) {
	if (field.type === "checkbox") return value ? "yes" : "no";
	if (field.type === "file" || field.type === "folder") {
		const rel = (p: string) => `\`${path.relative(cwd, path.join(root, p)).split(path.sep).join("/") || "."}\``;
		return Array.isArray(value) ? value.map(rel).join(", ") : value === "" ? "" : rel(String(value));
	}
	return Array.isArray(value) ? value.join(", ") : String(value);
}

/**
 * Fill a template: {{id}} is the value, {{#id}}…{{/id}} appears when it is set (checked, non-empty)
 * and {{^id}}…{{/id}} when it is not.
 */
export function renderPrompt(spec: AppletSpec, template: string, values: Record<string, AppletValue>, cwd: string, root: string) {
	const fields = new Map(spec.fields.filter((f): f is InputField => f.type !== "markdown").map((f) => [f.id, f]));
	const set = (id: string) => {
		const v = values[id];
		return v !== undefined && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0);
	};
	return template
		.replace(SECTION, (_m, kind: string, id: string, body: string) => (set(id) === (kind === "#") ? body : ""))
		.replace(VARIABLE, (_m, id: string) => (fields.has(id) && values[id] !== undefined ? show(fields.get(id)!, values[id], cwd, root) : ""))
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export interface AppletDeps {
	createSession: (user: User, input: { harness: string; cwd: string; name?: string }) => Promise<SessionMeta>;
	promptSession: (meta: SessionMeta, user: User, input: { text: string }) => Promise<void>;
	harnessFor: (user: User) => Promise<string>;
	onRun: (listener: (key: string, outcome: RunOutcome) => void) => void;
	sendTo: (userId: string, event: unknown) => void;
}

const approved = (applet: Applet) => {
	const approver = applet.approvedBy ? store.userById(applet.approvedBy) : undefined;
	return Boolean(approver && isTenantMember(approver.id, applet.tenantId ?? "work") && (approver.role === "admin" || approver.id === applet.ownerId));
};
const canManage = (user: User, applet: Applet) => user.role === "admin" || user.id === applet.ownerId;
/** Everyone in the tenant once approved; before that only those who can approve it. */
const canSee = (user: User, applet: Applet) => tenantAccess(user, applet) && (approved(applet) || canManage(user, applet));

export function mountApplets(router: Router, deps: AppletDeps) {
	store.data.applets ??= [];
	store.data.appletRuns ??= [];

	const changed = (applet: Pick<Applet, "tenantId">) => {
		const id = applet.tenantId ?? "work";
		for (const user of store.data.users) if (isTenantMember(user.id, id)) deps.sendTo(user.id, { type: "applets", tenantId: id });
	};

	const finish = (key: string, outcome: RunOutcome) => {
		const run = store.data.appletRuns.find((r) => r.sessionKey === key && r.status === "running");
		if (!run) return;
		Object.assign(run, { status: outcome.kind, output: outcome.text.slice(-MAX_OUTPUT), finishedAt: new Date().toISOString() });
		saveNow();
		deps.sendTo(run.userId, { type: "applets", tenantId: run.tenantId ?? "work" });
		const applet = store.data.applets.find((a) => a.id === run.appletId);
		if (outcome.kind === "error" && applet) void pushToUser(run.userId, { type: "applet", title: `Applet failed · ${applet.spec.title}`, text: outcome.text.slice(0, 300) }).catch(() => {});
	};
	deps.onRun(finish);
	// Runtimes stop with the server, so a run that was going when it stopped will not report back.
	for (const run of store.data.appletRuns) {
		if (run.status === "running") Object.assign(run, { status: "aborted", output: "The server restarted during this run; open its session to see how far it got." });
	}

	const view = (applet: Applet, user: User, full = false) => {
		const source = applet.proposedIn ? store.session(applet.proposedIn) : undefined;
		return {
			id: applet.id,
			slug: applet.spec.slug,
			title: applet.spec.title,
			description: applet.spec.description,
			folder: toRel(applet.cwd),
			owner: store.userById(applet.ownerId)?.username ?? "unknown",
			version: applet.version,
			approved: approved(applet),
			approvedBy: applet.approvedBy ? store.userById(applet.approvedBy)?.username : undefined,
			approvedAt: applet.approvedAt,
			hasDraft: Boolean(applet.draft),
			canManage: canManage(user, applet),
			note: applet.note,
			proposedIn: source && !source.deleted ? { key: source.key, folder: toRel(source.cwd), name: source.name || source.firstMessage || "Untitled session" } : undefined,
			createdAt: applet.createdAt,
			updatedAt: applet.updatedAt,
			...(full ? { spec: applet.spec, draft: canManage(user, applet) ? applet.draft : undefined } : {}),
		};
	};

	const runView = (run: AppletRun) => {
		const session = store.session(run.sessionKey);
		return { ...run, session: session && !session.deleted ? { key: session.key, folder: toRel(session.cwd) } : undefined };
	};

	const find = (req: Request) => {
		const ref = String(req.params.id);
		const applet = store.data.applets.find((a) => (a.id === ref || a.spec.slug === ref) && canSee(req.user!, a));
		if (!applet) throw new HttpError(404, "Applet not found");
		return applet;
	};

	/** The agent's side, through the session's bridge credential. */
	router.use("/applet-bridge/:key", (req, _res, next) => {
		const key = String(req.params.key);
		if (!bridgeCredentialValid(key, req.headers.authorization)) throw new HttpError(403, "Invalid bridge credential");
		const tenant = tenantOf(store.session(key)?.tenantId ?? "work");
		return tenant ? inTenant(tenant, next) : next();
	});

	const bridgeOwner = (key: string) => {
		const meta = store.session(key);
		if (!meta || meta.deleted) throw new HttpError(404, "Session not found");
		const owner = meta.ownerId ? store.userById(meta.ownerId) : undefined;
		if (!owner) throw new HttpError(400, "This session has no owner to approve an applet");
		return { meta, owner };
	};

	/** Applets the session's owner may change, with their specs, so the agent can edit one. */
	router.get("/applet-bridge/:key", (req, res) => {
		const { meta, owner } = bridgeOwner(String(req.params.key));
		const applets = store.data.applets.filter((a) => (a.tenantId ?? "work") === (meta.tenantId ?? "work") && canManage(owner, a));
		res.json({ applets: applets.map((a) => ({ slug: a.spec.slug, folder: toRel(a.cwd), approved: approved(a), spec: a.draft ?? a.spec })) });
	});

	/** A new applet, or a change to one with the same slug; either waits for approval. */
	router.post("/applet-bridge/:key", (req, res) => {
		const key = String(req.params.key);
		const { meta, owner } = bridgeOwner(key);
		const body = z.object({ reason: z.string().trim().max(1000).optional() }).passthrough().parse(req.body);
		const { reason, ...rest } = body;
		const spec = appletSpec.parse(rest);
		const tenant = meta.tenantId ?? "work";
		const at = new Date().toISOString();
		let applet = store.data.applets.find((a) => a.spec.slug === spec.slug && (a.tenantId ?? "work") === tenant);
		if (applet && !canManage(owner, applet)) throw new HttpError(409, `The slug “${spec.slug}” belongs to ${store.userById(applet.ownerId)?.username ?? "someone else"}'s applet; pick another`);
		if (applet) {
			if (approved(applet)) applet.draft = spec;
			else applet.spec = spec;
			Object.assign(applet, { version: applet.version + 1, proposedIn: key, note: reason, updatedAt: at });
		} else {
			if (store.data.applets.filter((a) => a.ownerId === owner.id).length >= MAX_APPLETS_PER_OWNER) throw new HttpError(429, `${owner.username} already has ${MAX_APPLETS_PER_OWNER} applets; delete one first`);
			applet = { tenantId: tenant, id: randomUUID(), ownerId: owner.id, cwd: meta.cwd, spec, version: 1, proposedIn: key, note: reason, createdAt: at, updatedAt: at };
			store.data.applets.push(applet);
		}
		saveNow();
		changed(applet);
		void pushToUser(owner.id, { type: "applet", title: "Applet waiting for approval", text: spec.title }).catch(() => {});
		res.json({
			id: applet.id,
			url: `/apps/${spec.slug}`,
			status: "waiting_for_approval",
			message: applet.draft
				? `Saved as a change. The approved version keeps working until ${owner.username} approves the change at /apps/${spec.slug} (or under Applets, the grid icon below the message box).`
				: `Saved. It can be used after ${owner.username} approves it at /apps/${spec.slug} (or under Applets, the grid icon below the message box).`,
		});
	});

	router.use("/applets", requireAuth);

	router.get("/applets", (req, res) => {
		const user = req.user!;
		const applets = store.data.applets.filter((a) => canSee(user, a)).sort((a, b) => a.spec.title.localeCompare(b.spec.title));
		res.json({ applets: applets.map((a) => view(a, user)) });
	});

	router.get("/applets/:id", (req, res) => {
		const applet = find(req);
		const user = req.user!;
		const runs = store.data.appletRuns.filter((r) => r.appletId === applet.id && r.userId === user.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		res.json({ applet: view(applet, user, true), runs: runs.map(runView) });
	});

	/** Approve the applet, or the change waiting on an approved one. */
	router.post("/applets/:id/approve", (req, res) => {
		const applet = find(req);
		const user = req.user!;
		if (!canManage(user, applet)) throw new HttpError(403, "Only its owner or an admin can approve an applet");
		const version = z.object({ version: z.number().int() }).parse(req.body).version;
		if (version !== applet.version) throw new HttpError(409, "The applet changed since you looked at it; review it again");
		if (applet.draft) applet.spec = applet.draft;
		Object.assign(applet, { draft: undefined, approvedBy: user.id, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
		saveNow();
		changed(applet);
		res.json({ applet: view(applet, user, true) });
	});

	/** Drop the change waiting on an approved applet. */
	router.delete("/applets/:id/draft", (req, res) => {
		const applet = find(req);
		if (!canManage(req.user!, applet)) throw new HttpError(403, "Only its owner or an admin can do that");
		applet.draft = undefined;
		saveNow();
		changed(applet);
		res.json({ applet: view(applet, req.user!, true) });
	});

	router.post("/applets/:id/run", async (req, res) => {
		const applet = find(req);
		const user = req.user!;
		if (!approved(applet)) throw new HttpError(409, "Approve the applet before using it");
		const body = z.object({ action: z.string(), values: z.record(z.string(), z.unknown()) }).strict().parse(req.body);
		const action = applet.spec.actions.find((a) => a.id === body.action);
		if (!action) throw new HttpError(400, "Unknown action");
		if (!statSync(applet.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new HttpError(409, "The applet's folder is gone");
		const values = checkValues(applet.spec, body.values);
		const root = resolveSafe("");
		const prompt = renderPrompt(applet.spec, action.prompt, values, applet.cwd, root);
		const meta = await deps.createSession(user, { harness: await deps.harnessFor(user), cwd: applet.cwd, name: `🧩 ${applet.spec.title}` });
		store.upsertSession({ ...store.session(meta.key)!, applet: applet.id });
		const run: AppletRun = { tenantId: applet.tenantId ?? "work", id: randomUUID(), appletId: applet.id, userId: user.id, action: action.label, values, sessionKey: meta.key, status: "running", startedAt: new Date().toISOString() };
		store.data.appletRuns.push(run);
		const mine = store.data.appletRuns.filter((r) => r.appletId === applet.id && r.userId === user.id);
		if (mine.length > MAX_RUNS_KEPT) {
			const drop = new Set(mine.slice(0, mine.length - MAX_RUNS_KEPT));
			store.data.appletRuns = store.data.appletRuns.filter((r) => !drop.has(r));
		}
		saveNow();
		try {
			await deps.promptSession(meta, user, { text: `🧩 Applet “${applet.spec.title}” · ${action.label}\n\n${prompt}` });
		} catch (error) {
			finish(meta.key, { kind: "error", text: (error as Error).message });
			throw error;
		}
		res.json({ run: runView(run) });
	});

	router.delete("/applets/:id", (req, res) => {
		const applet = find(req);
		if (!canManage(req.user!, applet)) throw new HttpError(403, "Only its owner or an admin can delete an applet");
		store.data.applets = store.data.applets.filter((a) => a !== applet);
		store.data.appletRuns = store.data.appletRuns.filter((r) => r.appletId !== applet.id);
		saveNow();
		changed(applet);
		res.json({ ok: true });
	});
}
