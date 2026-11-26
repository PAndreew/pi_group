import express, { type Request, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./files.js";
import { bridgeCredentialValid } from "./interactions.js";
import { platform } from "./ports/index.js";
import { canAccessProject, isProjectMember, projectIdOf, tenantProjects } from "./projects.js";
import { store } from "./store.js";
import { tenantId } from "./tenant-context.js";
import { isTenantMember } from "./tenants.js";
import { setLiveRedactor } from "./live-redaction.js";
import { vaultIndex } from "../extensions/lib/vault-redact.mjs";

/*
 * Routes of the secret vault; the secrets live behind the Secrets port (the separately deployed
 * vault/ service when self-hosted). Beezy decides whose secrets a request may touch: people manage
 * their own per tenant and those of the projects they can open, and an agent reads its session
 * owner's and its project's through the session's bridge credential. Values never pass through
 * Beezy's own storage.
 */

export const vaultConfigured = () => platform().secrets.configured();

const keySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Keys are letters, digits and underscores, starting with a letter or underscore (max 64)");
const namespaceOf = (tenant: string, userId: string) => `${tenant}.${userId}`;
/** Three segments, so it never meets a personal `tenant.userId` namespace. */
const projectNamespaceOf = (tenant: string, projectId: string) => `${tenant}.project.${projectId}`;

/** Keys stored for a project, for refusing to delete a project that still holds secrets. */
export async function projectSecretKeys(tenant: string, projectId: string) {
	if (!vaultConfigured()) return [];
	return (await platform().secrets.list(projectNamespaceOf(tenant, projectId))).map((secret) => secret.key);
}

const isMissing = (error: unknown) => error instanceof HttpError && error.status === 404;

/** What a session's agent may read: its owner's vault, and its project's while the owner is in that project. */
function sessionNamespaces(key: string) {
	const meta = store.session(key);
	if (!meta || meta.deleted) throw new HttpError(404, "Session not found");
	const tenant = meta.tenantId ?? "work";
	if (!meta.ownerId || !isTenantMember(meta.ownerId, tenant)) throw new HttpError(403, "This session has no owner whose vault it could use");
	const projectId = projectIdOf(meta.cwd, meta.projectId, tenant);
	const project = tenantProjects(tenant).find((p) => p.id === projectId);
	return { personal: namespaceOf(tenant, meta.ownerId), project: project && isProjectMember(meta.ownerId, project) ? projectNamespaceOf(tenant, project.id) : undefined };
}

/** The session's secrets with their values, each marked personal or project. */
async function sessionSecretValues(key: string) {
	const { personal, project } = sessionNamespaces(key);
	const secrets = platform().secrets;
	const [own, shared] = await Promise.all([secrets.list(personal), project ? secrets.list(project) : []]);
	const all = [...own.map((s) => ({ key: s.key, scope: "personal" as const })), ...shared.map((s) => ({ key: s.key, scope: "project" as const }))];
	return Promise.all(all.map(async (s) => ({ ...s, value: (await secrets.get(s.scope === "personal" ? personal : project!, s.key).catch(() => ({ value: "" }))).value })));
}

/*
 * Live tool output is redacted on the server (pi extensions only see final results). Values are cached per session
 * for 30 s like the extension does; a stale entry keeps redacting while it refreshes, so output is never held up
 * after the first load.
 */
const liveIndexes = new Map<string, { at: number; index: Promise<ReturnType<typeof vaultIndex> | undefined> }>();
const LIVE_TTL_MS = 30_000;

async function liveRedact(sessionKey: string, text: string) {
	if (!vaultConfigured()) return text;
	const now = Date.now();
	for (const [key, entry] of liveIndexes) if (now - entry.at > 10 * LIVE_TTL_MS) liveIndexes.delete(key);
	const load = () => sessionSecretValues(sessionKey).then(vaultIndex, () => undefined);
	let entry = liveIndexes.get(sessionKey);
	if (!entry) liveIndexes.set(sessionKey, (entry = { at: now, index: load() }));
	else if (now - entry.at > LIVE_TTL_MS) {
		const refreshed = entry;
		refreshed.at = now;
		void load().then((index) => {
			if (index) refreshed.index = Promise.resolve(index);
		});
	}
	const index = await entry.index;
	return index ? index.redact(text) : text;
}

/** Forget cached values (after a change in the vault UI), so live redaction picks them up at once. */
const forgetLiveIndexes = () => liveIndexes.clear();

export function vaultRoutes(): Router {
	setLiveRedactor(liveRedact);
	const router = express.Router();
	router.use("/vault", requireAuth);

	/** Personal (no project) or a project the caller can open. */
	const namespaceFor = (req: Request, projectId: unknown) => {
		if (projectId === undefined || projectId === null || projectId === "") return namespaceOf(tenantId(), req.user!.id);
		const project = tenantProjects().find((p) => p.id === projectId);
		if (!project || !canAccessProject(req.user!, project)) throw new HttpError(404, "Project not found");
		return projectNamespaceOf(tenantId(), project.id);
	};
	const scope = (req: Request) => namespaceFor(req, req.query.project);

	router.get("/vault/status", async (_req, res) => {
		if (!vaultConfigured()) return void res.json({ configured: false, reachable: false });
		res.json({ configured: true, reachable: await platform().secrets.reachable() });
	});

	router.get("/vault/secrets", async (req, res) => {
		res.json({ secrets: await platform().secrets.list(scope(req)) });
	});

	router.get("/vault/secrets/:key", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(await platform().secrets.get(scope(req), keySchema.parse(req.params.key)));
	});

	router.put("/vault/secrets/:key", async (req, res) => {
		const body = z.object({ value: z.string().min(1).max(64 * 1024).optional(), description: z.string().trim().max(300).default("") }).strict().parse(req.body);
		const saved = await platform().secrets.put(scope(req), keySchema.parse(req.params.key), body);
		forgetLiveIndexes();
		res.json(saved);
	});

	router.delete("/vault/secrets/:key", async (req, res) => {
		await platform().secrets.delete(scope(req), keySchema.parse(req.params.key));
		forgetLiveIndexes();
		res.json({ deleted: true });
	});

	/** Move a secret between the caller's own vault and a project's (or between projects): copy, then delete. */
	router.post("/vault/secrets/:key/move", async (req, res) => {
		const key = keySchema.parse(req.params.key);
		const { project } = z.object({ project: z.string().min(1).nullable() }).strict().parse(req.body);
		const from = scope(req);
		const to = namespaceFor(req, project);
		if (from === to) throw new HttpError(400, "The secret is already there");
		const secrets = platform().secrets;
		const { value, description } = await secrets.get(from, key);
		if ((await secrets.list(to)).some((secret) => secret.key === key)) throw new HttpError(409, `${key} already exists there`);
		const moved = await secrets.put(to, key, { value, description });
		await secrets.delete(from, key);
		forgetLiveIndexes();
		res.json(moved);
	});

	const agentNamespaces = (key: string, authorization?: string) => {
		if (!bridgeCredentialValid(key, authorization)) throw new HttpError(403, "Invalid bridge credential");
		return sessionNamespaces(key);
	};

	router.get("/vault-bridge/:key", async (req, res) => {
		const key = String(req.params.key);
		const { personal, project } = agentNamespaces(key, req.headers.authorization);
		if (req.query.values === "1") {
			// For the agent's extension only: it puts values into tool calls and redacts them from tool results.
			res.setHeader("Cache-Control", "no-store");
			return void res.json({ secrets: await sessionSecretValues(key) });
		}
		const [own, shared] = await Promise.all([platform().secrets.list(personal), project ? platform().secrets.list(project) : []]);
		res.json({ secrets: [...own.map((s) => ({ ...s, scope: "personal" as const })), ...shared.map((s) => ({ ...s, scope: "project" as const }))] });
	});
	/** One value; personal first unless `?scope=project` asks for the project's. */
	router.get("/vault-bridge/:key/:secret", async (req, res) => {
		const { personal, project } = agentNamespaces(String(req.params.key), req.headers.authorization);
		const requested = keySchema.parse(req.params.secret);
		const wanted = z.enum(["personal", "project"]).optional().parse(req.query.scope);
		const order = [wanted !== "project" && personal, wanted !== "personal" && project].filter((ns): ns is string => Boolean(ns));
		if (!order.length) throw new HttpError(404, "This session's project has no secrets you could read");
		for (const [index, namespace] of order.entries()) {
			try {
				const { key, value } = await platform().secrets.get(namespace, requested);
				res.setHeader("Cache-Control", "no-store");
				return void res.json({ key, value, scope: namespace === personal ? "personal" : "project" });
			} catch (error) {
				if (!isMissing(error) || index === order.length - 1) throw error;
			}
		}
	});

	return router;
}
