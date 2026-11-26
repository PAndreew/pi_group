import assert from "node:assert/strict";
import { test } from "node:test";
import { mapStrings, vaultIndex } from "../extensions/lib/vault-redact.mjs";

test("vault placeholders are filled into tool calls and values redacted back out of results", () => {
	const vault = vaultIndex([
		{ key: "API_TOKEN", scope: "personal", value: "sk-live-123456" },
		{ key: "API_TOKEN", scope: "project", value: "sk-team-999999" },
		{ key: "DB_PASS", scope: "project", value: "hunter2hunter2" },
		{ key: "PIN", scope: "personal", value: "1234" },
	]);
	const missing = new Set<string>();
	const input = { path: ".env", content: "TOKEN={{vault:API_TOKEN}}\nTEAM={{vault:project:API_TOKEN}}\nDB={{vault:DB_PASS}}\nX={{vault:NOPE}}" };
	mapStrings(input, (t: string) => vault.fill(t, missing));
	assert.equal(input.content, "TOKEN=sk-live-123456\nTEAM=sk-team-999999\nDB=hunter2hunter2\nX={{vault:NOPE}}");
	assert.deepEqual([...missing], ["{{vault:NOPE}}"]);
	assert.equal(vault.redact(input.content), "TOKEN={{vault:API_TOKEN}}\nTEAM={{vault:project:API_TOKEN}}\nDB={{vault:DB_PASS}}\nX={{vault:NOPE}}");
	assert.equal(vault.redact("pin 1234"), "pin 1234", "short values are not redacted");
	const result = [{ type: "text", text: "curl -H 'Bearer sk-live-123456'" }];
	assert.deepEqual(mapStrings(result, (t: string) => vault.redact(t)), [{ type: "text", text: "curl -H 'Bearer {{vault:API_TOKEN}}'" }]);
});

test("encoded forms of a value are redacted and labelled placeholders fill with the same encoding", () => {
	const value = 'p@ss/w"rd 42';
	const vault = vaultIndex([{ key: "PW", scope: "personal", value }]);
	const json = JSON.stringify({ password: value });
	assert.equal(vault.redact(json), '{"password":"{{vault:PW:json}}"}');
	assert.equal(vault.redact(`https://x.test/?pw=${encodeURIComponent(value)}`), "https://x.test/?pw={{vault:PW:url}}");
	assert.equal(vault.redact(`pw=${encodeURIComponent(value).replaceAll("%20", "+")}`), "pw={{vault:PW:url}}");
	assert.equal(vault.redact(Buffer.from(value).toString("base64")), "{{vault:PW:base64}}");
	assert.equal(vault.redact(Buffer.from(value).toString("hex")), "{{vault:PW:hex}}");
	assert.equal(vault.redact(JSON.stringify(value).replaceAll("/", "\\/")), '"{{vault:PW:json}}"');
	const missing = new Set<string>();
	for (const encoding of ["json", "url", "base64", "hex"]) {
		const filled = vault.fill(`{{vault:PW:${encoding}}}`, missing);
		assert.notEqual(filled, value);
		assert.equal(vault.redact(filled), `{{vault:PW:${encoding}}}`, encoding);
	}
	assert.equal(missing.size, 0);
});

test("a value inside a longer base64 string (Basic auth) is redacted at every alignment", () => {
	const value = "s3cr3t-passw0rd";
	const vault = vaultIndex([{ key: "PW", scope: "personal", value }]);
	for (const user of ["a", "ab", "abc", "alice"]) {
		const header = `Authorization: Basic ${Buffer.from(`${user}:${value}`).toString("base64")}`;
		const redacted = vault.redact(header);
		assert.match(redacted, /\{\{vault:PW:base64\}\}/, user);
		// What is left around the placeholder is at most a few characters of the encoding.
		const rest = redacted.replace("Authorization: Basic ", "").replace("{{vault:PW:base64}}", "");
		assert.ok(rest.length <= Buffer.from(`${user}:`).toString("base64").length + 4, `${user}: ${redacted}`);
	}
	assert.equal(vault.redact("ordinary output without secrets"), "ordinary output without secrets");
});
