import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCapabilities, parseSearchResults } from "./tool-capabilities.js";

test("capabilities accept audited tools of any transport but reject escape hatches", () => {
	const definitions = parseCapabilities([
		{ id: "drive", name: "Drive", tools: [{ name: "mcp__drive__read", access: "read" }, { name: "mcp__drive__write", access: "write" }] },
		{ id: "cli", name: "CLI adapter", extensions: ["/trusted/cli.mjs"], tools: [{ name: "drive_cli_read", access: "read", allow: { operation: ["list", "download"] } }] },
		{ id: "http", name: "HTTP adapter", tools: [{ name: "fetch_public_document", access: "read" }] },
	]);
	assert.equal(definitions.length, 3);
	for (const name of ["bash", "read", "mcp", "codemode", "web_search", "tool_search", "mcp__drive__*"]) {
		assert.throws(() => parseCapabilities([{ id: "bad", name: "Bad", tools: [{ name, access: "read" }] }]));
	}
	assert.throws(() => parseCapabilities([{ id: "web-search", name: "Override", tools: [{ name: "x", access: "read" }] }]));
	assert.throws(() => parseCapabilities([{ id: "bad", name: "Bad", extensions: ["./project/tool.mjs"], tools: [{ name: "x", access: "read" }] }]));
	assert.throws(() => parseCapabilities([{ id: "bad", name: "Bad", tools: [{ name: "x", access: "read" }, { name: "x", access: "write" }] }]));
});

test("web search returns titles and URLs without following result links", () => {
	assert.deepEqual(parseSearchResults(`<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc">A &amp; <b>B</b></a><a class="result__a" href="javascript:alert(1)">bad</a>`), [{ title: "A & B", url: "https://example.com/doc" }]);
});
