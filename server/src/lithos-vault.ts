import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { config } from "./config.js";
import { platform } from "./ports/index.js";
import { tenantId } from "./tenant-context.js";

const model = "deepseek-ai/DeepSeek-V4.1-Flash-ultra";
const secretNames = ["LITHOS_KEY", "LITHOS_Key"];
const tokens = new Map<string, { namespace: string; key: string }>();
const profiles = new Map<string, Promise<string>>();

export async function lithosVaultProfile(userId: string) {
	const vault = platform().secrets;
	if (!vault.configured()) return;
	const namespace = `${tenantId()}.${userId}`;
	const entries = await vault.list(namespace);
	const key = secretNames.find(name => entries.some(entry => entry.key === name));
	if (!key) return;
	const scope = `${namespace}/${key}`;
	let profile = profiles.get(scope);
	if (!profile) {
		profile = createProfile(namespace, key);
		profiles.set(scope, profile);
	}
	try { return await profile; }
	catch (error) { profiles.delete(scope); throw error; }
}

async function createProfile(namespace: string, key: string) {
	const token = randomBytes(32).toString("hex");
	const dir = path.join(config.dataDir, "pi-lithos-vault", Buffer.from(`${namespace}/${key}`).toString("hex"));
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const file = path.join(dir, "models.json");
	const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
	await writeFile(temp, JSON.stringify({ providers: { lithosai: {
		baseUrl: `http://127.0.0.1:${config.port}/api/internal/lithos/v1`, api: "openai-completions", apiKey: token,
		models: [{ id: model, reasoning: true, contextWindow: 1048576, maxTokens: 393216,
			thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
			compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true, maxTokensField: "max_tokens" } }],
	} } }), { mode: 0o600, flag: "wx" });
	await rename(temp, file);
	tokens.set(token, { namespace, key });
	return dir;
}

export async function lithosCompletion(req: Request, res: Response) {
	const token = req.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
	const credential = token && tokens.get(token);
	if (!credential || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") || req.get("host") !== `127.0.0.1:${config.port}`) {
		return void res.sendStatus(404);
	}
	if (req.body?.model !== model) return void res.sendStatus(400);
	const abort = new AbortController();
	res.once("close", () => abort.abort());
	try {
		const { value } = await platform().secrets.get(credential.namespace, credential.key);
		const upstream = await fetch("https://api.lithosai.cloud/v1/chat/completions", {
			method: "POST", redirect: "error", signal: abort.signal,
			headers: { authorization: `Bearer ${value}`, "content-type": "application/json" }, body: JSON.stringify(req.body),
		});
		res.status(upstream.status);
		res.setHeader("Cache-Control", "no-store");
		if (!upstream.ok) {
			await upstream.body?.cancel();
			return void res.json({ error: { message: `LithosAI rejected the request (HTTP ${upstream.status})` } });
		}
		res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
		if (upstream.body) await pipeline(Readable.from(upstream.body), res);
		else res.end();
	} catch {
		if (!res.destroyed && !res.headersSent) res.status(502).json({ error: { message: "LithosAI or the Personal vault is unavailable" } });
		else if (!res.destroyed) res.destroy();
	}
}
