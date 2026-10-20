import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { SessionDefaults } from "./preferences.js";
import type { Authorship } from "./authorship.js";
import type { Interaction } from "./interactions.js";
import type { Job } from "./jobs.js";
import { tenantId, type Tenant } from "./tenant-context.js";

export type Role = "admin" | "member";
export type Access = "read" | "write";

export interface User {
	id: string;
	username: string;
	passwordHash: string;
	sessionDefaults?: SessionDefaults;
	avatar?: string;
	role: Role;
	createdAt: string;
}

export interface LoginSession {
	tenantId?: string;
	/** sha256 of the cookie token; the token itself is never stored. */
	tokenHash: string;
	userId: string;
	expiresAt: number;
}

export interface Share {
	userId: string;
	access: Access;
}

/** App-side metadata of one harness session: who owns it and who may see it. */
export interface SessionMeta {
	tenantId?: string;
	key: string;
	harness: string;
	id: string;
	cwd: string;
	/** Absent for sessions created outside the app (e.g. with the pi CLI); only admins see those until claimed. */
	ownerId?: string;
	visibility: "private" | "shared";
	shares: Share[];
	name?: string;
	firstMessage?: string;
	createdAt: string;
	updatedAt?: string;
	/** Keep the harness process alive even when idle, so background work is never reaped. */
	pinned?: boolean;
	authorship?: Authorship;
	/** Tombstone for sessions the harness cannot erase (pi-durable); hidden everywhere. */
	deleted?: boolean;
	/** When the memory consolidator last folded this session into memory. */
	consolidatedAt?: string;
	/** The master session that keeps the consolidated memory. */
	memory?: boolean;
}

/** A browser push subscription (one per device), delivering run notifications while the app is closed. */
export interface PushSubscriptionRecord {
	userId: string;
	endpoint: string;
	keys: { p256dh: string; auth: string };
	createdAt: string;
}

interface Data {
	tenants: Tenant[];
	users: User[];
	logins: LoginSession[];
	sessions: Record<string, SessionMeta>;
	/** Folders that have a pi-durable storage, so they are reopened (and resumed) at startup. */
	durableFolders: string[];
	pushSubscriptions: PushSubscriptionRecord[];
	interactions: Interaction[];
	jobs: Job[];
}

const file = path.join(config.dataDir, "db.json");
let data: Data = { tenants: [], users: [], logins: [], sessions: {}, durableFolders: [], pushSubscriptions: [], interactions: [], jobs: [] };
let saveTimer: NodeJS.Timeout | undefined;

export function loadStore() {
	mkdirSync(config.dataDir, { recursive: true });
	try {
		data = { ...data, ...JSON.parse(readFileSync(file, "utf8")) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	data.logins = data.logins.filter((login) => login.expiresAt > Date.now());
	// Idempotent migration: legacy app data belongs to Work, never to a new tenant.
	if (!data.tenants.length) {
		data.tenants = [{ id: "work", name: "Work", root: config.fsRoot, chatFolder: config.chatFolder, memberIds: data.users.map(u => u.id) }];
	}
	for (const meta of Object.values(data.sessions)) meta.tenantId ??= "work";
	for (const job of data.jobs) job.tenantId ??= "work";
}

function flush() {
	saveTimer = undefined;
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
	renameSync(tmp, file);
}

/** Persist soon; many small changes in a burst produce one write. */
export function save() {
	saveTimer ??= setTimeout(flush, 200);
}

export function saveNow() {
	if (saveTimer) clearTimeout(saveTimer);
	flush();
}

export const store = {
	get data() {
		return data;
	},
	userById: (id: string) => data.users.find((u) => u.id === id),
	userByName: (name: string) => data.users.find((u) => u.username.toLowerCase() === name.toLowerCase()),
	session: (key: string) => data.sessions[key] as SessionMeta | undefined,
	upsertSession(meta: Omit<SessionMeta, "visibility" | "shares" | "createdAt"> & Partial<SessionMeta>) {
		const existing = data.sessions[meta.key];
		const defaults = { tenantId: tenantId(), visibility: "private", shares: [], createdAt: new Date().toISOString() };
		const next = {
			...defaults,
			...existing,
			...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)),
		} as SessionMeta;
		data.sessions[meta.key] = next;
		save();
		return next;
	},
	removeSession(key: string) {
		delete data.sessions[key];
		save();
	},
};
