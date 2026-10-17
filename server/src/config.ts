import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Load KEY=VALUE pairs from a .env file next to the working directory, without overriding real env vars. */
function loadDotEnv(file: string) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
		if (!match || line.trim().startsWith("#")) continue;
		const [, key, raw] = match;
		if (process.env[key] !== undefined) continue;
		process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
	}
}

loadDotEnv(path.resolve(process.cwd(), ".env"));
loadDotEnv(path.resolve(process.cwd(), "..", ".env"));

const expandHome = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const env = (key: string, fallback: string) => expandHome(process.env[key] ?? fallback);
const num = (key: string, fallback: number) => {
	const value = Number(process.env[key]);
	return Number.isFinite(value) && process.env[key] !== "" ? value : fallback;
};
const bool = (key: string, fallback: boolean) => {
	const value = process.env[key];
	if (value === undefined || value === "") return fallback;
	return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const piAgentDir = env("PI_CODING_AGENT_DIR", path.join(os.homedir(), ".pi", "agent"));

export const config = {
	host: env("HOST", "0.0.0.0"),
	port: num("PORT", 8787),
	/** App state: users, login sessions, session ACLs, durable storages. */
	dataDir: path.resolve(env("DATA_DIR", path.join(os.homedir(), ".pi-group"))),
	/** Everything the file browser can see. Users cannot leave this directory. */
	fsRoot: path.resolve(env("FS_ROOT", os.homedir())),
	/** pi executable. A path ending in .js is run with the current node binary. */
	piBin: env("PI_BIN", "pi"),
	piAgentDir,
	piSessionsDir: path.resolve(env("PI_SESSIONS_DIR", path.join(piAgentDir, "sessions"))),
	/** Idle pi processes (not running, no viewers, not pinned) are stopped after this many minutes. */
	idleTimeoutMin: num("IDLE_TIMEOUT_MIN", 30),
	maxUploadMb: num("MAX_UPLOAD_MB", 200),
	/** Set when serving over HTTPS (e.g. behind a reverse proxy) so cookies get the Secure flag. */
	cookieSecure: bool("COOKIE_SECURE", false),
	loginTtlDays: num("LOGIN_TTL_DAYS", 30),
	enableDurable: bool("ENABLE_DURABLE", true),
	/** Shared folder for chats started without a #folder; also holds the consolidated memory. Inside FS_ROOT. */
	chatFolder: path.resolve(env("CHAT_FOLDER", path.join(path.resolve(env("FS_ROOT", os.homedir())), "pi-chat"))),
	/** Consolidate chats untouched for this many days into the memory session; 0 turns it off. */
	memoryAfterDays: num("MEMORY_AFTER_DAYS", 7),
	/** Contact for push services (mailto: or https:). Keys are generated into DATA_DIR/vapid.json unless set. */
	vapidSubject: env("VAPID_SUBJECT", "https://github.com/PAndreew/pi_group"),
	vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
	vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
	webDist: path.resolve(env("WEB_DIST", path.join(import.meta.dirname, "..", "..", "web", "dist"))),
};
