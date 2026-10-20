import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import express from "express";
import type { HarnessAdapter } from "./harness/types.js";

test("tenant boundaries cover direct URLs, chats, sessions, sharing, files, jobs, memory and migration", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pg-tenants-"));
  const workRoot = path.join(dir, "work");
  const familyRoot = path.join(dir, "family");
  const dataDir = path.join(dir, "data");
  for (const root of [workRoot, familyRoot, dataDir]) mkdirSync(root, { recursive: true });
  process.env.DATA_DIR = dataDir;
  process.env.FS_ROOT = workRoot;
  process.env.CHAT_FOLDER = path.join(workRoot, "chat");
  process.env.MEMORY_AFTER_DAYS = "7";
  // Seed legacy metadata before loading: migration must assign it only to Work.
  writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({ sessions: { "pi:legacy": { key: "pi:legacy", id: "legacy", harness: "pi", cwd: workRoot, visibility: "private", shares: [], createdAt: "2020-01-01" } } }));
  const { loadStore, store, saveNow } = await import("./store.js");
  const { authenticate, authRoutes, createUser } = await import("./auth.js");
  const { tenantRoutes } = await import("./tenants.js");
  const { inTenant } = await import("./tenant-context.js");
  const { fileRoutes } = await import("./files.js");
  const { sessionRoutes } = await import("./sessions.js");
  const { closeChats } = await import("./chats.js");
  loadStore();
  assert.equal(store.session("pi:legacy")?.tenantId, "work");
  const owner = createUser("andris", "password123", "admin");
  const berci = createUser("berci", "password123", "member");
  const family = { id: "family", name: "Family", root: familyRoot, chatFolder: path.join(familyRoot, "chat"), memberIds: [owner.id] };
  store.data.tenants.push(family);
  const wife = inTenant(family, () => createUser("nyuszi", "password123", "member"));
  const work = store.data.tenants.find(t => t.id === "work")!;
  assert.ok(!work.memberIds.includes(wife.id));
  const live = new Map<string, any>();
  let seq = 0;
  const adapter = {
    id: "pi", label: "Fake", available: async () => ({ ok: true }), listModels: async () => [], listSessions: async () => [],
    create: async (cwd: string) => {
      const state = { messages: [], partial: null, running: false, live: true, toolOutputs: {}, runningTools: [], queue: { steering: [], followUp: [] }, dialogs: [] };
      const session = { id: `s${++seq}`, cwd, state, viewers: 0, lastActivity: Date.now(), subscribe: () => () => {}, prompt: async () => {}, close: async () => {} };
      live.set(session.id, session);
      return session;
    },
    live: (id: string) => live.get(id), liveSessions: () => [...live.values()], open: async (id: string) => live.get(id), readSession: async () => ({ messages: [] }),
  } as unknown as HarnessAdapter;
  const app = express();
  app.use(express.json(), authenticate, authRoutes(), tenantRoutes(), fileRoutes(), sessionRoutes([adapter]));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cookies = new Map<string, string>();
  const call = async (name: string, method: string, url: string, body?: unknown, expectedTenant?: string) => {
    if (!cookies.has(name)) {
      const login = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: name, password: "password123" }) });
      assert.equal(login.status, 200);
      cookies.set(name, login.headers.get("set-cookie")!.split(";")[0]);
    }
    const response = await fetch(base + url, { method, headers: { Cookie: cookies.get(name)!, "X-Pi-Group": "1", "Content-Type": "application/json", ...(expectedTenant ? { "X-Pi-Tenant": expectedTenant } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const workSession = await call("andris", "POST", "/sessions", { harness: "pi", path: "" });
    assert.equal(workSession.status, 200);
    const workKey = workSession.body.session.key;
    assert.equal(store.session(workKey)?.tenantId, "work");
    assert.equal((await call("andris", "PUT", `/sessions/${workKey}/acl`, { visibility: "shared", shares: [{ userId: wife.id, access: "write" }] })).status, 400);
    const workChat = await call("andris", "POST", "/chats", { text: "Work discussion", userIds: [berci.id] });
    assert.equal(workChat.status, 200);
    assert.deepEqual((await call("berci", "GET", "/tenants")).body.tenants.map((t: any) => t.id), ["work"]);
    assert.equal((await call("berci", "POST", "/tenants/switch", { id: "family" })).status, 403);
    assert.equal((await call("berci", "GET", "/chats", undefined, "family")).status, 409);
    assert.equal((await call("andris", "POST", "/tenants/switch", { id: "family" })).status, 200);
    assert.equal((await call("andris", "POST", "/chats", { text: "Wrong person", userIds: [berci.id] })).status, 400);
    assert.equal((await call("andris", "GET", `/chats/${workChat.body.chat}`)).status, 404);
    assert.equal((await call("andris", "GET", `/sessions/${workKey}`)).status, 404, "admin is not a cross-tenant bypass");
    assert.equal((await call("andris", "GET", `/sessions/${workKey}/events`)).status, 404);
    assert.equal((await call("andris", "POST", "/sessions/forward", { text: "leak", to: [{ kind: "session", id: workKey }] })).status, 404);
    assert.equal((await call("andris", "GET", "/fs/list", undefined, "work")).status, 409, "stale tabs must not reinterpret paths in the new tenant");
    assert.equal((await call("andris", "GET", "/fs/list?path=../work")).status, 403);
    assert.deepEqual((await call("andris", "GET", "/users/directory")).body.users.map((u: any) => u.username).sort(), ["andris", "nyuszi"]);
    const familySession = await call("andris", "POST", "/sessions", { harness: "pi", path: "" });
    assert.equal(familySession.status, 200);
    assert.equal(store.session(familySession.body.session.key)?.tenantId, "family");
    assert.equal(store.session(familySession.body.session.key)?.cwd, familyRoot);
    const familyChat = await call("andris", "POST", "/chats", { text: "Family discussion", userIds: [wife.id] });
    assert.equal(familyChat.status, 200);
    assert.equal((await call("berci", "GET", `/chats/${familyChat.body.chat}`)).status, 404);
    assert.equal((await call("nyuszi", "GET", `/chats/${familyChat.body.chat}`)).status, 200);
    assert.equal((await call("nyuszi", "GET", `/sessions/${workKey}`)).status, 404);
    for (const [tenant, id] of [[work, "old-work"], [family, "old-family"]] as const) {
      inTenant(tenant, () => store.upsertSession({ key: `pi:${id}`, id, harness: "pi", cwd: tenant.chatFolder, ownerId: owner.id, updatedAt: "2020-01-01", createdAt: "2020-01-01" }));
      store.data.jobs.push({ tenantId: tenant.id, id, ownerId: owner.id, name: id, cwd: tenant.root, schedule: "every 1d", steps: [], enabled: false, failures: 0, createdAt: "2020-01-01", updatedAt: "2020-01-01" });
    }
    assert.deepEqual((await call("andris", "GET", "/jobs")).body.jobs.map((j: any) => j.id), ["old-family"]);
    assert.equal((await call("andris", "GET", "/memory")).body.pending, 1);
    const search = (await call("andris", "GET", "/folders/search?q=chat")).body;
    assert.ok(search.folders.every((p: string) => !p.includes("work")));
    await call("andris", "POST", "/tenants/switch", { id: "work" });
    assert.deepEqual((await call("andris", "GET", "/jobs")).body.jobs.map((j: any) => j.id), ["old-work"]);
    assert.equal((await call("andris", "GET", "/memory")).body.pending, 1);
    assert.equal((await call("andris", "GET", `/chats/${familyChat.body.chat}`)).status, 404);
    assert.equal((await call("andris", "GET", `/sessions/${familySession.body.session.key}`)).status, 404);
    assert.ok((await call("andris", "GET", "/chats")).body.chats.every((c: any) => c.id !== familyChat.body.chat));
    assert.deepEqual((await call("andris", "GET", "/users/directory")).body.users.map((u: any) => u.username).sort(), ["andris", "berci"]);
    // Existing SSE connections stay bound to the tenant in which they opened.
    const abortWork = new AbortController();
    const workStream = await fetch(base + "/notifications", { headers: { Cookie: cookies.get("andris")! }, signal: abortWork.signal });
    const workReader = workStream.body!.getReader();
    await workReader.read(); // retry preamble
    await call("andris", "POST", "/tenants/switch", { id: "family" });
    const abortFamily = new AbortController();
    const familyStream = await fetch(base + "/notifications", { headers: { Cookie: cookies.get("andris")! }, signal: abortFamily.signal });
    const familyReader = familyStream.body!.getReader();
    await familyReader.read();
    try {
      await call("nyuszi", "POST", `/chats/${familyChat.body.chat}/messages`, { text: "Family-only live event" });
      const event = new TextDecoder().decode((await familyReader.read()).value);
      assert.ok(event.includes("Family-only live event"));
      const unexpected = await Promise.race([workReader.read().then(r => new TextDecoder().decode(r.value)), new Promise<null>(resolve => setTimeout(() => resolve(null), 150))]);
      assert.equal(unexpected, null, "Work watchers must not receive Family events");
    } finally { abortWork.abort(); abortFamily.abort(); }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    saveNow(); closeChats(); rmSync(dir, { recursive: true, force: true });
  }
});
