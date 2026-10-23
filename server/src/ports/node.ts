import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { HttpError, resolveSafe, toRel } from "../paths.js";
import type { Capability, Platform, Realtime, SandboxProcess, SecretInfo, Secrets, SqlDatabase, WorkspaceStorage } from "./index.js";

/** Self-hosted adapters: files in DATA_DIR and FS_ROOT, SQLite, local processes, in-memory fan-out. */
export function nodePlatform(): Platform {
	return {
		documents: {
			load(name) {
				try {
					return JSON.parse(readFileSync(documentFile(name), "utf8"));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
					throw error;
				}
			},
			save(name, doc) {
				const file = documentFile(name);
				mkdirSync(path.dirname(file), { recursive: true });
				const tmp = `${file}.tmp`;
				writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
				renameSync(tmp, file);
			},
		},
		openSql(name) {
			mkdirSync(config.dataDir, { recursive: true });
			return new DatabaseSync(path.join(config.dataDir, `${name}.sqlite`)) as unknown as SqlDatabase;
		},
		sqlExists: (name) => existsSync(path.join(config.dataDir, `${name}.sqlite`)),
		storage: localStorage,
		realtime: memoryRealtime(),
		sandbox: {
			spawn(command, args, options) {
				return localProcess(command, args, options);
			},
		},
		scheduler: {
			every(ms, task, firstAfterMs = ms) {
				const first = setTimeout(task, firstAfterMs).unref();
				const repeat = setInterval(task, ms).unref();
				return () => {
					clearTimeout(first);
					clearInterval(repeat);
				};
			},
		},
		secrets: httpVault,
		models: {
			info: () => Object.fromEntries((["triage", "extract", "stt", "tts", "embed"] as Capability[]).map((c) => [c, { provider: "none" }])) as ReturnType<Platform["models"]["info"]>,
		},
	};
}

const documentFile = (name: string) => path.join(config.dataDir, `${name}.json`);

const localStorage: WorkspaceStorage = {
	async list(rel) {
		const dir = resolveSafe(rel);
		const dirents = await fs.readdir(dir, { withFileTypes: true });
		const entries = await Promise.all(
			dirents.map(async (d) => {
				const full = path.join(dir, d.name);
				try {
					const stat = await fs.stat(full);
					return { name: d.name, path: toRel(full), type: stat.isDirectory() ? ("dir" as const) : ("file" as const), symlink: d.isSymbolicLink(), size: stat.size, mtime: stat.mtimeMs };
				} catch {
					return { name: d.name, path: toRel(full), type: "file" as const, symlink: d.isSymbolicLink(), size: 0, mtime: 0, broken: true };
				}
			}),
		);
		entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1));
		return { path: toRel(dir), entries };
	},

	async stat(rel) {
		const file = resolveSafe(rel);
		const stat = await fs.stat(file);
		return { path: toRel(file), size: stat.size, mtime: stat.mtimeMs, type: stat.isDirectory() ? "dir" : "file" };
	},

	async writeText(rel, content, expectMtime) {
		const requested = resolveSafe(rel);
		const stat = await fs.stat(requested).catch(() => undefined);
		// Write through symlinks instead of replacing them; resolveSafe already checked their target.
		const file = stat ? realpathSync(requested) : requested;
		if (stat && !stat.isFile()) throw new HttpError(400, "Not a file");
		if (stat && expectMtime !== undefined && Math.abs(stat.mtimeMs - expectMtime) > 1) throw new HttpError(409, "The file changed on disk since you opened it; reload to see the new version");
		// Same directory, then rename: readers (and the agent) never see a half-written file.
		const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
		await fs.writeFile(temp, content, { mode: stat?.mode });
		await fs.rename(temp, file).catch(async (error) => {
			await fs.rm(temp, { force: true });
			throw error;
		});
		const saved = await fs.stat(file);
		return { path: toRel(requested), size: saved.size, mtime: saved.mtimeMs };
	},

	async mkdir(rel) {
		const dir = resolveSafe(rel);
		await fs.mkdir(dir, { recursive: true });
		return toRel(dir);
	},

	localPath: (rel) => resolveSafe(rel),
};

function memoryRealtime(): Realtime {
	const topics = new Map<string, Set<(event: unknown) => void>>();
	return {
		publish(topic, event) {
			for (const sink of topics.get(topic) ?? []) {
				try {
					sink(event);
				} catch {
					// One broken viewer must not affect the others.
				}
			}
		},
		subscribe(topic, sink) {
			let sinks = topics.get(topic);
			if (!sinks) topics.set(topic, (sinks = new Set()));
			sinks.add(sink);
			return () => {
				sinks.delete(sink);
				if (!sinks.size) topics.delete(topic);
			};
		},
		subscribers: (topic) => topics.get(topic)?.size ?? 0,
	};
}

function localProcess(command: string, args: string[], options: Parameters<Platform["sandbox"]["spawn"]>[2]): SandboxProcess {
	const windows = process.platform === "win32";
	const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: options.shell, detached: Boolean(options.group) && !windows, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
	child.stdin.on("error", () => {});
	return {
		get pid() {
			return child.pid;
		},
		write: (data) => void child.stdin.write(data),
		end: (data) => void child.stdin.end(data),
		kill(signal = "SIGTERM") {
			if (signal !== "tree") return void child.kill(signal);
			if (windows) return void spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		},
		onStdout: (listener) => void child.stdout.on("data", listener),
		onStderr: (listener) => void child.stderr.on("data", listener),
		onExit: (listener) => void child.on("exit", listener),
		onClose: (listener) => void child.on("close", listener),
		onError: (listener) => void child.on("error", listener),
	};
}

/** The separately deployed vault (vault/), reached over HTTP with VAULT_URL and VAULT_TOKEN. */
const httpVault: Secrets = {
	configured: () => Boolean(config.vaultUrl && config.vaultToken),

	reachable: () => fetch(`${config.vaultUrl.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false),

	list: async (namespace) => (await vault<{ secrets: SecretInfo[] }>("GET", namespace)).secrets,
	get: (namespace, key) => vault("GET", namespace, key),
	put: (namespace, key, body) => vault("PUT", namespace, key, body),
	delete: async (namespace, key) => void (await vault("DELETE", namespace, key)),
};

async function vault<T>(method: string, namespace: string, key?: string, body?: unknown): Promise<T> {
	if (!httpVault.configured()) throw new HttpError(503, "The secret vault is not configured (set VAULT_URL and VAULT_TOKEN)");
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
