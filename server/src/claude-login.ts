import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { HttpError } from "./paths.js";

export const claudeBinary = process.env.BEEZY_CLAUDE_BINARY ?? "";
export const claudeAccountDir = (id: string) => path.join(config.dataDir, "claude-accounts", Buffer.from(id).toString("hex"));
export function claudeEnv(env = process.env) {
	return Object.fromEntries(["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]
		.flatMap(key => env[key] === undefined ? [] : [[key, env[key]]]));
}
export function claudeAccountEnv(id: string) {
	const dir = claudeAccountDir(id);
	return { ...claudeEnv(), HOME: dir, XDG_CONFIG_HOME: dir, XDG_DATA_HOME: dir, XDG_RUNTIME_DIR: undefined, DBUS_SESSION_BUS_ADDRESS: undefined, CLAUDE_CONFIG_DIR: dir };
}
export async function claudeConnected(binary: string, env: NodeJS.ProcessEnv, cwd: string) {
	try {
		const { stdout } = await promisify(execFile)(binary, ["auth", "status", "--json"], { cwd, env, timeout: 8000, maxBuffer: 32_768 });
		const auth = JSON.parse(stdout);
		return auth.loggedIn === true && auth.authMethod === "claude.ai" && ["pro", "max", "max_5x", "max_20x"].includes(auth.subscriptionType);
	} catch { return false; }
}

type Flow = { child: ChildProcessWithoutNullStreams; url?: string; timer: NodeJS.Timeout; submitted?: boolean };
export function claudeLoginRoutes(requireAuth: import("express").RequestHandler) {
	const router = Router();
	const flows = new Map<string, Flow>();
	const supported = path.isAbsolute(claudeBinary);
	const stop = (id: string, flow: Flow) => {
		if (flows.get(id) !== flow) return;
		flows.delete(id);
		clearTimeout(flow.timer);
		if (flow.child.exitCode === null && flow.child.signalCode === null) flow.child.kill("SIGKILL");
	};
	router.use("/auth/claude", requireAuth, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
	router.get("/auth/claude", async (req, res) => {
		const id = req.user!.id;
		const flow = flows.get(id);
		res.json({ supported, pending: Boolean(flow), url: flow?.url, connected: supported && !flow && await claudeConnected(claudeBinary, claudeAccountEnv(id), claudeAccountDir(id)) });
	});
	router.post("/auth/claude", async (req, res) => {
		if (!supported) throw new HttpError(503, "Claude Code is not configured on this server");
		const id = req.user!.id;
		const dir = claudeAccountDir(id);
		await mkdir(dir, { recursive: true, mode: 0o700 });
		if (flows.has(id)) return void res.json({ ok: true });
		if (flows.size >= 12) throw new HttpError(429, "Too many sign-ins in progress");
		const child = spawn(claudeBinary, ["auth", "login"], { cwd: dir, env: { ...claudeAccountEnv(id), BROWSER: "/bin/false" }, stdio: "pipe" });
		const flow: Flow = { child, timer: setTimeout(() => stop(id, flow), 5 * 60_000) };
		flow.timer.unref();
		flows.set(id, flow);
		child.stdin.on("error", () => {});
		child.once("error", () => stop(id, flow));
		child.once("close", () => stop(id, flow));
		for (const stream of [child.stdout, child.stderr]) {
			let output = "";
			stream.setEncoding("utf8");
			stream.on("data", (chunk: string) => {
				if (flow.url) return;
				output = (output + chunk).slice(-16_384);
				const url = /(?:^|\s)(https:\/\/claude\.ai\/oauth\/authorize\?[^\s]+)\s/.exec(output)?.[1];
				if (url) { flow.url = url; output = ""; }
			});
		}
		res.json({ ok: true });
	});
	router.put("/auth/claude", (req, res) => {
		const { code } = z.object({ code: z.string().trim().regex(/^[!-~]{1,2048}$/) }).parse(req.body);
		const flow = flows.get(req.user!.id);
		if (!flow?.url || flow.submitted) throw new HttpError(409, "Start a new Claude sign-in first");
		flow.submitted = true;
		flow.child.stdin.write(`${code}\n`);
		res.json({ ok: true });
	});
	router.delete("/auth/claude", (req, res) => {
		const id = req.user!.id;
		const flow = flows.get(id);
		if (flow) stop(id, flow);
		res.json({ ok: true });
	});
	return router;
}
