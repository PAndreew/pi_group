import { capabilityTools, requireCapabilityTool, searchWeb } from "./tool-capabilities.js";
import { spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Router } from "express";
import { z } from "zod";
import { chatOfSession, memberIds } from "./chats.js";
import { config } from "./config.js";
import { HttpError } from "./paths.js";
import { bridgeCredentialValid } from "./interactions.js";
import { canAccessProject, projectIdOf, tenantProjects } from "./projects.js";
import { projectSandboxCommand, sandboxSeccomp, type ProjectSandbox } from "./project-sandbox.js";
import { store, type SessionMeta, type User } from "./store.js";
import { inTenant } from "./tenant-context.js";
import { isTenantMember, tenantOf } from "./tenants.js";

// The actual invoking person, never an agent-supplied user ID. Restart clears grants.
const actors = new Map<string, string>();
const delegations = new Map<string, number>();
export function authorizeAgentRun(meta: SessionMeta, user: User, running = false) {
	if (meta.harness !== "pi") throw new HttpError(403, "This runtime has no enforced agent scope");
	if (!isTenantMember(user.id, meta.tenantId ?? "work")) throw new HttpError(403, "Tenant unavailable");
	if (actors.has(meta.key) && actors.get(meta.key) !== user.id) throw new HttpError(409, "Wait for the current person's run to finish");
	agentScope(meta, user);
	actors.set(meta.key, user.id);
	if (!running) delegations.set(meta.key, 0);
}
export function revokeAgentRun(key: string) {
	actors.delete(key);
	delegations.delete(key);
}
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
function safeRoot(input: string) {
	const root = realpathSync(input);
	// A project must not mount credentials, server state, or the running application's code.
	for (const protectedPath of [config.dataDir, config.piAgentDir, path.resolve(import.meta.dirname, "../..")]) {
		const secret = realpathSync(protectedPath);
		if (inside(root, secret) || (protectedPath !== config.dataDir && inside(secret, root))) throw new HttpError(403, "Project root overlaps protected server files");
	}
	return root;
}
export function agentScope(meta: SessionMeta, user: User) {
	const chat = chatOfSession(meta.key);
	const projects = tenantProjects(meta.tenantId ?? "work");
	const project = projects.find(p => p.id === projectIdOf(meta.cwd, meta.projectId, meta.tenantId ?? "work"))!;
	const butler = project.general && !chat && meta.ownerId === user.id && meta.visibility === "private";
	if (!canAccessProject(user, project)) throw new HttpError(403, "Project access required");
	if (chat && !memberIds(chat.id).includes(user.id)) throw new HttpError(403, "Group access required");
	if (butler) {
		const accessible = store.data.projects.filter(p => !p.general && isTenantMember(user.id, p.tenantId ?? "work") && (p.createdBy === user.id || p.memberIds?.includes(user.id)));
		const roots = [...new Set(accessible.flatMap(p => [p.cwd, ...(p.links ?? [])]).map(safeRoot))];
		// Collapse read-only overlaps; never use mount ordering to grant write access.
		const readOnly = roots.filter(root => !roots.some(other => other !== root && inside(other, root)));
		return { butler: true, projects: accessible.map(p => ({ id: p.id, name: p.name, tenantId: p.tenantId ?? "work", folder: p.cwd })), profile: readOnly.length ? { readOnly, writable: [], cwd: readOnly[0] } : undefined };
	}
	let roots: string[];
	if (project.general) {
		// General group conversations must not mount other groups' files or consolidated memory.
		if (!chat) throw new HttpError(403, "Shared General sessions need a group chat");
		const folder = path.join(project.cwd, "groups", chat.id);
		mkdirSync(folder, { recursive: true });
		roots = [safeRoot(folder)];
	} else roots = [...new Set([project.cwd, ...(project.links ?? [])].map(safeRoot))];
	const writable = roots.filter(root => !roots.some(other => other !== root && inside(other, root)));
	return { butler: false, projects: [], profile: { readOnly: [], writable, cwd: safeRoot(project.general ? roots[0] : project.cwd) } };
}

export async function runScopedCommand(profile: ProjectSandbox, command: string, signal?: AbortSignal) {
	const spec = projectSandboxCommand(profile, "/bin/sh", ["-c", command]);
	const seccomp = sandboxSeccomp();
	return await new Promise<{ output: string; exitCode: number | null }>((resolve, reject) => {
		const child = spawn(spec.command, ["--seccomp", "3", ...spec.args], { stdio: ["ignore", "pipe", "pipe", "pipe"], env: {}, signal });
		const filterInput = child.stdio[3] as import("node:stream").Writable;
		filterInput.on("error", () => {}); // spawn errors are reported by the child below
		filterInput.end(seccomp);
		let output = "";
		let bytes = 0;
		let limited = false;
		const timer = setTimeout(() => { limited = true; child.kill("SIGKILL"); }, 60000);
		const collect = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes <= 100000) output += chunk.toString("utf8");
			else { limited = true; child.kill("SIGKILL"); }
		};
		child.stdout!.on("data", collect);
		child.stderr!.on("data", collect);
		child.on("error", error => { clearTimeout(timer); reject(error); });
		child.on("close", exitCode => { clearTimeout(timer); resolve({ output: output + (limited ? "\nStopped: time/output limit exceeded." : ""), exitCode }); });
	});
}

export function mountAgentScope(router: Router, deps: {
	delegate: (user: User, projectId: string, prompt: string) => Promise<string>;
	readSession: (meta: SessionMeta) => Promise<unknown>;
}) {
	router.post("/agent-bridge/:key", async (req, res) => {
		const key = String(req.params.key);
		if (!bridgeCredentialValid(key, req.headers.authorization)) throw new HttpError(403, "Invalid bridge credential");
		const meta = store.session(key);
		const actor = actors.get(key);
		const user = actor && store.userById(actor);
		const tenant = meta && tenantOf(meta.tenantId ?? "work");
		if (!meta || meta.deleted || !user || !tenant || !isTenantMember(user.id, tenant.id)) throw new HttpError(403, "No authorized agent run");
		if (meta.ownerId !== user.id && !(meta.visibility === "shared" && meta.shares.some(s => s.userId === user.id && s.access === "write")) && !chatOfSession(key)) throw new HttpError(403, "Session access revoked");
		await inTenant(tenant, async () => {
			const scope = agentScope(meta, user);
			const body = z.discriminatedUnion("action", [
				z.object({ action: z.literal("scope") }).strict(),
				z.object({ action: z.literal("tool_policy") }).strict(),
				z.object({ action: z.literal("authorize_tool"), tool: z.string().min(1).max(200), input: z.record(z.string(), z.unknown()).default({}) }).strict(),
				z.object({ action: z.literal("web_search"), query: z.string().trim().min(1).max(1000) }).strict(),
				z.object({ action: z.literal("bash"), command: z.string().min(1).max(20000) }).strict(),
				z.object({ action: z.literal("sessions") }).strict(),
				z.object({ action: z.literal("read_session"), key: z.string() }).strict(),
				z.object({ action: z.literal("delegate"), projectId: z.string(), prompt: z.string().min(1).max(20000) }).strict(),
			]).parse(req.body);
			const project = tenantProjects().find(p => p.id === projectIdOf(meta.cwd, meta.projectId))!;
			if (body.action === "tool_policy") return void res.json({ tools: capabilityTools(project, Boolean(scope.butler)) });
			if (body.action === "authorize_tool") {
				requireCapabilityTool(project, body.tool, Boolean(scope.butler), body.input);
				return void res.json({ allowed: true });
			}
			if (body.action === "web_search") {
				requireCapabilityTool(project, "web_search", Boolean(scope.butler));
				const abort = new AbortController();
				res.on("close", () => { if (!res.writableEnded) abort.abort(); });
				return void res.json(await searchWeb(body.query, abort.signal));
			}
			if (body.action === "scope") return void res.json({ ...scope, tools: capabilityTools(project, Boolean(scope.butler)) });
			if (body.action === "bash") {
				if (!scope.profile) throw new HttpError(403, "No accessible project folders");
				const abort = new AbortController();
				res.on("close", () => { if (!res.writableEnded) abort.abort(); });
				return void res.json(await runScopedCommand(scope.profile, body.command, abort.signal));
			}
			if (!scope.butler) throw new HttpError(403, "Only a personal General butler may access other sessions or delegate");
			const visible = (m: SessionMeta) => !m.deleted && isTenantMember(user.id, m.tenantId ?? "work") && (m.ownerId === user.id || (m.visibility === "shared" && m.shares.some(s => s.userId === user.id)));
			if (body.action === "sessions") return void res.json({ sessions: Object.values(store.data.sessions).filter(visible).map(m => ({ key: m.key, name: m.name, tenantId: m.tenantId ?? "work", projectId: m.projectId })) });
			if (body.action === "read_session") {
				const target = store.session(body.key);
				const targetTenant = target && tenantOf(target.tenantId ?? "work");
				if (!target || !targetTenant || !visible(target)) throw new HttpError(404, "Session unavailable");
				return void res.json(await inTenant(targetTenant, () => deps.readSession(target)));
			}
			const count = delegations.get(key) ?? 0;
			if (count >= 5) throw new HttpError(429, "At most five delegations per butler run");
			delegations.set(key, count + 1);
			const target = store.data.projects.find(p => p.id === body.projectId && !p.general);
			const targetTenant = target && tenantOf(target.tenantId ?? "work");
			if (!target || !targetTenant) throw new HttpError(404, "Project unavailable");
			await inTenant(targetTenant, async () => {
				if (!canAccessProject(user, target)) throw new HttpError(403, "Project unavailable");
				const sessionKey = await deps.delegate(user, target.id, body.prompt);
				res.json({ sessionKey, tenantId: targetTenant.id, status: "started" });
			});
		});
	});
}
