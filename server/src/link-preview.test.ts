import assert from "node:assert/strict";
import { test } from "node:test";
import { linkPreview, parsePreview, publicAddress } from "./link-preview.js";

test("previews read Open Graph metadata, falling back to plain HTML", () => {
	const base = new URL("https://www.example.com/post/1");
	const og = parsePreview(`<head><title>Plain</title><meta property="og:title" content="Rich &amp; title"><meta name="description" content="About it"><meta property="og:image" content="/cover.png"><link rel="icon" href="/fav.svg"></head>`, base);
	assert.deepEqual(og, { url: base.href, title: "Rich & title", description: "About it", image: "https://www.example.com/cover.png", siteName: "example.com", icon: "https://www.example.com/fav.svg" });
	const plain = parsePreview("<title> Just a page </title>", base);
	assert.equal(plain.title, "Just a page");
	assert.equal(plain.icon, "https://www.example.com/favicon.ico");
	assert.equal(parsePreview(`<meta property="og:image" content="javascript:alert(1)">`, base).image, undefined);
});

test("previews never reach private addresses", async () => {
	for (const a of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.equal(publicAddress(a), false, a);
	for (const a of ["1.1.1.1", "2606:4700:4700::1111"]) assert.equal(publicAddress(a), true, a);
	await assert.rejects(linkPreview("http://127.0.0.1:1/"), /private/);
	await assert.rejects(linkPreview("http://localhost:1/"), /private/);
	await assert.rejects(linkPreview("http://[::1]:1/"), /private/);
});
