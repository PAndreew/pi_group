import assert from "node:assert/strict";
import test from "node:test";
import { searchPage } from "./browser-search.js";

test("search renders API results as safe clickable links", async () => {
	const html = await searchPage("Hacker News & more", "test-key", async (input, options) => {
		const url = new URL(String(input));
		assert.equal(url.origin + url.pathname, "https://api.search.brave.com/res/v1/web/search");
		assert.equal(url.searchParams.get("q"), "Hacker News & more");
		assert.equal(new Headers(options?.headers).get("X-Subscription-Token"), "test-key");
		return Response.json({ web: { results: [{ title: "Hacker News <top>", url: "https://news.ycombinator.com/" }, { title: "Bad URL", url: "javascript:void(0)" }] } });
	});
	assert.match(html, /href="https:\/\/news\.ycombinator\.com\/">Hacker News &#60;top&#62;/);
	assert.doesNotMatch(html, /javascript:|test-key/);
});

test("missing key and rate limits show useful errors", async () => {
	assert.match(await searchPage("test", ""), /Search is not configured/);
	assert.match(await searchPage("test", "key", async () => new Response(null, { status: 429 })), /HTTP 429/);
});
