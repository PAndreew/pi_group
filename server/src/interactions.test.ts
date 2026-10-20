import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

test("interaction tool bridge persists cards and only a writer can resolve them, first answer wins", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-interactions-"));
  process.env.DATA_DIR = dir;
  const { loadStore, store } = await import("./store.js");
  loadStore();
  // This fixture injects req.user directly instead of creating real accounts.
  store.data.tenants.find(t => t.id === "work")!.memberIds.push("writer", "reader");
  store.upsertSession({ key: "pi:test", id: "test", harness: "pi", cwd: dir, ownerId: "writer" });
  const { mountInteractions, interactionEnvironment } = await import("./interactions.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: String(req.headers["x-user"] ?? "reader"), username: "tester" } as any; next(); });
  const router = express.Router();
  mountInteractions(router, (req) => {
    if (req.params.key !== "pi:test") throw Object.assign(new Error("not found"), { status: 404 });
    return { access: req.user!.id === "writer" ? "write" : "read" };
  });
  app.use(router);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? (error.name === "ZodError" ? 400 : 500)).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const env = interactionEnvironment("pi:test");
  const call = (url: string, method = "GET", body?: unknown, user = "writer", token?: string) => fetch(base + url, { method, headers: { "Content-Type": "application/json", "X-Pi-Group": "1", "X-User": user, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const spec = { version: 1, type: "multi_choice", title: "Choose features", options: [{ id: "search", label: "Search" }, { id: "push", label: "Push" }] };
    assert.equal((await call("/interaction-bridge/pi%3Atest", "POST", { toolCallId: "call", spec })).status, 403);
    const created = await call("/interaction-bridge/pi%3Atest", "POST", { toolCallId: "call", spec }, "writer", env.BEEZY_INTERACTION_TOKEN);
    assert.equal(created.status, 200);
    const card = await created.json();
    assert.equal(card.status, "pending");
    loadStore();
    const listed = await (await call("/sessions/pi%3Atest/interactions")).json();
    assert.equal(listed.interactions[0].id, card.id);
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${card.id}`, "POST", { selected: ["search"] }, "reader")).status, 403);
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${card.id}`, "POST", { selected: ["unknown"] })).status, 400);
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${card.id}`, "POST", { selected: ["search"] })).status, 200);
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${card.id}`, "POST", { selected: ["push"] })).status, 409);
    const result = await (await call(`/interaction-bridge/pi%3Atest/${card.id}`, "GET", undefined, "writer", env.BEEZY_INTERACTION_TOKEN)).json();
    assert.deepEqual(result.selected, ["search"]);
    assert.equal(result.respondent.username, "tester");
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${card.id}`, "POST", { selected: ["search"] })).status, 200, "same answer can be retried safely");

    // Exercise the actual extension execute() over HTTP: it waits, then returns the structured answer.
    process.env.BEEZY_INTERACTION_URL = base + "/interaction-bridge/pi%3Atest";
    process.env.BEEZY_INTERACTION_TOKEN = env.BEEZY_INTERACTION_TOKEN;
    const extension = await import(new URL("../extensions/request-user-input.mjs", import.meta.url).href);
    let tool: any;
    extension.default({ registerTool: (registered: any) => { tool = registered; } });
    const running = tool.execute("call-two", { type: "single_choice", title: "Choose one", options: spec.options }, new AbortController().signal);
    let next: any;
    for (let i = 0; i < 100 && !next; i++) {
      const cards = await (await call("/sessions/pi%3Atest/interactions")).json();
      next = cards.interactions.find((c: any) => c.toolCallId === "call-two");
      if (!next) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(next, "tool created an inline card");
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${next.id}`, "POST", { selected: ["search", "push"] })).status, 400);
    await call(`/sessions/pi%3Atest/interactions/${next.id}`, "POST", { cancelled: true });
    assert.equal((await running).details.status, "cancelled");

    const pending = await (await call("/interaction-bridge/pi%3Atest", "POST", { toolCallId: "expired", spec }, "writer", env.BEEZY_INTERACTION_TOKEN)).json();
    const { expireInteractions } = await import("./interactions.js");
    expireInteractions("pi:test");
    assert.equal((await call(`/sessions/pi%3Atest/interactions/${pending.id}`, "POST", { selected: ["search"] })).status, 409);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
