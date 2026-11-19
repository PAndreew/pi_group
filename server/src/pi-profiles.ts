import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HttpError } from "./files.js";

const registry = z.record(z.string(), z.string().refine(path.isAbsolute));

/** Administrator-managed mapping from immutable Beezy user IDs to native Pi directories. */
export async function piProfile(userId: string): Promise<string | undefined> {
	const file = process.env.BEEZY_PI_PROFILES_FILE;
	if (!file) return;
	try {
		const entries = registry.parse(JSON.parse(await readFile(file, "utf8")));
		return Object.hasOwn(entries, userId) ? entries[userId] : undefined;
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
