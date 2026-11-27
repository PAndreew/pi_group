import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { apiRoutes, appGuide, DOCS_DIR, docsAnswer, SURFACES } from "../extensions/lib/app-guide.mjs";

test("every surface has a unique id, and its doc exists", () => {
	assert.equal(new Set(SURFACES.map((s) => s.id)).size, SURFACES.length);
	for (const s of SURFACES) if (s.doc) assert.ok(existsSync(path.join(DOCS_DIR, `${s.doc}.md`)), `${s.id}: docs/${s.doc}.md`);
});

test("the guide names every surface and the button block", () => {
	const guide = appGuide();
	assert.match(guide, /```beezy-action/);
	for (const s of SURFACES) assert.ok(guide.includes(`\`${s.id}\``), s.id);
	assert.match(guide, /`terminal` \(admins only\)/);
});

test("beezy_docs lists, reads and searches topics", () => {
	assert.match(docsAnswer(), /- vault: /);
	assert.match(docsAnswer(), /- api: /);
	assert.match(docsAnswer({ topic: "vault" }), /vault/i);
	assert.match(docsAnswer({ topic: "nope" }), /No topic "nope"/);
	assert.match(docsAnswer({ query: "remote machine" }), /remote-machines:\d+:/);
});

test("the API list comes from the routes, without agent bridges", () => {
	const routes = apiRoutes();
	assert.match(routes, /GET \/api\/remote-machines/);
	assert.match(routes, /\(admin\)/);
	assert.doesNotMatch(routes, /-bridge/);
	assert.match(docsAnswer({ topic: "api" }), /cannot call them/);
});
