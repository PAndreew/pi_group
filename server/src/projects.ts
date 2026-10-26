import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Request, Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { getChat, memberIds, setChatProject } from "./chats.js";
import { config } from "./config.js";
import { HttpError, resolveSafe, toRel } from "./files.js";
import { pushToUser } from "./push.js";
import { accessOf } from "./sessions.js";
import { saveNow, store, type User } from "./store.js";
import { tenantId } from "./tenant-context.js";
import { isTenantMember, tenantAccess, tenantOf } from "./tenants.js";

/*
 * Projects: the context unit sessions and chats are grouped by, within a tenant. Each tenant has a
 * General project (its chat folder). Every other project gets its own new folder, where new sessions
 * start and uploads land, and can link existing folders (a git repo, say). An item without an
 * explicit project belongs to the project whose own or linked folder holds its working folder most
 * specifically, else General, so linking a folder adopts its history.
 * Moving an item keeps its working folder (pi finds transcripts by it); moving one other people
 * are in waits until each of them approves. See docs/projects.md.
 */

export interface Project {
	tenantId?: string;
	id: string;
	name: string;
	/** Its own absolute folder: new sessions start here and uploads land here. */
	cwd: string;
	/** Existing absolute folders linked to it; sessions working in them belong to it. */
	links?: string[];
	general?: boolean;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export interface MoveRequest {
	tenantId?: string;
	id: string;
	kind: "session" | "chat";
	itemId: string;
	title: string;
	from: string;
	to: string;
	requestedBy: string;
	approvedBy: string[];
	waitingFor: string[];
	createdAt: string;
}

const MAX_PROJECTS = 100;
const inside = (dir: string, cwd: string) => cwd === dir || cwd.startsWith(dir + path.sep);

/** The tenant's General project, made on first use. */
export function generalProject(tenant = tenantId()) {
	store.data.projects ??= [];
	let general = store.data.projects.find((p) => p.general && (p.tenantId ?? "work") === tenant);
	if (!general) {
		const at = new Date().toISOString();
		general = { tenantId: tenant, id: `general-${tenant}`, name: "General", cwd: tenantOf(tenant)?.chatFolder ?? config.chatFolder, general: true, createdBy: "system", createdAt: at, updatedAt: at };
		store.data.projects.push(general);
		saveNow();
	}
	return general;
}

export const tenantProjects = (tenant = tenantId()) => {
	generalProject(tenant);
	return store.data.projects.filter((p) => (p.tenantId ?? "work") === tenant);
};

/** The project an item belongs to: its own if still there, else the one whose folder holds `cwd` most specifically. */
export function projectIdOf(cwd: string, explicit?: string, tenant = tenantId()) {
	const projects = tenantProjects(tenant);
	if (explicit && projects.some((p) => p.id === explicit)) return explicit;
	let best: { id: string; length: number } | undefined;
	for (const p of projects) {
		if (p.general) continue;
		for (const dir of [p.cwd, ...(p.links ?? [])]) if (inside(dir, cwd) && dir.length > (best?.length ?? -1)) best = { id: p.id, length: dir.length };
	}
	return best?.id ?? generalProject(tenant).id;
}

/** Check a project ID a client sent for the active tenant. */
export function checkProject(id: string | undefined) {
	if (id === undefined) return undefined;
	if (!tenantProjects().some((p) => p.id === id)) throw new HttpError(400, "No such project");
	return id;
}

export interface ProjectDeps {
	sendTo: (userId: string, event: unknown) => void;
}

export function mountProjects(router: Router, deps: ProjectDeps) {
	store.data.projects ??= [];
	store.data.moveRequests ??= [];

	const changed = (tenant: string, userIds?: string[]) => {
		for (const user of store.data.users) if ((!userIds || userIds.includes(user.id)) && isTenantMember(user.id, tenant)) deps.sendTo(user.id, { type: "projects", tenantId: tenant });
	};

	const view = (project: Project, user: User) => ({
		id: project.id,
		name: project.name,
		folder: toRel(project.cwd),
		links: (project.links ?? []).map(toRel),
		general: Boolean(project.general),
		canManage: !project.general && (user.role === "admin" || user.id === project.createdBy),
		createdAt: project.createdAt,
	});

	const find = (req: Request) => {
		const project = tenantProjects().find((p) => p.id === req.params.id);
		if (!project) throw new HttpError(404, "Project not found");
		return project;
	};
	const manage = (req: Request) => {
		const project = find(req);
		if (project.general) throw new HttpError(400, "General cannot be changed");
		if (req.user!.role !== "admin" && req.user!.id !== project.createdBy) throw new HttpError(403, "Only the project's creator or an admin can change it");
		return project;
	};

	/** A new folder for a project, projects/<name>, numbered if taken. */
	const newFolder = (name: string) => {
		const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
		for (let n = 1; ; n++) {
			const cwd = resolveSafe(`projects/${slug}${n > 1 ? `-${n}` : ""}`);
			if (!statSync(cwd, { throwIfNoEntry: false })) {
				mkdirSync(cwd, { recursive: true });
				return cwd;
			}
		}
	};
	/** Existing folders to link, each once and none the project's own. */
	const linksOf = (rels: string[], own?: string) => {
		const dirs = [...new Set(rels.map((rel) => resolveSafe(rel)))].filter((dir) => dir !== own);
		for (const dir of dirs) if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new HttpError(400, `Not a folder: /${toRel(dir)}`);
		return dirs;
	};
	const linksSchema = z.array(z.string().max(4000)).max(20);

	/** What a move changes: who must agree, and what the item is called. */
	const subject = (kind: "session" | "chat", id: string, user: User) => {
		if (kind === "session") {
			const meta = store.session(id);
			if (!meta || meta.deleted || !tenantAccess(user, meta) || !accessOf(user, meta)) throw new HttpError(404, "Session not found");
			const access = accessOf(user, meta);
			if (access !== "owner" && access !== "admin") throw new HttpError(403, "Only the session's owner can move it");
			const people = [meta.ownerId, ...meta.shares.map((s) => s.userId)].filter((u): u is string => Boolean(u) && u !== user.id && Boolean(store.userById(u!)));
			return { title: meta.name || meta.firstMessage || "Untitled session", from: projectIdOf(meta.cwd, meta.projectId, meta.tenantId ?? "work"), people: [...new Set(people)] };
		}
		const chat = getChat(id);
		const members = chat ? memberIds(chat.id) : [];
		if (!chat || !tenantAccess(user, chat) || !members.includes(user.id)) throw new HttpError(404, "Chat not found");
		const title = chat.title || members.filter((m) => m !== user.id).map((m) => store.userById(m)?.username ?? "someone").join(", ") || "Chat";
		return { title, from: projectIdOf(resolveSafe(chat.folder), chat.projectId, chat.tenantId ?? "work"), people: members.filter((m) => m !== user.id && store.userById(m)) };
	};

	const apply = (kind: "session" | "chat", id: string, to: string) => {
		if (kind === "session") {
			const meta = store.session(id);
			if (meta) store.upsertSession({ ...meta, projectId: to });
			return;
		}
		setChatProject(id, to);
		const chat = getChat(id);
		const linked = chat?.sessionKey ? store.session(chat.sessionKey) : undefined;
		if (linked) store.upsertSession({ ...linked, projectId: to });
	};

	router.use("/projects", requireAuth);

	router.get("/projects", (req, res) => {
		const user = req.user!;
		const projects = tenantProjects().sort((a, b) => Number(Boolean(b.general)) - Number(Boolean(a.general)) || a.createdAt.localeCompare(b.createdAt));
		res.json({ projects: projects.map((p) => view(p, user)) });
	});

	router.post("/projects", (req, res) => {
		const user = req.user!;
		const body = z.object({ name: z.string().trim().min(1).max(60), links: linksSchema.default([]) }).strict().parse(req.body);
		const projects = tenantProjects();
		if (projects.length >= MAX_PROJECTS) throw new HttpError(429, `A tenant has at most ${MAX_PROJECTS} projects`);
		if (projects.some((p) => p.name.toLowerCase() === body.name.toLowerCase())) throw new HttpError(409, "A project with that name exists");
		const links = linksOf(body.links);
		const at = new Date().toISOString();
		const project: Project = { tenantId: tenantId(), id: randomUUID(), name: body.name, cwd: newFolder(body.name), links, createdBy: user.id, createdAt: at, updatedAt: at };
		store.data.projects.push(project);
		saveNow();
		changed(tenantId());
		res.json({ project: view(project, user) });
	});

	router.patch("/projects/:id", (req, res) => {
		const project = manage(req);
		const body = z.object({ name: z.string().trim().min(1).max(60).optional(), links: linksSchema.optional() }).strict().parse(req.body);
		if (body.name && tenantProjects().some((p) => p !== project && p.name.toLowerCase() === body.name!.toLowerCase())) throw new HttpError(409, "A project with that name exists");
		Object.assign(project, { ...(body.name ? { name: body.name } : {}), ...(body.links ? { links: linksOf(body.links, project.cwd) } : {}), updatedAt: new Date().toISOString() });
		saveNow();
		changed(tenantId());
		res.json({ project: view(project, req.user!) });
	});

	/** Delete a project; its sessions and chats fall back to General (or the project holding their folder). */
	router.delete("/projects/:id", (req, res) => {
		const project = manage(req);
		store.data.projects = store.data.projects.filter((p) => p !== project);
		store.data.moveRequests = store.data.moveRequests.filter((m) => m.to !== project.id);
		saveNow();
		changed(tenantId());
		res.json({ ok: true });
	});

	const moveView = (m: MoveRequest) => {
		const name = (id: string) => store.data.projects.find((p) => p.id === id)?.name ?? "a deleted project";
		const user = (id: string) => store.userById(id)?.username ?? "someone";
		return { id: m.id, kind: m.kind, itemId: m.itemId, title: m.title, from: name(m.from), to: name(m.to), toId: m.to, requestedBy: user(m.requestedBy), requestedById: m.requestedBy, approvedBy: m.approvedBy.map(user), waitingFor: m.waitingFor.map(user), waitingForIds: m.waitingFor, createdAt: m.createdAt };
	};

	/** Move a session or chat; with other people in it, ask each of them first. */
	router.post("/projects/move", (req, res) => {
		const user = req.user!;
		const body = z.object({ kind: z.enum(["session", "chat"]), id: z.string().min(1), to: z.string().min(1) }).strict().parse(req.body);
		const to = checkProject(body.to)!;
		const item = subject(body.kind, body.id, user);
		if (item.from === to) throw new HttpError(400, "It is already in that project");
		store.data.moveRequests = store.data.moveRequests.filter((m) => !(m.kind === body.kind && m.itemId === body.id));
		if (!item.people.length) {
			apply(body.kind, body.id, to);
			saveNow();
			changed(tenantId(), [user.id]);
			return void res.json({ moved: true });
		}
		const request: MoveRequest = { tenantId: tenantId(), id: randomUUID(), kind: body.kind, itemId: body.id, title: item.title, from: item.from, to, requestedBy: user.id, approvedBy: [], waitingFor: item.people, createdAt: new Date().toISOString() };
		store.data.moveRequests.push(request);
		saveNow();
		changed(tenantId(), [user.id, ...item.people]);
		const target = tenantProjects().find((p) => p.id === to)!;
		for (const id of item.people) void pushToUser(id, { type: "project_move", title: `${user.username} wants to move “${item.title}”`, text: `To the project ${target.name}. Approve or decline it on the home screen.` }).catch(() => {});
		res.json({ moved: false, request: moveView(request) });
	});

	/** Move requests waiting for the caller, and the caller's own that wait for others. */
	router.get("/projects/moves", (req, res) => {
		const user = req.user!;
		const mine = store.data.moveRequests.filter((m) => (m.tenantId ?? "work") === tenantId() && (m.waitingFor.includes(user.id) || m.requestedBy === user.id));
		res.json({ moves: mine.map(moveView) });
	});

	router.post("/projects/moves/:id", (req, res) => {
		const user = req.user!;
		const approve = z.object({ approve: z.boolean() }).strict().parse(req.body).approve;
		const request = store.data.moveRequests.find((m) => m.id === req.params.id && (m.tenantId ?? "work") === tenantId());
		if (!request || !request.waitingFor.includes(user.id)) throw new HttpError(404, "Move request not found");
		const everyone = [request.requestedBy, ...request.approvedBy, ...request.waitingFor];
		let moved = false;
		if (!approve) {
			store.data.moveRequests = store.data.moveRequests.filter((m) => m !== request);
			void pushToUser(request.requestedBy, { type: "project_move", title: `${user.username} declined moving “${request.title}”`, text: "It stays where it is." }).catch(() => {});
		} else {
			request.waitingFor = request.waitingFor.filter((id) => id !== user.id);
			request.approvedBy.push(user.id);
			if (!request.waitingFor.length) {
				store.data.moveRequests = store.data.moveRequests.filter((m) => m !== request);
				if (tenantProjects().some((p) => p.id === request.to)) {
					apply(request.kind, request.itemId, request.to);
					moved = true;
				}
			}
		}
		saveNow();
		changed(tenantId(), everyone);
		res.json({ moved });
	});

	router.delete("/projects/moves/:id", (req, res) => {
		const request = store.data.moveRequests.find((m) => m.id === req.params.id && m.requestedBy === req.user!.id);
		if (!request) throw new HttpError(404, "Move request not found");
		store.data.moveRequests = store.data.moveRequests.filter((m) => m !== request);
		saveNow();
		changed(tenantId(), [request.requestedBy, ...request.waitingFor]);
		res.json({ ok: true });
	});
}
