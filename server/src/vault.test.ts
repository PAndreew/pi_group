import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import express from "express";

test("people manage their own vault secrets; an agent reads its session owner's by key", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-vault-"));
	const token = randomBytes(24).toString("hex");
	// The real vault service, in process. Imported by URL: it lives outside this package.
	const vaultSrc = path.resolve(import.meta.dirname, "..", "..", "vault", "src");
	const { createVaultServer } = await import(pathToFileURL(path.join(vaultSrc, "server.mjs")).href);
	const { SecretStore } = await import(pathToFileURL(path.join(vaultSrc, "store.mjs")).href);
	const secrets = new SecretStore(":memory:", randomBytes(32));
	const vault: Server = createVaultServer({ store: secrets, token });
	vault.listen(0, "127.0.0.1");
	await once(vault, "listening");
	const vaultAddress = vault.address();
	assert.ok(vaultAddress && typeof vaultAddress !== "string");

	process.env.DATA_DIR = dir;
	process.env.VAULT_URL = `http://127.0.0.1:${vaultAddress.port}`;
	process.env.VAULT_TOKEN = token;
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, saveNow, store } = await import("./store.js");
	const { interactionEnvironment } = await import("./interactions.js");
	const { vaultRoutes } = await import("./vault.js");
	assert.equal(process.env.VAULT_TOKEN, undefined, "child processes cannot inherit the vault token");
	loadStore();
	const anna = createUser("vault-anna", "test-password", "member");
	const bob = createUser("vault-bob", "test-password", "member");
	for (const tenant of store.data.tenants) tenant.memberIds.push(anna.id, bob.id);
	store.upsertSession({ key: "pi:s1", harness: "pi", id: "s1", cwd: dir, ownerId: anna.id, visibility: "shared", shares: [{ userId: bob.id, access: "write" }] });

	const app = express();
	app.use(express.json(), authenticate, authRoutes(), vaultRoutes());
	app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		res.status(error.status ?? (error.name === "ZodError" ? 400 : 500)).json({ error: error.message });
	});
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	const login = async (username: string) => {
		const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		return response.headers.get("set-cookie")!.split(";")[0];
	};
	const call = async (cookie: string, method: string, url: string, body?: unknown) => {
		const response = await fetch(`${base}${url}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json", "X-Pi-Group": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
		return { status: response.status, body: await response.json() };
	};
	try {
		const annaCookie = await login(anna.username);
		const bobCookie = await login(bob.username);
		assert.deepEqual((await call(annaCookie, "GET", "/vault/status")).body, { configured: true, reachable: true });
		assert.equal((await call(annaCookie, "PUT", "/vault/secrets/GITHUB_TOKEN", { value: "ghp_anna", description: "GitHub for acme" })).status, 200);
		assert.equal((await call(annaCookie, "PUT", "/vault/secrets/bad-key", { value: "x" })).status, 400);
		assert.deepEqual((await call(annaCookie, "GET", "/vault/secrets")).body.secrets.map((s: { key: string }) => s.key), ["GITHUB_TOKEN"]);
		assert.deepEqual((await call(bobCookie, "GET", "/vault/secrets")).body.secrets, [], "each person has their own vault");
		assert.equal((await call(bobCookie, "GET", "/vault/secrets/GITHUB_TOKEN")).status, 404);

		// The agent of anna's session, even when bob prompts it, sees anna's keys and reads a value by key.
		const bridge = interactionEnvironment("pi:s1");
		assert.ok(bridge.BEEZY_VAULT_URL);
		const agent = (suffix: string, credential = bridge.BEEZY_INTERACTION_TOKEN) => fetch(`${base}/vault-bridge/${encodeURIComponent("pi:s1")}${suffix}`, { headers: { Authorization: `Bearer ${credential}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));
		assert.deepEqual((await agent("")).body.secrets.map((s: { key: string; description: string; value?: string }) => [s.key, s.description, s.value]), [["GITHUB_TOKEN", "GitHub for acme", undefined]]);
		assert.deepEqual((await agent("/GITHUB_TOKEN")).body, { key: "GITHUB_TOKEN", value: "ghp_anna" });
		assert.equal((await agent("/GITHUB_TOKEN", "forged")).status, 403);

		assert.equal((await call(annaCookie, "DELETE", "/vault/secrets/GITHUB_TOKEN")).status, 200);
		assert.equal((await agent("/GITHUB_TOKEN")).status, 404);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await new Promise<void>((resolve) => vault.close(() => resolve()));
		secrets.close();
		saveNow();
		rmSync(dir, { recursive: true, force: true });
	}
});
