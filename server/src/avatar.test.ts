import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

test("profile photos require auth, persist, reject unsafe types and can be removed", async () => {
 const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-avatar-"));
 process.env.DATA_DIR = dir;
 const { authenticate, authRoutes, createUser } = await import("./auth.js");
 const { loadStore, saveNow, store } = await import("./store.js");
 loadStore();
 const user = createUser("photo-user", "test-password", "member");
 const other = createUser("other-user", "test-password", "member");
 const app = express();
 app.use(express.json({ limit: "1mb" }), authenticate, authRoutes());
 const server = app.listen(0, "127.0.0.1");
 await once(server, "listening");
 const address = server.address();
 assert.ok(address && typeof address !== "string");
 const base = `http://127.0.0.1:${address.port}`;
 const avatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
 try {
  const put = (value: unknown, cookie = "") => fetch(`${base}/auth/avatar`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Pi-Group": "1", Cookie: cookie }, body: JSON.stringify({ avatar: value }) });
  assert.equal((await put(avatar)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user.username, password: "test-password" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  for (const invalid of ["data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA", "data:image/png;base64," + "A".repeat(350000), undefined]) assert.equal((await put(invalid, cookie)).status, 400);
  assert.equal((await put(avatar, cookie)).status, 200);
  assert.equal(other.avatar, undefined);
  saveNow(); loadStore();
  assert.equal(store.userById(user.id)?.avatar, avatar);
  assert.equal((await fetch(`${base}/users/${user.id}/avatar`)).status, 401);
  const image = await fetch(`${base}/users/${user.id}/avatar`, { headers: { Cookie: cookie } });
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(avatar.split(",")[1], "base64"));
  assert.equal((await put(null, cookie)).status, 200);
  assert.equal((await fetch(`${base}/users/${user.id}/avatar`, { headers: { Cookie: cookie } })).status, 404);
 } finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  saveNow(); rmSync(dir, { recursive: true, force: true });
 }
});
