import assert from "node:assert/strict";
import { test } from "node:test";
import type { Secrets, SecretInfo } from "./ports/index.js";
import { providerCredentials, selectRunModel } from "./provider-credentials.js";

test("credential lookup is scoped by tenant and user; listing does not read values", async () => {
	const rows = new Map<string, SecretInfo & { value: string }>();
	let reads = 0;
	const vault: Secrets = {
		configured: () => true,
		reachable: async () => true,
		list: async (ns) => [...rows].filter(([key]) => key.startsWith(`${ns}/`)).map(([, row]) => row),
		get: async (ns, provider) => {
			reads++;
			const row = rows.get(`${ns}/${provider}`);
			if (!row) throw new Error("Missing credential");
			return row;
		},
		put: async (ns, provider, body) => {
			const row = { key: provider, value: body.value!, description: body.description, createdAt: "now", updatedAt: "now" };
			rows.set(`${ns}/${provider}`, row);
			return row;
		},
		delete: async (ns, provider) => { rows.delete(`${ns}/${provider}`); },
	};
	const keys = providerCredentials(vault);
	const alice = { tenantId: "team", userId: "alice" };
	const sam = { ...alice, userId: "sam" };
	await keys.save(alice, "anthropic", "alice-test-key");
	await keys.save(sam, "anthropic", "sam-test-key");
	assert.deepEqual(await keys.list(alice), [{ provider: "anthropic", updatedAt: "now" }]);
	assert.deepEqual(await keys.list({ ...alice, tenantId: "other" }), []);
	assert.equal(reads, 0);
	assert.equal(await keys.readForRequest(sam, "anthropic"), "sam-test-key");
	await keys.remove(sam, "anthropic");
	await assert.rejects(keys.readForRequest(sam, "anthropic"), /Missing credential/);
	assert.equal(await keys.readForRequest(alice, "anthropic"), "alice-test-key");
});

test("payer changes only to a configured fallback, not on credential store failure", async () => {
	const preferred = { provider: "anthropic", id: "sonnet" };
	const fallback = { model: { provider: "openai", id: "gpt" }, billing: "shared" as const };
	assert.deepEqual(await selectRunModel(preferred, fallback, async () => true), { model: preferred, billing: "personal" });
	assert.deepEqual(await selectRunModel(preferred, fallback, async () => false), fallback);
	await assert.rejects(selectRunModel(preferred, undefined, async () => false), /No personal credential/);
	await assert.rejects(selectRunModel(preferred, fallback, async () => { throw new Error("vault offline"); }), /vault offline/);
});
