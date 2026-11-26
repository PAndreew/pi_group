import assert from "node:assert/strict";
import { test } from "node:test";
import { redactLive, setLiveRedactor } from "./live-redaction.js";

test("live tool output passes through without a redactor and is redacted, in order, with one", async () => {
	setLiveRedactor(undefined);
	assert.equal(await redactLive("pi:1", "token sk-123456"), "token sk-123456");
	let release!: () => void;
	const loaded = new Promise<void>((resolve) => (release = resolve));
	setLiveRedactor(async (_key, text) => {
		await loaded;
		return text.replaceAll("sk-123456", "{{vault:T}}");
	});
	const seen: string[] = [];
	const updates = ["a sk-123456", "a sk-123456 b", "a sk-123456 b c"].map((text) => redactLive("pi:1", text).then((out) => seen.push(out)));
	release();
	await Promise.all(updates);
	assert.deepEqual(seen, ["a {{vault:T}}", "a {{vault:T}} b", "a {{vault:T}} b c"]);
	assert.equal(await redactLive(undefined, "sk-123456"), "sk-123456", "probe sessions have no vault");
	setLiveRedactor(undefined);
});
