import express, { type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./files.js";
import { bridgeCredentialValid } from "./interactions.js";
import { store } from "./store.js";
import { tenantId } from "./tenant-context.js";
import { isTenantMember } from "./tenants.js";

/*
 * Client of the separately deployed secret vault (see vault/). Beezy decides whose secrets a request
 * may touch: people manage their own per tenant, and an agent reads its session owner's through the
 * session's bridge credential. Values never pass through Beezy's own storage.
 */

export interface SecretInfo {
	key: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

const keySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Keys are letters, digits and underscores, starting with a letter or underscore (max 64)");
const namespaceOf = (tenant: string, userId: string) => `${tenant}.${userId}`;

export const vaultConfigured = () => Boolean(config.vaultUrl && config.vaultToken);

async function vault<T>(method: string, namespace: string, key?: string, body?: unknown): Promise<T> {
	if (!vaultConfigured()) throw new HttpError(503, "The secret vault is not configured (set VAULT_URL and VAULT_TOKEN)");
	const url = `${config.vaultUrl.replace(/\/+$/, "")}/v1/namespaces/${encodeURIComponent(namespace)}/secrets${key ? `/${encodeURIComponent(key)}` : ""}`;
	let response: globalThis.Response;
	try {
		response = await fetch(url, {
			method,
			headers: { Authorization: `Bearer ${config.vaultToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(10_000),
		});
	} catch (error) {
		throw new HttpError(502, `The secret vault is unreachable: ${(error as Error).message}`);
	}
	const result = (await response.json().catch(() => ({}))) as { error?: string };
	if (!response.ok) throw new HttpError(response.status === 401 ? 502 : response.status, response.status === 401 ? "The vault rejected Beezy's VAULT_TOKEN" : (result.error ?? `Vault error ${response.status}`));
	return result as T;
}

export function vaultRoutes(): Router {
	const router = express.Router();
	router.use("/vault", requireAuth);
	const mine = (userId: string) => namespaceOf(tenantId(), userId);

	router.get("/vault/status", async (_req, res) => {
		if (!vaultConfigured()) return void res.json({ configured: false, reachable: false });
		const reachable = await fetch(`${config.vaultUrl.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
		res.json({ configured: true, reachable });
	});

	router.get("/vault/secrets", async (req, res) => {
		res.json(await vault<{ secrets: SecretInfo[] }>("GET", mine(req.user!.id)));
	});

	router.get("/vault/secrets/:key", async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(await vault("GET", mine(req.user!.id), keySchema.parse(req.params.key)));
	});

	router.put("/vault/secrets/:key", async (req, res) => {
		const body = z.object({ value: z.string().min(1).max(64 * 1024).optional(), description: z.string().trim().max(300).default("") }).strict().parse(req.body);
		res.json(await vault<SecretInfo>("PUT", mine(req.user!.id), keySchema.parse(req.params.key), body));
	});

	router.delete("/vault/secrets/:key", async (req, res) => {
		res.json(await vault("DELETE", mine(req.user!.id), keySchema.parse(req.params.key)));
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
		res.json(await vault("GET", ownerNamespace(String(req.params.key), req.headers.authorization)));
	});
	router.get("/vault-bridge/:key/:secret", async (req, res) => {
		const namespace = ownerNamespace(String(req.params.key), req.headers.authorization);
		const { key, value } = await vault<{ key: string; value: string }>("GET", namespace, keySchema.parse(req.params.secret));
		res.setHeader("Cache-Control", "no-store");
		res.json({ key, value });
	});

	return router;
}
