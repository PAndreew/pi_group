import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

// Before anything loads the config: no test may touch the real data directory.
const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-projects-"));
process.env.DATA_DIR = dir;
process.env.FS_ROOT = dir;
for (const folder of ["apps/beezy/server", "apps/clairic", "holiday"]) mkdirSync(path.join(dir, folder), { recursive: true });

test("projects sort sessions in, move them, and ask the people in them first", async () => {
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, store } = await import("./store.js");
	const { mountProjects, projectIdOf } = await import("./projects.js");
	loadStore();
	const owner = createUser("project-owner", "test-password", "member");
	const friend = createUser("project-friend", "test-password", "member");
	const at = new Date().toISOString();
	store.upsertSession({ key: "fake:solo", harness: "fake", id: "solo", cwd: path.join(dir, "apps/beezy/server"), ownerId: owner.id, createdAt: at });
	store.upsertSession({ key: "fake:shared", harness: "fake", id: "shared", cwd: path.join(dir, "holiday"), ownerId: owner.id, visibility: "shared", shares: [{ userId: friend.id, access: "write" }], createdAt: at });

	const router = express.Router();
	mountProjects(router, { sendTo: () => {} });
	const app = express();
	app.use(express.json(), authenticate, authRoutes(), router);
	app.use((error: { status?: number; issues?: unknown }, _req: express.Request, res: express.Response, _next: express.NextFunction) => void res.status(error.issues ? 400 : (error.status ?? 500)).json({ error: String(error) }));
	const server = app.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const url = `http://127.0.0.1:${address.port}`;
	const login = async (username: string) => {
		const res = await fetch(`${url}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password" }) });
		const cookie = res.headers.get("set-cookie")!.split(";")[0];
		return async (method: string, route: string, body?: unknown) => {
			const res = await fetch(`${url}${route}`, { method, headers: { Cookie: cookie, "X-Pi-Group": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
			return { status: res.status, body: await res.json() };
		};
	};
	try {
		const asOwner = await login(owner.username);
		const asFriend = await login(friend.username);
		let { projects } = (await asOwner("GET", "/projects")).body;
		assert.deepEqual(projects.map((p: { name: string }) => p.name), ["General"]);
		const general = projects[0].id;
		assert.equal(projectIdOf(path.join(dir, "apps/beezy/server")), general);

		// Each project gets a new folder of its own; linking a folder adopts the sessions working in it, most specific folder first.
		const apps = (await asOwner("POST", "/projects", { name: "Apps", links: ["apps"] })).body.project;
		assert.equal(apps.folder, "projects/apps");
		assert.deepEqual(apps.links, ["apps"]);
		const beezy = (await asOwner("POST", "/projects", { name: "Beezy" })).body.project;
		assert.equal(projectIdOf(path.join(dir, "apps/beezy/server")), apps.id);
		assert.deepEqual((await asOwner("PATCH", `/projects/${beezy.id}`, { links: ["apps/beezy", "apps/beezy"] })).body.project.links, ["apps/beezy"]);
		assert.equal((await asOwner("POST", "/projects", { name: "beezy" })).status, 409);
		assert.equal((await asOwner("POST", "/projects", { name: "Missing", links: ["nope"] })).status, 400);
		assert.equal((await asOwner("POST", "/projects", { name: "Escape", links: ["../.."] })).status, 403);
		const holiday = (await asOwner("POST", "/projects", { name: "Holiday 2027" })).body.project;
		assert.equal(holiday.folder, "projects/holiday-2027");
		assert.ok(statSync(path.join(dir, "projects/holiday-2027")).isDirectory());
		await asOwner("DELETE", `/projects/${holiday.id}`);
		const second = (await asOwner("POST", "/projects", { name: "Holiday 2027" })).body.project;
		assert.equal(second.folder, "projects/holiday-2027-2");
		await asOwner("DELETE", `/projects/${second.id}`);
		const holidayNow = (await asOwner("POST", "/projects", { name: "Holiday 2027" })).body.project;
		assert.equal(holidayNow.folder, "projects/holiday-2027-3");
		assert.equal(projectIdOf(path.join(dir, "apps/beezy/server")), beezy.id);
		assert.equal(projectIdOf(path.join(dir, "apps/clairic")), apps.id);
		assert.equal(projectIdOf(path.join(dir, "holiday")), general);
		projects = (await asOwner("GET", "/projects")).body.projects;
		assert.deepEqual(projects.map((p: { name: string }) => p.name), ["General", "Apps", "Beezy", "Holiday 2027"]);
		assert.equal(projects[1].canManage, true);
		assert.equal((await asFriend("GET", "/projects")).body.projects.length, 1);
		assert.equal((await asFriend("PATCH", `/projects/${apps.id}`, { name: "Mine" })).status, 404);
		assert.equal((await asFriend("PUT", `/projects/${apps.id}/shares`, { memberIds: [friend.id] })).status, 404);
		const before = JSON.stringify(store.data.sessions);
		assert.equal((await asOwner("PUT", `/projects/${apps.id}/shares`, { memberIds: [friend.id, friend.id] })).status, 200);
		assert.equal(JSON.stringify(store.data.sessions), before, "Project sharing must not change any session permissions");
		assert.equal((await asFriend("GET", "/projects")).body.projects[1].canManage, false);
		assert.equal((await asFriend("PATCH", `/projects/${apps.id}`, { name: "Mine" })).status, 403);
		assert.equal((await asOwner("PUT", `/projects/${apps.id}/shares`, { memberIds: ["missing"] })).status, 400);
		await asOwner("PUT", `/projects/${apps.id}/shares`, { memberIds: [] });
		assert.equal((await asFriend("GET", "/projects")).body.projects.length, 1);
		await asOwner("PUT", `/projects/${apps.id}/shares`, { memberIds: [friend.id] });
		assert.equal((await asOwner("DELETE", `/projects/${general}`)).status, 400);

		// Alone in it: the move happens at once, and the working folder stays.
		assert.equal((await asOwner("POST", "/projects/move", { kind: "session", id: "fake:solo", to: holidayNow.id })).body.moved, true);
		assert.equal(store.session("fake:solo")?.projectId, holidayNow.id);
		assert.equal(store.session("fake:solo")?.cwd, path.join(dir, "apps/beezy/server"));
		assert.equal((await asOwner("POST", "/projects/move", { kind: "session", id: "fake:solo", to: holidayNow.id })).status, 400);
		assert.equal((await asFriend("POST", "/projects/move", { kind: "session", id: "fake:solo", to: general })).status, 404);

		// With someone else in it: it waits for them; a decline keeps it where it is.
		const asked = (await asOwner("POST", "/projects/move", { kind: "session", id: "fake:shared", to: holidayNow.id })).body;
		assert.equal(asked.moved, false);
		assert.deepEqual(asked.request.waitingFor, [friend.username]);
		assert.equal((await asFriend("POST", "/projects/move", { kind: "session", id: "fake:shared", to: apps.id })).status, 403);
		const waiting = (await asFriend("GET", "/projects/moves")).body.moves;
		assert.equal(waiting.length, 1);
		assert.equal(waiting[0].to, "Holiday 2027");
		assert.equal((await asOwner("POST", `/projects/moves/${waiting[0].id}`, { approve: true })).status, 404);
		await asFriend("POST", `/projects/moves/${waiting[0].id}`, { approve: false });
		assert.equal(store.session("fake:shared")?.projectId, undefined);
		assert.deepEqual((await asOwner("GET", "/projects/moves")).body.moves, []);

		const again = (await asOwner("POST", "/projects/move", { kind: "session", id: "fake:shared", to: holidayNow.id })).body.request;
		assert.equal((await asFriend("POST", `/projects/moves/${again.id}`, { approve: true })).body.moved, true);
		assert.equal(store.session("fake:shared")?.projectId, holidayNow.id);

		// Deleting a project returns its sessions to the project holding their folder.
		assert.equal((await asOwner("DELETE", `/projects/${holidayNow.id}`)).status, 200);
		assert.equal(projectIdOf(store.session("fake:solo")!.cwd, store.session("fake:solo")!.projectId), beezy.id);
		assert.equal(projectIdOf(store.session("fake:shared")!.cwd, store.session("fake:shared")!.projectId), general);
	} finally {
		server.close();
	}
});
