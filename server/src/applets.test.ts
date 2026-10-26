import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { RunOutcome } from "./sessions.js";
import type { SessionMeta } from "./store.js";

// Before anything loads the config: no test may touch the real data directory.
const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-applets-"));
process.env.DATA_DIR = dir;
process.env.FS_ROOT = dir;
mkdirSync(path.join(dir, "work", "uploads"), { recursive: true });
writeFileSync(path.join(dir, "work", "uploads", "report.docx"), "x");
writeFileSync(path.join(dir, "notes.txt"), "x");

const translator = {
	slug: "docx-translator",
	title: "DOCX translator",
	description: "Translate Word documents",
	fields: [
		{ type: "markdown", text: "Pick documents and a language." },
		{ type: "file", id: "files", label: "Documents", accept: [".docx"], multiple: true },
		{ type: "select", id: "target", label: "Target language", options: ["English", "German"], default: "English" },
		{ type: "textarea", id: "glossary", label: "Glossary", optional: true },
		{ type: "checkbox", id: "bilingual", label: "Side by side" },
	],
	actions: [{ id: "run", label: "Translate", prompt: "/skill:docx-translator\nTranslate {{files}} into {{target}}.{{#bilingual}} Make it bilingual.{{/bilingual}}{{^bilingual}} Translation only.{{/bilingual}}\n{{#glossary}}Glossary: {{glossary}}{{/glossary}}" }],
};

test("specs refuse templates that name missing fields, duplicate IDs and foreign defaults", async () => {
	const { appletSpec } = await import("./applets.js");
	assert.ok(appletSpec.safeParse(translator).success);
	assert.match(JSON.stringify(appletSpec.safeParse({ ...translator, actions: [{ id: "run", label: "Go", prompt: "Use {{nope}}" }] }).error), /not a field/);
	assert.match(JSON.stringify(appletSpec.safeParse({ ...translator, fields: [...translator.fields, { type: "text", id: "target", label: "Again" }] }).error), /unique/);
	assert.match(JSON.stringify(appletSpec.safeParse({ ...translator, fields: [{ type: "radio", id: "target", label: "L", options: ["a"], default: "b" }] }).error), /not one of its options/);
	assert.equal(appletSpec.safeParse({ ...translator, slug: "Bad Slug" }).success, false);
	assert.equal(appletSpec.safeParse({ ...translator, fields: [{ type: "script", id: "x", label: "x" }] }).success, false);
});

test("values are checked and fill the template, paths relative to the run's folder", async () => {
	const { appletSpec, checkValues, renderPrompt } = await import("./applets.js");
	const spec = appletSpec.parse(translator);
	assert.throws(() => checkValues(spec, {}), /“Documents” is required/);
	assert.throws(() => checkValues(spec, { files: ["notes.txt"], target: "English" }), /takes \.docx files/);
	assert.throws(() => checkValues(spec, { files: ["work/uploads/report.docx"], target: "Klingon" }), /unknown option/);
	assert.throws(() => checkValues(spec, { files: ["../outside.docx"], target: "English" }), /outside the shared root/);
	const values = checkValues(spec, { files: ["work/uploads/report.docx"], target: "German", bilingual: true });
	assert.deepEqual(values, { files: ["work/uploads/report.docx"], target: "German", glossary: "", bilingual: true });
	assert.equal(renderPrompt(spec, spec.actions[0].prompt, values, path.join(dir, "work"), dir), "/skill:docx-translator\nTranslate `uploads/report.docx` into German. Make it bilingual.");
	const plain = checkValues(spec, { files: ["work/uploads/report.docx"], target: "English", glossary: "Kabel = cable" });
	assert.equal(renderPrompt(spec, spec.actions[0].prompt, plain, dir, dir), "/skill:docx-translator\nTranslate `work/uploads/report.docx` into English. Translation only.\nGlossary: Kabel = cable");
});

test("agents propose applets that the tenant can use once the owner approves them", async () => {
	const { authenticate, authRoutes, createUser } = await import("./auth.js");
	const { loadStore, store } = await import("./store.js");
	const { interactionEnvironment } = await import("./interactions.js");
	const { mountApplets } = await import("./applets.js");
	loadStore();
	const owner = createUser("applet-owner", "test-password", "member");
	const other = createUser("applet-other", "test-password", "member");
	store.upsertSession({ key: "fake:src", harness: "fake", id: "src", cwd: path.join(dir, "work"), ownerId: owner.id });

	const listeners: ((key: string, outcome: RunOutcome) => void)[] = [];
	const prompts: { key: string; text: string; user: string }[] = [];
	let n = 0;
	const router = express.Router();
	mountApplets(router, {
		createSession: async (user, input) => store.upsertSession({ key: `fake:run${++n}`, harness: "fake", id: `run${n}`, cwd: input.cwd, ownerId: user.id, name: input.name }),
		promptSession: async (meta: SessionMeta, user, input) => void prompts.push({ key: meta.key, text: input.text, user: user.username }),
		harnessFor: async () => "fake",
		onRun: (listener) => void listeners.push(listener),
		sendTo: () => {},
	});
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
	const token = interactionEnvironment("fake:src").BEEZY_INTERACTION_TOKEN;
	const bridge = (method: string, body?: unknown, auth = token) => fetch(`${url}/applet-bridge/fake%3Asrc`, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
	try {
		assert.equal((await bridge("POST", translator, "wrong")).status, 403);
		assert.equal((await bridge("POST", { ...translator, actions: [] })).status, 400);
		const proposed = await (await bridge("POST", { ...translator, reason: "Asked for a translator" })).json();
		assert.equal(proposed.url, "/apps/docx-translator");

		const asOwner = await login(owner.username);
		const asOther = await login(other.username);
		// Nobody else sees it, and nobody runs it, before it is approved.
		assert.deepEqual((await asOther("GET", "/applets")).body.applets, []);
		assert.equal((await asOther("GET", "/applets/docx-translator")).status, 404);
		let { applet } = (await asOwner("GET", "/applets/docx-translator")).body;
		assert.equal(applet.approved, false);
		assert.equal(applet.folder, "work");
		assert.equal(applet.note, "Asked for a translator");
		const run = { action: "run", values: { files: ["work/uploads/report.docx"], target: "German" } };
		assert.equal((await asOwner("POST", "/applets/docx-translator/run", run)).status, 409);
		assert.equal((await asOther("POST", `/applets/${applet.id}/approve`, { version: 1 })).status, 404);
		assert.equal((await asOwner("POST", `/applets/${applet.id}/approve`, { version: 0 })).status, 409);
		applet = (await asOwner("POST", `/applets/${applet.id}/approve`, { version: 1 })).body.applet;
		assert.equal(applet.approved, true);

		// Anyone in the tenant runs it as themselves, each run in a new session in the applet's folder.
		assert.equal((await asOther("GET", "/applets")).body.applets.length, 1);
		assert.equal((await asOther("POST", "/applets/docx-translator/run", { ...run, values: {} })).status, 400);
		const started = (await asOther("POST", "/applets/docx-translator/run", run)).body.run;
		assert.equal(started.status, "running");
		assert.deepEqual(prompts.at(-1), { key: "fake:run1", user: other.username, text: "🧩 Applet “DOCX translator” · Translate\n\n/skill:docx-translator\nTranslate `uploads/report.docx` into German. Translation only." });
		assert.equal(store.session("fake:run1")?.applet, applet.id);
		assert.equal(store.session("fake:run1")?.cwd, path.join(dir, "work"));
		listeners.forEach((l) => l("fake:run1", { kind: "finished", text: "Saved [report.de.docx](uploads/report.de.docx)" }));
		const runs = (await asOther("GET", "/applets/docx-translator")).body.runs;
		assert.equal(runs.length, 1);
		assert.equal(runs[0].status, "finished");
		assert.equal(runs[0].output, "Saved [report.de.docx](uploads/report.de.docx)");
		assert.deepEqual((await asOwner("GET", "/applets/docx-translator")).body.runs, []);

		// A change waits as a draft; the approved version keeps running meanwhile.
		const listed = await (await bridge("GET")).json();
		assert.equal(listed.applets[0].spec.slug, "docx-translator");
		const changed = { ...translator, fields: translator.fields.map((f) => ("options" in f ? { ...f, options: [...(f.options ?? []), "Hungarian"] } : f)) };
		assert.match((await (await bridge("POST", changed)).json()).message, /approved version keeps working/);
		assert.equal((await asOther("POST", "/applets/docx-translator/run", { ...run, values: { ...run.values, target: "Hungarian" } })).status, 400);
		applet = (await asOwner("GET", "/applets/docx-translator")).body.applet;
		assert.equal(applet.hasDraft, true);
		assert.equal(applet.draft.fields[2].options.length, 3);
		assert.equal((await asOther("GET", "/applets/docx-translator")).body.applet.draft, undefined);
		await asOwner("POST", `/applets/${applet.id}/approve`, { version: 2 });
		assert.equal((await asOther("POST", "/applets/docx-translator/run", { ...run, values: { ...run.values, target: "Hungarian" } })).status, 200);

		// Someone else's agent cannot take over the slug, and only the owner deletes it.
		store.upsertSession({ key: "fake:other", harness: "fake", id: "other", cwd: dir, ownerId: other.id });
		const otherToken = interactionEnvironment("fake:other").BEEZY_INTERACTION_TOKEN;
		const hijack = await fetch(`${url}/applet-bridge/fake%3Aother`, { method: "POST", headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" }, body: JSON.stringify(translator) });
		assert.equal(hijack.status, 409);
		assert.equal((await asOther("DELETE", `/applets/${applet.id}`)).status, 403);
		assert.equal((await asOwner("DELETE", `/applets/${applet.id}`)).status, 200);
		assert.deepEqual((await asOther("GET", "/applets")).body.applets, []);
	} finally {
		server.close();
	}
});
