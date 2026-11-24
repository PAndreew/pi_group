import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "./auth.js";
import { HttpError } from "./files.js";
import { save, store } from "./store.js";
import { tenantId } from "./tenant-context.js";

/*
 * Remote machines this Beezy server can reach, SSH first. Hosts of ~/.ssh/config are discovered and
 * added automatically (named after their alias); others are added by hand with a host, user, port
 * and key. People refer to a machine as #name in a message; the agent then gets how to reach it.
 */

export interface RemoteMachine {
	id: string;
	/** What people type after #: letters, digits, dot, dash, underscore. */
	name: string;
	/** The Host alias in ~/.ssh/config, for discovered machines (ssh resolves the rest). */
	alias?: string;
	host?: string;
	user?: string;
	port?: number;
	/** Private key path, ~ allowed. */
	identityFile?: string;
	source: "ssh-config" | "manual";
	/** A discovered machine someone removed; kept so discovery does not bring it back. */
	hidden?: boolean;
	createdAt: string;
}

export type MachineState = "online" | "auth" | "offline" | "unknown";
export interface MachineStatus { state: MachineState; checkedAt?: string; detail?: string }

export const NAME = /^[A-Za-z0-9][\w.-]{0,39}$/;
const sshDir = () => path.join(os.homedir(), ".ssh");
const tilde = (p: string) => (p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p);
const untilde = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

/** Concrete Host aliases of an ssh config (patterns skipped), following simple Include lines. */
export function parseSshConfigHosts(text: string, include?: (pattern: string) => string[]): string[] {
	const hosts: string[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		const match = /^(\w+)\s*=?\s*(.*)$/.exec(line);
		if (!match || line.startsWith("#")) continue;
		const [, key, value] = match;
		if (key.toLowerCase() === "include" && include) for (const file of value.split(/\s+/).flatMap(include)) hosts.push(...parseSshConfigHosts(file));
		if (key.toLowerCase() !== "host") continue;
		for (const name of value.split(/\s+/)) if (name && !/[*?!]/.test(name)) hosts.push(name);
	}
	return [...new Set(hosts)];
}

function readIncludes(pattern: string): string[] {
	const full = path.isAbsolute(untilde(pattern)) ? untilde(pattern) : path.join(sshDir(), pattern);
	if (!/[*?]/.test(full)) return existsSync(full) ? [readFileSync(full, "utf8")] : [];
	const dir = path.dirname(full);
	const re = new RegExp(`^${path.basename(full).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
	try { return readdirSync(dir).filter((f) => re.test(f)).map((f) => readFileSync(path.join(dir, f), "utf8")); } catch { return []; }
}

export function discoverAliases(): string[] {
	const file = path.join(sshDir(), "config");
	if (!existsSync(file)) return [];
	try { return parseSshConfigHosts(readFileSync(file, "utf8"), readIncludes); } catch { return []; }
}

/** Private keys in ~/.ssh, by their first line. */
export function discoverKeys(): { path: string; type: string; comment?: string }[] {
	let files: string[];
	try { files = readdirSync(sshDir()); } catch { return []; }
	const keys = [];
	for (const name of files) {
		const file = path.join(sshDir(), name);
		try {
			if (!statSync(file).isFile() || statSync(file).size > 32_000) continue;
			const head = readFileSync(file, "utf8").slice(0, 80);
			if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(head)) continue;
			const pub = existsSync(`${file}.pub`) ? readFileSync(`${file}.pub`, "utf8").trim().split(/\s+/) : [];
			keys.push({ path: tilde(file), type: pub[0]?.replace(/^ssh-/, "") ?? head.match(/BEGIN ([A-Z]+ )?PRIVATE/)?.[1]?.trim().toLowerCase() ?? "key", comment: pub.slice(2).join(" ") || undefined });
		} catch { /* unreadable */ }
	}
	return keys;
}

/** Plain (unhashed) host names in known_hosts, as suggestions for adding a machine. */
export function knownHosts(): string[] {
	try {
		const text = readFileSync(path.join(sshDir(), "known_hosts"), "utf8");
		const hosts = text.split("\n").map((l) => l.split(/\s+/)[0]).filter((h) => h && !h.startsWith("|") && !h.startsWith("#") && !h.startsWith("@"));
		return [...new Set(hosts.flatMap((h) => h.split(",")).map((h) => h.replace(/^\[([^\]]+)\]:\d+$/, "$1")))].slice(0, 200);
	} catch { return []; }
}

const list = () => {
	store.data.remoteMachines ??= {};
	return (store.data.remoteMachines[tenantId()] ??= []);
};

const uniqueName = (wanted: string, taken: RemoteMachine[]) => {
	const base = (wanted.replace(/[^\w.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "machine").slice(0, 36);
	let name = base;
	for (let i = 2; taken.some((m) => m.name.toLowerCase() === name.toLowerCase()); i++) name = `${base}-${i}`;
	return name;
};

/** The tenant's machines, with newly discovered ssh config hosts added under their alias. */
export function machines(): RemoteMachine[] {
	const all = list();
	let changed = false;
	for (const alias of discoverAliases()) {
		if (all.some((m) => m.alias === alias)) continue;
		all.push({ id: randomUUID(), name: uniqueName(alias, all), alias, source: "ssh-config", createdAt: new Date().toISOString() });
		changed = true;
	}
	if (changed) save();
	return all.filter((m) => !m.hidden);
}

/** Where ssh connects: the alias, or user@host. */
export const destination = (m: RemoteMachine) => m.alias ?? (m.user ? `${m.user}@${m.host}` : m.host!);

/** The ssh command line people and agents use for a machine. */
export function sshCommand(m: RemoteMachine) {
	const parts = ["ssh"];
	if (!m.alias && m.port && m.port !== 22) parts.push("-p", String(m.port));
	if (!m.alias && m.identityFile) parts.push("-i", m.identityFile);
	parts.push(destination(m));
	return parts.join(" ");
}

/** Resolved settings of an alias (`ssh -G`), for showing where it goes. */
function resolveAlias(alias: string): Promise<{ host?: string; user?: string; port?: number; identityFile?: string }> {
	return new Promise((resolve) => execFile("ssh", ["-G", "--", alias], { timeout: 3000 }, (error, stdout) => {
		if (error) return resolve({});
		const get = (key: string) => stdout.match(new RegExp(`^${key} (.+)$`, "m"))?.[1];
		const identity = stdout.match(/^identityfile (.+)$/gm)?.map((l) => l.slice(13)).find((f) => existsSync(untilde(f)));
		resolve({ host: get("hostname"), user: get("user"), port: Number(get("port")) || undefined, identityFile: identity ? tilde(untilde(identity)) : undefined });
	}));
}

const statuses = new Map<string, MachineStatus>();
const checking = new Map<string, Promise<MachineStatus>>();
const STALE_MS = 60_000;

/** Tries a non-interactive login: online when it works, auth when the host answers but refuses the key. */
export function checkMachine(m: RemoteMachine): Promise<MachineStatus> {
	const running = checking.get(m.id);
	if (running) return running;
	const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1"];
	if (!m.alias && m.port) args.push("-p", String(m.port));
	if (!m.alias && m.identityFile) args.push("-i", untilde(m.identityFile), "-o", "IdentitiesOnly=yes");
	args.push("--", destination(m), "true");
	const env: Record<string, string> = {};
	for (const key of ["PATH", "HOME", "USER", "LOGNAME", "SSH_AUTH_SOCK", "LANG"]) if (process.env[key] !== undefined) env[key] = process.env[key]!;
	const done = new Promise<MachineStatus>((resolve) => execFile("ssh", args, { timeout: 12_000, env }, (error, _stdout, stderr) => {
		const detail = String(stderr).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 200);
		const state: MachineState = !error ? "online" : /permission denied|host key verification failed|too many authentication|no more authentication/i.test(String(stderr)) ? "auth" : "offline";
		resolve({ state, checkedAt: new Date().toISOString(), detail: state === "online" ? undefined : detail || (error as Error).message });
	})).then((status) => { statuses.set(m.id, status); checking.delete(m.id); return status; });
	checking.set(m.id, done);
	return done;
}

const statusOf = (m: RemoteMachine): MachineStatus => statuses.get(m.id) ?? { state: "unknown" };
const stale = (m: RemoteMachine) => { const s = statuses.get(m.id); return !s?.checkedAt || Date.now() - Date.parse(s.checkedAt) > STALE_MS; };

async function view(m: RemoteMachine) {
	const resolved = m.alias ? await resolveAlias(m.alias) : {};
	return { ...m, host: m.host ?? resolved.host, user: m.user ?? resolved.user, port: m.port ?? resolved.port, identityFile: m.identityFile ?? resolved.identityFile, ssh: sshCommand(m), status: statusOf(m) };
}

/** `#name` tokens in a message that name machines, for telling the agent how to reach them. */
export function referencedMachines(text: string): RemoteMachine[] {
	const names = new Set([...text.matchAll(/(^|[\s(`])#([A-Za-z0-9][\w.-]*)/g)].map((m) => m[2].replace(/[.-]+$/, "").toLowerCase()));
	if (!names.size) return [];
	return machines().filter((m) => names.has(m.name.toLowerCase()));
}

export const REMOTE_OPEN = "\n\n<remote-machines>\n";
export const REMOTE_CLOSE = "\n</remote-machines>";

/** The note put after a prompt that mentions machines; the web hides it like project memory. */
export function remoteMachinesNote(text: string): string {
	const found = referencedMachines(text);
	if (!found.length) return "";
	const lines = found.map((m) => {
		const where = m.alias ? `ssh config alias \`${m.alias}\`` : `${m.user ? `${m.user}@` : ""}${m.host}${m.port && m.port !== 22 ? ` port ${m.port}` : ""}${m.identityFile ? `, key ${m.identityFile}` : ""}`;
		const watch = m.alias || !m.identityFile ? ` process_watch host: \`${destination(m)}\`${!m.alias && m.port && m.port !== 22 ? ` port ${m.port}` : ""}.` : "";
		const status = statusOf(m).state;
		return `- #${m.name}: ${where}. Run commands with \`${sshCommand(m)} '<command>'\` (non-interactive, keys only).${watch}${status !== "unknown" ? ` Last check: ${status}.` : ""}`;
	});
	return `${REMOTE_OPEN}Remote machines referenced with # (reachable from this server over SSH):\n${lines.join("\n")}${REMOTE_CLOSE}`;
}

const machineSchema = z.object({
	name: z.string().trim().regex(NAME, "Names are letters, digits, dots, dashes and underscores (max 40), starting with a letter or digit"),
	host: z.string().trim().min(1).max(255).regex(/^[^\s@'"`;]+$/, "Host without spaces or @"),
	user: z.string().trim().max(64).regex(/^[^\s@'"`;]*$/).optional(),
	port: z.number().int().min(1).max(65535).optional(),
	identityFile: z.string().trim().max(1000).regex(/^[^'"`;]*$/).optional(),
});

export function remoteMachineRoutes(): Router {
	const router = express.Router();
	router.use("/remote-machines", requireAuth);

	router.get("/remote-machines", async (req, res) => {
		const all = machines();
		for (const m of all) if (stale(m)) void checkMachine(m);
		const admin = req.user!.role === "admin";
		res.json({ machines: await Promise.all(all.map(view)), keys: admin ? discoverKeys() : [], suggestions: admin ? knownHosts() : [], canEdit: admin });
	});

	/** Checks every machine now (or one with `id`) and answers when done. */
	router.post("/remote-machines/check", async (req, res) => {
		const { id } = z.object({ id: z.string().optional() }).parse(req.body ?? {});
		const all = machines().filter((m) => !id || m.id === id);
		await Promise.all(all.map(checkMachine));
		res.json({ machines: await Promise.all(all.map(view)) });
	});

	router.post("/remote-machines", requireAdmin, (req, res) => {
		const body = machineSchema.parse(req.body);
		const all = list();
		if (machines().some((m) => m.name.toLowerCase() === body.name.toLowerCase())) throw new HttpError(409, `#${body.name} is taken`);
		const machine: RemoteMachine = { id: randomUUID(), ...body, user: body.user || undefined, identityFile: body.identityFile || undefined, source: "manual", createdAt: new Date().toISOString() };
		all.push(machine);
		save();
		void checkMachine(machine);
		res.json({ machine });
	});

	router.patch("/remote-machines/:id", requireAdmin, (req, res) => {
		const machine = list().find((m) => m.id === req.params.id && !m.hidden);
		if (!machine) throw new HttpError(404, "No such machine");
		const body = (machine.source === "manual" ? machineSchema.partial() : machineSchema.pick({ name: true }).partial()).parse(req.body);
		if (body.name && machines().some((m) => m.id !== machine.id && m.name.toLowerCase() === body.name!.toLowerCase())) throw new HttpError(409, `#${body.name} is taken`);
		Object.assign(machine, body);
		if ("user" in body && !body.user) delete machine.user;
		if ("identityFile" in body && !body.identityFile) delete machine.identityFile;
		save();
		statuses.delete(machine.id);
		res.json({ machine });
	});

	router.delete("/remote-machines/:id", requireAdmin, (req, res) => {
		const all = list();
		const index = all.findIndex((m) => m.id === req.params.id);
		if (index < 0) throw new HttpError(404, "No such machine");
		// Discovered ones stay hidden, so the next discovery does not add them again.
		if (all[index].source === "ssh-config") all[index].hidden = true;
		else all.splice(index, 1);
		save();
		res.json({ ok: true });
	});

	return router;
}
