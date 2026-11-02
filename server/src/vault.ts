import express, { type Request, type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./files.js";
import { bridgeCredentialValid } from "./interactions.js";
import { platform, type SecretInfo } from "./ports/index.js";
import { canAccessProject, isProjectMember, projectIdOf, tenantProjects } from "./projects.js";
import { store } from "./store.js";
import { tenantId } from "./tenant-context.js";
import { isTenantMember } from "./tenants.js";

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

export function vaultRoutes(): Router {
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
		res.json(await platform().secrets.put(scope(req), keySchema.parse(req.params.key), body));
	});

	router.delete("/vault/secrets/:key", async (req, res) => {
		await platform().secrets.delete(scope(req), keySchema.parse(req.params.key));
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
		res.json(moved);
	});

	/** What an agent may read: its session owner's vault, and its project's while the owner is in that project. */
	const agentNamespaces = (key: string, authorization?: string) => {
		if (!bridgeCredentialValid(key, authorization)) throw new HttpError(403, "Invalid bridge credential");
		const meta = store.session(key);
		if (!meta || meta.deleted) throw new HttpError(404, "Session not found");
		const tenant = meta.tenantId ?? "work";
		if (!meta.ownerId || !isTenantMember(meta.ownerId, tenant)) throw new HttpError(403, "This session has no owner whose vault it could use");
		const projectId = projectIdOf(meta.cwd, meta.projectId, tenant);
		const project = tenantProjects(tenant).find((p) => p.id === projectId);
		return { personal: namespaceOf(tenant, meta.ownerId), project: project && isProjectMember(meta.ownerId, project) ? projectNamespaceOf(tenant, project.id) : undefined };
	};
	const agentVisible = (secret: SecretInfo) => secret.key !== config.cloudflareVaultKey;

	router.get("/vault-bridge/:key", async (req, res) => {
		const { personal, project } = agentNamespaces(String(req.params.key), req.headers.authorization);
		const [own, shared] = await Promise.all([platform().secrets.list(personal), project ? platform().secrets.list(project) : []]);
		res.json({ secrets: [...own.map((s) => ({ ...s, scope: "personal" })), ...shared.map((s) => ({ ...s, scope: "project" }))].filter(agentVisible) });
	});
	/** One value; personal first unless `?scope=project` asks for the project's. */
	router.get("/vault-bridge/:key/:secret", async (req, res) => {
		const { personal, project } = agentNamespaces(String(req.params.key), req.headers.authorization);
		const requested = keySchema.parse(req.params.secret);
		if (requested === config.cloudflareVaultKey) throw new HttpError(403, "This credential is reserved for server-side Cloudflare assistance");
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
