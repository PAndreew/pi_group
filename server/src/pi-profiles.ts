import { readFile, mkdir, stat, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import path from "node:path";
import { z } from "zod";
import { HttpError } from "./files.js";

const profileDir = (id: string) => path.join(config.dataDir, "pi-profiles", Buffer.from(id).toString("hex"));
const authFile = (id: string) => path.join(profileDir(id), "auth.json");
async function managedProfile(id: string) {
	try { await stat(authFile(id)); return profileDir(id); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
const pendingWrites = new Map<string, Promise<void>>();
export async function savePiKey(id: string, provider: string, key: string) {
	const next = (pendingWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(() => writePiKey(id, provider, key));
	pendingWrites.set(id, next);
	try { await next; } finally { if (pendingWrites.get(id) === next) pendingWrites.delete(id); }
}

async function writePiKey(id: string, provider: string, key: string) {
	const external = await piProfile(id);
	if (external && external !== profileDir(id)) throw new HttpError(409, "This profile is managed by the server administrator");
	const file = authFile(id);
	await mkdir(profileDir(id), { recursive: true, mode: 0o700 });
	const existing = external ? JSON.parse(await readFile(file, "utf8")) : {};
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, JSON.stringify({ ...existing, [provider]: { type: "api_key", key } }), { mode: 0o600, flag: "wx" });
	await rename(temp, file);
}

const registry = z.record(z.string(), z.string().refine(path.isAbsolute));

/** Administrator-managed mapping from immutable Beezy user IDs to native Pi directories. */
export async function piProfile(userId: string): Promise<string | undefined> {
	const file = process.env.BEEZY_PI_PROFILES_FILE;
	if (!file) return managedProfile(userId);
	try {
		const entries = registry.parse(JSON.parse(await readFile(file, "utf8")));
		return Object.hasOwn(entries, userId) ? entries[userId] : await managedProfile(userId);
	} catch {
		throw new HttpError(503, "Cannot load Pi auth profiles");
	}
}

// An assigned profile must not inherit the server's provider environment, including
// credentials from providers/extensions unknown to Beezy.
export function piProfileEnvironment(env: NodeJS.ProcessEnv, profile: string): NodeJS.ProcessEnv {
	const safe = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "SYSTEMROOT", "WINDIR"];
	return { ...Object.fromEntries(safe.map(key => [key, env[key]])), PI_CODING_AGENT_DIR: profile };
}

export function availablePreferredModel<T extends { provider: string; id: string }>(available: T[], ...preferences: (Pick<T, "provider" | "id"> | undefined)[]) {
	for (const wanted of preferences) {
		const match = wanted && available.find(model => model.provider === wanted.provider && model.id === wanted.id);
		if (match) return match;
	}
}
