import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";

test("Cloudflare credentials resolve from the actor's tenant vault, rotate, and never reach agent tools or storage", async () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-cf-vault-"));
	process.env.DATA_DIR = dir;
	process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
	process.env.CLOUDFLARE_API_TOKEN = "";
	process.env.CLOUDFLARE_VAULT_KEY = "CLOUDFLARE_WORKER_KEY";
	const { config } = await import("./config.js");
	const { platform, setPlatform } = await import("./ports/index.js");
	const { loadStore, store, saveNow } = await import("./store.js");
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { vaultRoutes } = await import("./vault.js");
	const { interactionEnvironment } = await import("./interactions.js");
	const { assistanceDefaults } = await import("./preferences.js");
	const { resolveCloudflareCredential, prepareAssistance, guardPrompt, mountAssistance } = await import("./assistance.js");
	const originalPlatform = platform();
	const secrets = new Map<string, string>();
	const reads: string[] = [];
	let duringRead: (() => void) | undefined;
	setPlatform({ ...originalPlatform, secrets: {
		configured: () => true,
		reachable: async () => true,
		list: async namespace => [...secrets.keys()].filter(key => key.startsWith(`${namespace}/`)).map(key => ({ key: key.slice(namespace.length + 1), description: "", createdAt: "", updatedAt: "" })),
		get: async (namespace, key) => {
			reads.push(`${namespace}/${key}`);
			const hook = duringRead; duringRead = undefined; hook?.();
			const value = secrets.get(`${namespace}/${key}`);
			if (!value) throw new Error("private vault response must not be echoed");
			return { key, value, description: "", createdAt: "", updatedAt: "" };
		},
		put: async () => { throw new Error("Unexpected vault write"); },
		delete: async () => { throw new Error("Unexpected vault deletion"); },
	} });
	loadStore();
	const actor = createUser("cf-owner", "test-password", "member");
	const other = createUser("cf-other", "test-password", "member");
	const meta = store.upsertSession({ key: "pi:cf-vault", harness: "pi", id: "cf-vault", cwd: dir, ownerId: actor.id });
	store.data.tenants.push({ id: "family", name: "Family", root: dir, chatFolder: dir, memberIds: [actor.id] });
	const key = config.cloudflareVaultKey;
	secrets.set(`work.${actor.id}/${key}`, "fake-token-first");
	secrets.set(`work.${actor.id}/ORDINARY_KEY`, "ordinary-secret");
	secrets.set(`family.${actor.id}/${key}`, "fake-token-family");
	const originalFetch = globalThis.fetch;
	const sentTokens: string[] = [];
	globalThis.fetch = async (input, init) => {
		if (!String(input).startsWith("https://api.cloudflare.com/")) return originalFetch(input, init);
		sentTokens.push((init?.headers as Record<string, string>).Authorization);
		assert.equal(String(init?.body).includes("fake-token"), false);
		return Response.json({ success: true, result: { answers: { injection: { type: "noul", noul: .01 } }, usage: { input_tokens: 100, output_tokens: 0 } } });
	};
	const app = express();
	app.use(express.json(), authenticate, authRoutes(), vaultRoutes());
	mountAssistance(app, (user, session) => user.id === session.ownerId);
	app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;
	try {
		await guardPrompt(prepareAssistance(meta, actor, false), "disabled prompt");
		assert.equal(reads.length, 0, "all off must not resolve any token");
		assert.equal(sentTokens.length, 0);
		assert.equal((await resolveCloudflareCredential(actor.id, "work")).apiToken, "fake-token-first");
		assert.equal((await resolveCloudflareCredential(actor.id, "family")).apiToken, "fake-token-family");
		await assert.rejects(resolveCloudflareCredential(other.id, "work"), error => /credential unavailable/.test(String(error)) && !String(error).includes("private vault response"));
		await assert.rejects(resolveCloudflareCredential(other.id, "family"), /unavailable/);

		actor.assistance = { ...assistanceDefaults, injectionChecks: true };
		const run = prepareAssistance(meta, actor, false);
		await guardPrompt(run, "first prompt");
		secrets.set(`work.${actor.id}/${key}`, "fake-token-rotated");
		await guardPrompt(run, "second prompt");
		assert.deepEqual(sentTokens, ["Bearer fake-token-first", "Bearer fake-token-rotated"]);
		secrets.delete(`work.${actor.id}/${key}`);
		const calls = actor.assistanceMeter!.calls;
		const cost = actor.assistanceMeter!.cost;
		await assert.rejects(guardPrompt(run, "third prompt"), /vault credential unavailable/);
		assert.equal(actor.assistanceMeter!.calls, calls, "missing vault credentials must not be billed/reserved");
		assert.equal(actor.assistanceMeter!.cost, cost);
		secrets.set(`work.${actor.id}/${key}`, "fake-token-rotated");
		actor.assistance = { ...assistanceDefaults, injectionChecks: true, contextExtraction: true };
		const changing = prepareAssistance(meta, actor, false);
		duringRead = () => { actor.assistance!.injectionChecks = false; };
		await assert.rejects(guardPrompt(changing, "disabled during vault lookup"), /assistance is off/);
		assert.equal(sentTokens.length, 2, "disabling one feature during vault lookup must stop its dispatch even when another remains on");
		assert.equal(actor.assistanceMeter!.calls, calls);
		actor.assistance = { ...assistanceDefaults, injectionChecks: true };

		const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: actor.username, password: "test-password" }) });
		const cookie = login.headers.get("set-cookie")!.split(";")[0];
		const status = await (await fetch(`${base}/assistance/status`, { headers: { Cookie: cookie } })).json();
		assert.equal(status.configured, true);
		assert.equal(status.credentialSource, "vault");
		assert.equal(status.vaultKey, key);
		assert.equal(JSON.stringify(status).includes("fake-token"), false);
		const bridge = `${base}/vault-bridge/${encodeURIComponent(meta.key)}`;
		const headers = { Authorization: `Bearer ${interactionEnvironment(meta.key).BEEZY_INTERACTION_TOKEN}` };
		const listed = await (await fetch(bridge, { headers })).json();
		assert.deepEqual(listed.secrets.map((s: any) => s.key), ["ORDINARY_KEY"]);
		assert.equal((await fetch(`${bridge}/${key}`, { headers })).status, 403);
		assert.equal((await fetch(`${bridge}/ORDINARY_KEY`, { headers })).status, 200);
		saveNow();
		assert.equal(JSON.stringify(platform().documents.load("db")).includes("fake-token"), false, "token values must never enter app storage");
		assert.equal(process.env.CLOUDFLARE_API_TOKEN, undefined);
	} finally {
		globalThis.fetch = originalFetch;
		await new Promise<void>(resolve => server.close(() => resolve()));
		saveNow();
		setPlatform(originalPlatform);
		rmSync(dir, { recursive: true, force: true });
	}
});
