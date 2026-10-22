import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { createVaultServer } from "./server.mjs";
import { SecretStore } from "./store.mjs";

const token = "t".repeat(32);
const store = new SecretStore(":memory:", randomBytes(32));
const server = createVaultServer({ store, token });
let base;

before(async () => {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
	server.close();
	store.close();
});

const call = (method, path, body, auth = token) =>
	fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("refuses requests without the token", async () => {
	assert.equal((await call("GET", "/v1/namespaces/a/secrets", undefined, "wrong")).status, 401);
	assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("stores, lists, reads, updates and deletes a secret per namespace", async () => {
	assert.equal((await call("PUT", "/v1/namespaces/work.u1/secrets/GITHUB_TOKEN", { value: "ghp_secret", description: "GitHub PAT" })).status, 200);
	const listed = await call("GET", "/v1/namespaces/work.u1/secrets");
	assert.deepEqual(listed.body.secrets.map((s) => [s.key, s.description, s.value]), [["GITHUB_TOKEN", "GitHub PAT", undefined]]);
	assert.equal((await call("GET", "/v1/namespaces/work.u1/secrets/GITHUB_TOKEN")).body.value, "ghp_secret");
	assert.equal((await call("GET", "/v1/namespaces/work.u2/secrets/GITHUB_TOKEN")).status, 404);

	await call("PUT", "/v1/namespaces/work.u1/secrets/GITHUB_TOKEN", { description: "Renamed" });
	const read = await call("GET", "/v1/namespaces/work.u1/secrets/GITHUB_TOKEN");
	assert.equal(read.body.value, "ghp_secret");
	assert.equal(read.body.description, "Renamed");

	assert.equal((await call("DELETE", "/v1/namespaces/work.u1/secrets/GITHUB_TOKEN")).status, 200);
	assert.equal((await call("GET", "/v1/namespaces/work.u1/secrets")).body.secrets.length, 0);
});

test("validates keys and values", async () => {
	assert.equal((await call("PUT", "/v1/namespaces/a/secrets/1BAD", { value: "x" })).status, 400);
	assert.equal((await call("PUT", "/v1/namespaces/a/secrets/NEW", { description: "no value" })).status, 400);
	assert.equal((await call("PUT", "/v1/namespaces/a/secrets/EMPTY", { value: "" })).status, 400);
});

test("ciphertext is bound to its namespace and key", () => {
	store.put("a", "K", { value: "v" });
	store.db.exec("UPDATE secrets SET namespace = 'b' WHERE namespace = 'a' AND key = 'K'");
	assert.throws(() => store.get("b", "K"));
});
