import express, { type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./files.js";
import { bridgeCredentialValid } from "./interactions.js";
import { platform } from "./ports/index.js";
import { store } from "./store.js";
import { tenantId } from "./tenant-context.js";
import { isTenantMember } from "./tenants.js";

/*
 * Routes of the secret vault; the secrets live behind the Secrets port (the separately deployed
 * vault/ service when self-hosted). Beezy decides whose secrets a request may touch: people manage
 * their own per tenant, and an agent reads its session owner's through the session's bridge
 * credential. Values never pass through Beezy's own storage.
 */

export const vaultConfigured = () => platform().secrets.configured();

const keySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Keys are letters, digits and underscores, starting with a letter or underscore (max 64)");
const namespaceOf = (tenant: string, userId: string) => `${tenant}.${userId}`;

export function vaultRoutes(): Router {
	const router = express.Router();
	router.use("/vault", requireAuth);
	const mine = (userId: string) => namespaceOf(tenantId(), userId);

	router.get("/vault/status", async (_req, res) => {
		if (!vaultConfigured()) return void res.json({ configured: false, reachable: false });
		res.json({ configured: true, reachable: await platform().secrets.reachable() });
	});

	router.get("/vault/secrets", async (req, res) => {
		res.json({ secrets: await platform().secrets.list(mine(req.user!.id)) });
	});

	router.get("/vault/secrets/:key", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(await platform().secrets.get(mine(req.user!.id), keySchema.parse(req.params.key)));
	});

	router.put("/vault/secrets/:key", async (req, res) => {
		const body = z.object({ value: z.string().min(1).max(64 * 1024).optional(), description: z.string().trim().max(300).default("") }).strict().parse(req.body);
		res.json(await platform().secrets.put(mine(req.user!.id), keySchema.parse(req.params.key), body));
	});

	router.delete("/vault/secrets/:key", async (req, res) => {
		await platform().secrets.delete(mine(req.user!.id), keySchema.parse(req.params.key));
		res.json({ deleted: true });
	});

	/** The agent's view: its session owner's keys and descriptions, and a value on request. */
	const ownerNamespace = (key: string, authorization?: string) => {
		if (!bridgeCredentialValid(key, authorization)) throw new HttpError(403, "Invalid bridge credential");
		const meta = store.session(key);
		if (!meta || meta.deleted) throw new HttpError(404, "Session not found");
		const tenant = meta.tenantId ?? "work";
		if (!meta.ownerId || !isTenantMember(meta.ownerId, tenant)) throw new HttpError(403, "This session has no owner whose vault it could use");
		return namespaceOf(tenant, meta.ownerId);
	};
	router.get("/vault-bridge/:key", async (req, res) => {
		const secrets = await platform().secrets.list(ownerNamespace(String(req.params.key), req.headers.authorization));
		res.json({ secrets: secrets.filter(secret => secret.key !== config.cloudflareVaultKey) });
	});
	router.get("/vault-bridge/:key/:secret", async (req, res) => {
		const namespace = ownerNamespace(String(req.params.key), req.headers.authorization);
		const requested = keySchema.parse(req.params.secret);
		if (requested === config.cloudflareVaultKey) throw new HttpError(403, "This credential is reserved for server-side Cloudflare assistance");
		const { key, value } = await platform().secrets.get(namespace, requested);
		res.setHeader("Cache-Control", "no-store");
		res.json({ key, value });
	});

	return router;
}
