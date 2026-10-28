import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "pi-group-browser-"));
process.env.DATA_DIR = path.join(dir, "data");
process.env.FS_ROOT = dir;
const { normalizeUrl, PICK } = await import("./browser.js");

test("only http(s) pages open, and bare hosts get a scheme", () => {
	assert.equal(normalizeUrl("localhost:5173/settings"), "http://localhost:5173/settings");
	assert.equal(normalizeUrl("192.168.1.4"), "http://192.168.1.4/");
	assert.equal(normalizeUrl("example.com"), "https://example.com/");
	assert.equal(normalizeUrl(" https://example.com/a?b=1 "), "https://example.com/a?b=1");
	assert.equal(normalizeUrl("about:blank"), "about:blank");
	assert.throws(() => normalizeUrl("file:///etc/passwd"), /http and https/);
	assert.throws(() => normalizeUrl("chrome://settings"), /http and https/);
});

const executable = process.env.BROWSER_EXECUTABLE || ["/usr/bin/chromium", "/usr/bin/google-chrome", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(existsSync);

test("picking describes elements at a point or inside a rectangle", { skip: !executable && "no browser installed" }, async () => {
	const { chromium } = await import("playwright-core");
	const browser = await chromium.launch({ executablePath: executable, headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
		await page.setContent(`
			<style>body{margin:0} button{position:absolute;width:100px;height:40px}</style>
			<div class="toolbar" data-insp-path="src/Toolbar.tsx:12:5:div">
				<button data-testid="save" style="left:10px;top:10px">Save</button>
				<button class="secondary" style="left:150px;top:10px">Cancel</button>
			</div>
			<p style="position:absolute;top:300px">Plain <b>text</b></p>`);
		const pick = (arg: object) => page.evaluate(`(${PICK})(${JSON.stringify(arg)})`) as Promise<any>;

		const save = await pick({ x: 50, y: 30 });
		assert.equal(save.elements.length, 1);
		assert.equal(save.elements[0].selector, 'button[data-testid="save"]');
		assert.equal(save.elements[0].text, "Save");
		assert.equal(save.elements[0].source, "src/Toolbar.tsx:12");
		assert.deepEqual(save.box, { x: 10, y: 10, width: 100, height: 40 });

		const cancel = await pick({ x: 200, y: 30 });
		assert.equal(cancel.elements[0].selector, "button.secondary");

		const hover = await pick({ x: 200, y: 30, hover: true });
		assert.equal(hover.label, "button.secondary");

		// Only the outermost elements inside the rectangle: both buttons, not the <b> elsewhere.
		const group = await pick({ rect: { x: 0, y: 0, width: 300, height: 100 } });
		assert.deepEqual(group.elements.map((e: { text: string }) => e.text), ["Save", "Cancel"]);

		// Covered elements are reachable by depth: an overlay above a card and its label, in a panel.
		await page.setContent(`
			<style>body{margin:0} div{position:absolute;inset:0}</style>
			<section id="panel" style="position:absolute;width:400px;height:300px">
				<div id="card" style="z-index:1"><span id="label">Card</span></div>
				<div id="overlay" style="z-index:5"></div>
			</section>`);
		const layers = await Promise.all([0, 1, 2, 3, 4].map((depth) => pick({ x: 5, y: 5, depth, hover: true })));
		assert.deepEqual(layers.map((l) => l.label), ["div#overlay", "span#label", "div#card", "section#panel", "section#panel"], "past the bottom stays at the last element");
		assert.deepEqual(layers.map((l) => l.depth), [0, 1, 2, 3, 3]);
		assert.equal(layers[0].count, 4, "html and body are left out");
		assert.equal((await pick({ x: 5, y: 5, depth: 2 })).elements[0].selector, "#card");
	} finally {
		await browser.close();
	}
});
