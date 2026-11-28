import { Router, type RequestHandler } from "express";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { HttpError } from "./paths.js";
import { canManagePiProfile, hasPiCodex, savePiCodex } from "./pi-profiles.js";

async function login(signal: AbortSignal, showCode: (code: string) => void) {
	const models = createModels();
	models.setProvider(openaiCodexProvider());
	const credential = await models.login("openai-codex", "oauth", {
		signal,
		prompt: async prompt => {
			if (prompt.type === "select" && prompt.options.some(option => option.id === "device_code")) return "device_code";
			throw new Error("Pi did not offer Codex device sign-in");
		},
		notify: event => { if (event.type === "device_code") showCode(event.userCode); },
	});
	if (credential.type !== "oauth") throw new Error("Expected a Codex OAuth credential");
	return credential;
}

export function piCodexLoginRoutes(requireAuth: RequestHandler, authenticate = login) {
	const router = Router();
	const flows = new Map<string, { controller: AbortController; code?: string }>();
	const failures = new Set<string>();
	router.use("/auth/pi-codex", requireAuth, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
	router.get("/auth/pi-codex", async (req, res) => {
		const id = req.user!.id;
		const [connected, manageable] = await Promise.all([hasPiCodex(id), canManagePiProfile(id)]);
		const flow = flows.get(id);
		res.json({ connected, manageable, pending: Boolean(flow), code: flow?.code, failed: failures.has(id) });
	});
	router.post("/auth/pi-codex", async (req, res) => {
		const id = req.user!.id;
		if (!await canManagePiProfile(id)) throw new HttpError(409, "Your Pi profile is managed by the administrator");
		if (flows.has(id)) return void res.json({ ok: true });
		if (flows.size >= 12) throw new HttpError(429, "Too many sign-ins in progress");
		failures.delete(id);
		const flow: { controller: AbortController; code?: string } = { controller: new AbortController() };
		flows.set(id, flow);
		const { signal } = flow.controller;
		const timeout = setTimeout(() => flow.controller.abort(), 15 * 60_000);
		timeout.unref();
		void authenticate(signal, code => { if (!signal.aborted) flow.code = code; }).then(async credential => {
			signal.throwIfAborted();
			await savePiCodex(id, credential);
		}).catch(() => {
			// Provider errors may contain private response bodies. Never log or return them.
			if (flows.get(id) === flow) failures.add(id);
		}).finally(() => {
			clearTimeout(timeout);
			if (flows.get(id) === flow) flows.delete(id);
		});
		res.json({ ok: true });
	});
	router.delete("/auth/pi-codex", (req, res) => {
		const id = req.user!.id;
		const flow = flows.get(id);
		flows.delete(id);
		flow?.controller.abort();
		failures.delete(id);
		res.json({ ok: true });
	});
	return router;
}
