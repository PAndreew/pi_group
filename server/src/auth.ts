import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { sessionDefaultsSchema } from "./preferences.js";
import { config } from "./config.js";
import { type Role, save, store, type User } from "./store.js";

const COOKIE = "pg_session";

declare global {
	namespace Express {
		interface Request {
			user?: User;
		}
	}
}

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
	return `scrypt$16384$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [scheme, n, salt, hash] = stored.split("$");
	if (scheme !== "scrypt") return false;
	const expected = Buffer.from(hash, "base64");
	const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: 8, p: 1 });
	return timingSafeEqual(expected, actual);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const publicUser = (user: User) => ({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt, sessionDefaults: user.sessionDefaults });

export function createUser(username: string, password: string, role: Role): User {
	if (store.userByName(username)) throw new Error(`User ${username} already exists`);
	const user: User = { id: randomUUID(), username, passwordHash: hashPassword(password), role, createdAt: new Date().toISOString() };
	store.data.users.push(user);
	save();
	return user;
}

/** First start: create an admin so the app is never reachable without a login. */
export function ensureAdmin() {
	if (store.data.users.length > 0) return;
	const username = process.env.ADMIN_USERNAME || "admin";
	const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
	createUser(username, password, "admin");
	console.log("\n================ pi_group ================");
	console.log(`Created admin user "${username}"`);
	if (!process.env.ADMIN_PASSWORD) console.log(`Generated password: ${password}`);
	console.log("Change it after the first login.");
	console.log("==========================================\n");
}

function readCookie(req: Request, name: string): string | undefined {
	const header = req.headers.cookie;
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return decodeURIComponent(v.join("="));
	}
	return undefined;
}

function setCookie(res: Response, token: string, maxAgeSec: number) {
	const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
	if (config.cookieSecure) parts.push("Secure");
	res.setHeader("Set-Cookie", parts.join("; "));
}

/** Attach `req.user` when the cookie maps to a live login. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
	const token = readCookie(req, COOKIE);
	if (token) {
		const login = store.data.logins.find((l) => l.tokenHash === sha256(token));
		if (login && login.expiresAt > Date.now()) req.user = store.userById(login.userId);
	}
	next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
	if (!req.user) return void res.status(401).json({ error: "Not logged in" });
	// Cross-site requests cannot set custom headers without a CORS preflight, which this server never grants.
	if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-pi-group"] !== "1") {
		return void res.status(403).json({ error: "Missing X-Pi-Group header" });
	}
	next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
	if (req.user?.role !== "admin") return void res.status(403).json({ error: "Admins only" });
	next();
}

const failures = new Map<string, { count: number; until: number }>();

export function authRoutes(): Router {
	const router = express.Router();

	router.post("/auth/login", (req, res) => {
		const body = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).safeParse(req.body);
		if (!body.success) return void res.status(400).json({ error: "Username and password required" });
		const key = `${req.ip}|${body.data.username.toLowerCase()}`;
		const failure = failures.get(key);
		if (failure && failure.count >= 8 && failure.until > Date.now()) {
			return void res.status(429).json({ error: "Too many attempts, try again later" });
		}
		const user = store.userByName(body.data.username);
		if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
			failures.set(key, { count: (failure?.count ?? 0) + 1, until: Date.now() + 15 * 60_000 });
			return void res.status(401).json({ error: "Invalid username or password" });
		}
		failures.delete(key);
		const token = randomBytes(32).toString("base64url");
		const ttl = config.loginTtlDays * 86400;
		store.data.logins.push({ tokenHash: sha256(token), userId: user.id, expiresAt: Date.now() + ttl * 1000 });
		save();
		setCookie(res, token, ttl);
		res.json({ user: publicUser(user) });
	});

	router.post("/auth/logout", (req, res) => {
		const token = readCookie(req, COOKIE);
		if (token) {
			store.data.logins = store.data.logins.filter((l) => l.tokenHash !== sha256(token));
			save();
		}
		setCookie(res, "", 0);
		res.json({ ok: true });
	});

	router.get("/auth/me", (req, res) => {
		if (!req.user) return void res.status(401).json({ error: "Not logged in" });
		res.json({ user: publicUser(req.user) });
	});

	router.put("/auth/avatar", requireAuth, (req, res) => {
		const avatar = req.body?.avatar;
		if (avatar !== null && (typeof avatar !== "string" || avatar.length > 350_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar) || !Buffer.from(avatar.split(",")[1], "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) {
			return void res.status(400).json({ error: "Upload a PNG image under 250 KB" });
		}
		req.user!.avatar = avatar ?? undefined;
		save();
		res.json({ ok: true });
	});

	router.get("/users/:id/avatar", requireAuth, (req, res) => {
		const avatar = store.data.users.find((u) => u.id === req.params.id)?.avatar;
		res.setHeader("Cache-Control", "no-store");
		if (!avatar) return void res.sendStatus(404);
		res.setHeader("Content-Type", "image/png");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.send(Buffer.from(avatar.split(",")[1], "base64"));
	});

	router.put("/auth/defaults", requireAuth, (req, res) => {
		req.user!.sessionDefaults = sessionDefaultsSchema.parse(req.body);
		save();
		res.json({ user: publicUser(req.user!) });
	});

	router.post("/auth/password", requireAuth, (req, res) => {
		const body = z.object({ current: z.string(), next: z.string().min(8).max(256) }).safeParse(req.body);
		if (!body.success) return void res.status(400).json({ error: "New password must be at least 8 characters" });
		const user = req.user!;
		if (!verifyPassword(body.data.current, user.passwordHash)) return void res.status(400).json({ error: "Current password is wrong" });
		user.passwordHash = hashPassword(body.data.next);
		save();
		res.json({ ok: true });
	});

	/** Usernames for the share dialog; every member may see who else is in the group. */
	router.get("/users/directory", requireAuth, (_req, res) => {
		res.json({ users: store.data.users.map((u) => ({ id: u.id, username: u.username })) });
	});

	router.get("/users", requireAuth, requireAdmin, (_req, res) => {
		res.json({ users: store.data.users.map(publicUser) });
	});

	router.post("/users", requireAuth, requireAdmin, (req, res) => {
		const body = z
			.object({
				username: z.string().regex(/^[a-zA-Z0-9_.-]{2,32}$/, "2-32 letters, digits, . _ -"),
				password: z.string().min(8).max(256),
				role: z.enum(["admin", "member"]).default("member"),
			})
			.safeParse(req.body);
		if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid user" });
		try {
			res.json({ user: publicUser(createUser(body.data.username, body.data.password, body.data.role)) });
		} catch (error) {
			res.status(409).json({ error: (error as Error).message });
		}
	});

	router.patch("/users/:id", requireAuth, requireAdmin, (req, res) => {
		const user = store.userById(String(req.params.id));
		if (!user) return void res.status(404).json({ error: "No such user" });
		const body = z.object({ password: z.string().min(8).max(256).optional(), role: z.enum(["admin", "member"]).optional() }).safeParse(req.body);
		if (!body.success) return void res.status(400).json({ error: "Invalid change" });
		if (body.data.role && body.data.role !== "admin" && user.role === "admin" && store.data.users.filter((u) => u.role === "admin").length === 1) {
			return void res.status(400).json({ error: "Cannot demote the last admin" });
		}
		if (body.data.role) user.role = body.data.role;
		if (body.data.password) {
			user.passwordHash = hashPassword(body.data.password);
			store.data.logins = store.data.logins.filter((l) => l.userId !== user.id);
		}
		save();
		res.json({ user: publicUser(user) });
	});

	router.delete("/users/:id", requireAuth, requireAdmin, (req, res) => {
		const id = String(req.params.id);
		if (id === req.user!.id) return void res.status(400).json({ error: "You cannot delete yourself" });
		store.data.users = store.data.users.filter((u) => u.id !== id);
		store.data.logins = store.data.logins.filter((l) => l.userId !== id);
		store.data.pushSubscriptions = store.data.pushSubscriptions.filter((s) => s.userId !== id);
		for (const meta of Object.values(store.data.sessions)) {
			meta.shares = meta.shares.filter((s) => s.userId !== id);
			if (meta.ownerId === id) delete meta.ownerId;
		}
		save();
		res.json({ ok: true });
	});

	return router;
}
