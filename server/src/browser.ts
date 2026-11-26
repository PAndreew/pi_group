import { existsSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import express, { type Request, type Response, type Router } from "express";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { authenticate, requireAuth } from "./auth.js";
import { HttpError } from "./files.js";
import { bridgeCredentialValid } from "./interactions.js";
import { platform } from "./ports/index.js";
import { accessOf } from "./sessions.js";
import { store } from "./store.js";
import { sameOrigin } from "./terminal.js";
import { inTenant, tenantId } from "./tenant-context.js";
import { isTenantMember, tenantOf } from "./tenants.js";

/*
 * A headless Chromium per session, shared by everyone viewing it and by the session's agent. Viewers
 * get JPEG frames of the page over a WebSocket and send input back; anyone with access can pick
 * elements, so their description (selector, text, HTML, source location) and a screenshot can be
 * referenced in the chat. See docs/browser.md.
 */

const VIEWPORT = { width: 1280, height: 800 };
const MAX_VIEWPORT = { width: 1920, height: 1600 };
const PIXEL_RATIO = 2;
const IDLE_MS = Number(process.env.BROWSER_IDLE_MIN || 10) * 60_000;
const MAX_SESSIONS = Number(process.env.BROWSER_MAX_SESSIONS || 4);

const CANDIDATES = [
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/google-chrome",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let chromium: Promise<Browser> | undefined;

/** BROWSER_EXECUTABLE, a system Chrome/Chromium/Edge, or the browser `npx playwright install chromium` downloaded. */
function launch(): Promise<Browser> {
	chromium ??= (async () => {
		let playwright: typeof import("playwright-core");
		try {
			playwright = await import("playwright-core");
		} catch {
			throw new Error("The browser needs playwright-core: run npm install in server/");
		}
		const executablePath = process.env.BROWSER_EXECUTABLE || CANDIDATES.find((file) => existsSync(file));
		try {
			// A context DPR alone does not raise the compositor resolution used by Page.startScreencast.
			const browser = await playwright.chromium.launch({ executablePath, headless: process.env.BROWSER_HEADED !== "1", args: ["--disable-dev-shm-usage", `--force-device-scale-factor=${PIXEL_RATIO}`] });
			browser.on("disconnected", () => (chromium = undefined));
			return browser;
		} catch (error) {
			throw new Error(`Could not start a browser (set BROWSER_EXECUTABLE or run npx playwright install chromium): ${(error as Error).message.split("\n")[0]}`);
		}
	})();
	chromium.catch(() => (chromium = undefined));
	return chromium;
}

export interface PickedElement {
	selector: string;
	tag: string;
	role?: string;
	text: string;
	html: string;
	box: { x: number; y: number; width: number; height: number };
	component?: string;
	source?: string;
}

/**
 * Runs in the page: what is under a point (`hover` only wants its box), or the outermost elements
 * inside a rectangle. `depth` picks from the stack of elements under the point, topmost first
 * (overlapping layers, then the elements containing them), to reach ones covered by others.
 * Plain JavaScript in a string, since the server is not compiled against the DOM.
 */
export const PICK = String.raw`(arg) => {
  const box = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch { return false } };
  const selectorOf = (el) => {
    if (el.id && unique("#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);
    for (const attr of ["data-testid", "data-test", "data-cy", "name", "aria-label"]) {
      const value = el.getAttribute(attr);
      const sel = value && el.localName + "[" + attr + "=" + JSON.stringify(value) + "]";
      if (sel && unique(sel)) return sel;
    }
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node !== el && node.id && unique("#" + CSS.escape(node.id))) { parts.unshift("#" + CSS.escape(node.id)); break; }
      let part = node.localName;
      const classes = [...node.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && !/\d{3,}/.test(c)).slice(0, 2);
      if (classes.length) part += "." + classes.map((c) => CSS.escape(c)).join(".");
      if (unique([part, ...parts].join(" > "))) { parts.unshift(part); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (unique(parts.join(" > "))) break;
    }
    return parts.join(" > ");
  };
  // Where the element comes from in the app's source: build-time attributes (code-inspector-plugin,
  // react-dev-inspector), Vue's component file, or React's debug info (_debugSource up to React 18,
  // the owner's _debugStack from React 19).
  const origin = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const insp = n.getAttribute("data-insp-path");
      if (insp) return { source: insp.split(":").slice(0, 2).join(":") };
      const rel = n.getAttribute("data-inspector-relative-path");
      if (rel) return { source: rel + ":" + (n.getAttribute("data-inspector-line") || "") };
      const vue = n.__vueParentComponent;
      if (vue && vue.type) return { component: vue.type.__name || vue.type.name, source: vue.type.__file };
      const key = Object.keys(n).find((k) => k.startsWith("__reactFiber$"));
      if (!key) continue;
      let component, source;
      for (let f = n[key]; f; f = f.return) {
        if (!source && f._debugSource) source = f._debugSource.fileName + ":" + f._debugSource.lineNumber;
        if (!source && f._debugStack && f._debugStack.stack) {
          const frame = f._debugStack.stack.split("\n").map((l) => /(?:https?:\/\/[^/]+)?(\/[^\s?)]+)(?:\?[^\s:)]*)?:(\d+):\d+/.exec(l)).find((m) => m && !/node_modules|react-dom|react\.|jsx-dev-runtime/.test(m[1]));
          if (frame) source = frame[1].replace(/^\//, "") + ":" + frame[2];
        }
        if (!component && typeof f.type === "function") component = f.type.displayName || f.type.name;
        if (component && source) break;
      }
      return { component, source };
    }
    return {};
  };
  const describe = (el) => {
    const html = el.outerHTML;
    return {
      selector: selectorOf(el),
      tag: el.localName,
      role: el.getAttribute("role") || undefined,
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300),
      html: html.length > 1500 ? html.slice(0, 1500) + "…" : html,
      box: box(el.getBoundingClientRect()),
      ...origin(el),
    };
  };
  const stackAt = (x, y) => {
    const all = document.elementsFromPoint(x, y);
    let stack = all.filter((el) => el !== document.documentElement && el !== document.body);
    if (!stack.length) stack = all;
    // Into open shadow roots: their elements come before the host.
    for (let host = stack[0]; host && host.shadowRoot; ) {
      const inner = host.shadowRoot.elementsFromPoint(x, y).filter((el) => !stack.includes(el));
      if (!inner.length) break;
      stack = [...inner, ...stack];
      host = inner[0];
    }
    return stack;
  };
  const at = (x, y, depth = 0) => {
    const stack = stackAt(x, y);
    const index = Math.max(0, Math.min(depth, stack.length - 1));
    return { el: stack[index], depth: index, count: stack.length };
  };
  if (arg.rect) {
    const r = arg.rect;
    const inside = [...document.body.querySelectorAll("*")].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.left >= r.x && b.top >= r.y && b.right <= r.x + r.width && b.bottom <= r.y + r.height;
    });
    const set = new Set(inside);
    const outer = inside.filter((el) => !set.has(el.parentElement)).slice(0, 12);
    const found = outer.length ? outer : [at(r.x + r.width / 2, r.y + r.height / 2).el].filter(Boolean);
    return { box: r, elements: found.map(describe) };
  }
  const { el, depth, count } = at(arg.x, arg.y, arg.depth || 0);
  if (!el) return null;
  if (arg.hover) {
    const cls = [...el.classList].slice(0, 2).map((c) => "." + c).join("");
    return { box: box(el.getBoundingClientRect()), label: el.localName + (el.id ? "#" + el.id : cls), depth, count };
  }
  const d = describe(el);
  return { box: d.box, elements: [d] };
}`;

/**
 * Runs in every page before its own scripts (top frame only) and reports to the server through the
 * `__beezyReport` binding: which element has focus and whether it takes text, where the editable
 * fields are (so a tap on a phone can open the native keyboard right away), and text the page
 * copies, for the viewer's clipboard. Copies are kept off Chromium's clipboard, which every
 * session's browser shares.
 */
export const HOOKS = String.raw`(() => {
  if (window !== window.top || window.__beezyHooked) return;
  window.__beezyHooked = true;
  const report = (data) => { try { window.__beezyReport(JSON.stringify(data)) } catch {} };
  const EDITABLE = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=range]):not([type=color]):not([type=image]):not([type=hidden]), textarea, [contenteditable]:not([contenteditable=false]), [role=textbox]";
  const editable = (el) => !!el && el.nodeType === 1 && (el.isContentEditable || (el.matches(EDITABLE) && !el.disabled && !el.readOnly));
  const active = () => { let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; return el };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
  const MODES = { email: "email", tel: "tel", url: "url", number: "decimal", search: "search" };
  let lastFocus = "";
  const focus = (force) => {
    const el = active();
    const info = editable(el)
      ? { editable: true, box: box(el), inputMode: el.inputMode || MODES[el.type] || "text", enterKeyHint: el.enterKeyHint || "", multiline: el.localName === "textarea" || el.isContentEditable, password: el.type === "password" }
      : { editable: false };
    const text = JSON.stringify(info);
    if (text === lastFocus && !force) return;
    lastFocus = text;
    report({ kind: "focus", ...info });
  };
  let lastAreas = "";
  const areas = () => {
    const boxes = [];
    for (const el of document.querySelectorAll(EDITABLE)) {
      if (!editable(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      boxes.push(box(el));
      if (boxes.length >= 300) break;
    }
    const text = JSON.stringify(boxes);
    if (text === lastAreas) return;
    lastAreas = text;
    report({ kind: "editables", boxes });
  };
  let timer = 0;
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = 0; areas(); focus() }, 250) };
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule);
  addEventListener("focusin", () => setTimeout(() => focus()), true);
  addEventListener("focusout", () => setTimeout(() => focus()), true);
  // After every click, so a viewer who opened the keyboard on a guess learns whether it was right.
  addEventListener("mouseup", () => setTimeout(() => focus(true), 30), true);
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "disabled", "readonly", "contenteditable"] });
  addEventListener("DOMContentLoaded", schedule);
  addEventListener("load", schedule);

  const selected = () => {
    const el = active();
    if (el && (el.localName === "input" || el.localName === "textarea")) return el.type === "password" ? "" : el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    return String(getSelection() || "");
  };
  const clip = (text, extra) => text && report({ kind: "clipboard", text: String(text).slice(0, 100000), ...extra });
  const onCopy = (e) => {
    if (e.defaultPrevented) {
      // The page put its own data on the clipboard.
      try { clip(e.clipboardData.getData("text/plain")) } catch {}
      return;
    }
    // Kept off the shared clipboard. For a cut, the server then deletes the selection with a key press.
    clip(selected(), e.type === "cut" ? { remove: true } : undefined);
    e.preventDefault();
  };
  addEventListener("copy", onCopy);
  addEventListener("cut", onCopy);
  const clipboard = navigator.clipboard;
  if (clipboard) {
    clipboard.writeText = async (text) => clip(text);
    clipboard.write = async (items) => {
      for (const item of items || []) if (item.types.includes("text/plain")) return clip(await (await item.getType("text/plain")).text());
    };
  }
})()`;

/** Runs in the page: the selected text, or the selection in the focused field (never a password). */
const SELECTED_TEXT = String.raw`(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (el && (el.localName === "input" || el.localName === "textarea")) return el.type === "password" ? "" : el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  return String(getSelection() || "");
})()`;

export interface FocusInfo {
	editable: boolean;
	box?: PickedElement["box"];
	inputMode?: string;
	enterKeyHint?: string;
	multiline?: boolean;
	password?: boolean;
}

export interface LogEntry {
	at: number;
	kind: "console" | "pageerror" | "request";
	level: string;
	text: string;
}

const report = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("focus"), editable: z.boolean(), box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(), inputMode: z.string().max(20).optional(), enterKeyHint: z.string().max(20).optional(), multiline: z.boolean().optional(), password: z.boolean().optional() }),
	z.object({ kind: z.literal("editables"), boxes: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })).max(300) }),
	z.object({ kind: z.literal("clipboard"), text: z.string().max(100_000), remove: z.boolean().optional() }),
]);

interface Pick {
	box: PickedElement["box"];
	elements: PickedElement[];
}

class SessionBrowser {
	private viewers = new Map<WebSocket, { canInput: boolean; visible: boolean; size?: { width: number; height: number } }>();
	private viewportOwner?: WebSocket;
	private cdp?: CDPSession;
	private frame?: Buffer;
	private searchHistory = new Map<string, string>();
	private idle?: NodeJS.Timeout;
	private castSize?: { width: number; height: number };
	private castQueue = Promise.resolve();
	private capturingPick = false;
	private queue = Promise.resolve();
	private focus: FocusInfo = { editable: false };
	private editables: PickedElement["box"][] = [];
	/** Who last drove the page by hand, to receive what the page copies. */
	private lastInput?: { ws: WebSocket; at: number };
	private pendingCopy?: (copied: { text: string; remove?: boolean }) => void;
	/** Recent console messages, page errors and failed requests, for browser_console. */
	readonly log: LogEntry[] = [];
	closed = false;

	constructor(
		readonly key: string,
		private context: BrowserContext,
		readonly page: Page,
	) {}

	static async open(key: string) {
		const browser = await launch();
		const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: PIXEL_RATIO, acceptDownloads: false });
		const page = await context.newPage();
		const session = new SessionBrowser(key, context, page);
		await session.init();
		return session;
	}

	private async init() {
		await this.context.exposeBinding("__beezyReport", (source, raw) => {
			if (source.page !== this.page || source.frame !== this.page.mainFrame()) return;
			try {
				this.onReport(report.parse(JSON.parse(String(raw))));
			} catch {
				// A page can call the binding itself; ignore what does not fit.
			}
		});
		await this.context.addInitScript(HOOKS);
		const record = (kind: LogEntry["kind"], level: string, text: string) => {
			this.log.push({ at: Date.now(), kind, level, text: text.slice(0, 2000) });
			if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
		};
		this.page.on("console", (message) => record("console", message.type(), message.text()));
		this.page.on("pageerror", (error) => record("pageerror", "error", error.stack || error.message));
		this.page.on("requestfailed", (request) => record("request", "error", `${request.method()} ${request.url()} failed: ${request.failure()?.errorText ?? "unknown error"}`));
		this.page.on("response", (response) => response.status() >= 400 && record("request", "error", `${response.request().method()} ${response.url()} → ${response.status()}`));
		await this.page.route((url) => url.origin === new URL(SEARCH_PAGE).origin, async (route) => {
			const body = this.searchHistory.get(route.request().url());
			await route.fulfill({ status: body ? 200 : 404, contentType: body ? "text/html; charset=utf-8" : "text/plain", body: body ?? "Enter a keyword in the address bar to search.", headers: { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "referrer-policy": "no-referrer", "cache-control": "no-store" } });
		});
		this.cdp = await this.context.newCDPSession(this.page);
		this.cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
			void this.cdp?.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
			const viewport = this.page.viewportSize() ?? VIEWPORT;
			if (this.capturingPick || metadata.deviceWidth !== viewport.width || metadata.deviceHeight !== viewport.height) return;
			if (!this.castSize || !this.hasVisibleViewer()) return;
			this.frame = Buffer.from(data, "base64");
			for (const [ws, viewer] of this.viewers) {
				if (!viewer.visible) continue;
				// A slow viewer skips frames rather than queueing them.
				if (ws.readyState === ws.OPEN && ws.bufferedAmount < 2_000_000) ws.send(this.frame);
			}
		});
		// One page per session: popups open in it instead.
		this.context.on("page", async (popup) => {
			await popup.waitForURL((url) => url.href !== "about:blank", { timeout: 5000 }).catch(() => {});
			const url = popup.url();
			await popup.close().catch(() => {});
			if (/^https?:/.test(url)) void this.page.goto(url).catch(() => {});
		});
		this.page.on("framenavigated", (frame) => frame === this.page.mainFrame() && this.announce());
		this.page.on("load", () => this.announce());
		this.page.on("close", () => void close(this.key));
		this.touch();
	}

	private onReport(data: z.infer<typeof report>) {
		if (data.kind === "clipboard") {
			if (this.pendingCopy) return this.pendingCopy(data);
			const recent = this.lastInput;
			if (recent && Date.now() - recent.at < 5000) send(recent.ws, { type: "clipboard", text: data.text });
			return;
		}
		if (data.kind === "focus") {
			const { kind: _, ...focus } = data;
			this.focus = focus;
			for (const [ws, viewer] of this.viewers) if (viewer.canInput) send(ws, { type: "focus", ...focus });
			return;
		}
		this.editables = data.boxes;
		for (const [ws, viewer] of this.viewers) if (viewer.canInput) send(ws, { type: "editables", boxes: data.boxes });
	}

	/** Copies (or cuts) the page's selection as the page itself would, and returns the text. */
	private async copySelection(cut: boolean) {
		const reported = new Promise<{ text: string; remove?: boolean } | undefined>((resolve) => {
			this.pendingCopy = resolve;
			setTimeout(() => resolve(undefined), 500);
		});
		try {
			// A user gesture, so the page's own copy handlers (code editors, rich text) run.
			await this.cdp?.send("Runtime.evaluate", { expression: `document.execCommand(${JSON.stringify(cut ? "cut" : "copy")})`, userGesture: true }).catch(() => {});
			const copied = await reported;
			const text = copied?.text || ((await this.page.evaluate(SELECTED_TEXT).catch(() => "")) as string);
			if (!text) throw new Error("Select text on the page first.");
			if (cut && (!copied || copied.remove)) await this.page.keyboard.press("Delete");
			return text;
		} finally {
			this.pendingCopy = undefined;
		}
	}

	status() {
		return { open: !this.closed, url: this.page.url(), viewport: this.page.viewportSize() ?? VIEWPORT };
	}

	private async announce() {
		const title = await this.page.title().catch(() => "");
		const state = { type: "state", ...this.status(), title };
		for (const ws of this.viewers.keys()) send(ws, state);
		platform().realtime.publish(this.key, { type: "browser", open: true, url: state.url, title });
	}

	/** Postpones closing; the browser closes once nobody watches and the agent leaves it alone. */
	touch() {
		clearTimeout(this.idle);
		this.idle = setTimeout(() => {
			if (!this.hasVisibleViewer()) void close(this.key);
			else this.touch();
		}, IDLE_MS);
		this.idle.unref();
	}

	private hasVisibleViewer() {
		return [...this.viewers.values()].some((viewer) => viewer.visible);
	}

	private updateScreencast() {
		// Serialize CDP start/stop across visibility, resizing and screenshot requests.
		this.castQueue = this.castQueue.then(async () => {
			if (!this.cdp || this.closed) return;
			let width = 0, height = 0;
			if (!this.capturingPick) for (const viewer of this.viewers.values()) {
				if (!viewer.visible) continue;
				width = Math.max(width, viewer.size?.width ?? MAX_VIEWPORT.width * PIXEL_RATIO);
				height = Math.max(height, viewer.size?.height ?? MAX_VIEWPORT.height * PIXEL_RATIO);
			}
			if (this.castSize?.width === width && this.castSize.height === height) return;
			if (this.castSize) {
				this.castSize = undefined;
				await this.cdp.send("Page.stopScreencast");
			}
			if (width && height && !this.closed && !this.capturingPick && this.hasVisibleViewer()) {
				this.castSize = { width, height };
				try {
					await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: width, maxHeight: height });
				} catch {
					this.castSize = undefined;
				}
			}
		}).catch(() => {});
		return this.castQueue;
	}

	async join(ws: WebSocket, canInput: boolean) {
		if (ws.readyState !== ws.OPEN || this.closed) return;
		this.viewers.set(ws, { canInput, visible: true });
		this.touch();
		if (canInput) this.viewportOwner ??= ws;
		// Listen before the first await, or messages sent right after the state arrives are lost.
		ws.on("message", (raw, binary) => {
			if (binary) return;
			let message: unknown;
			try {
				message = JSON.parse(String(raw));
			} catch {
				return;
			}
			this.touch();
			// One at a time and in order, so a click's press and release do not overtake each other.
			this.queue = this.queue.then(() => this.handle(ws, canInput, message)).catch((error) => send(ws, { type: "error", message: (error as Error).message.split("\n")[0] }));
		});
		ws.on("close", () => {
			this.viewers.delete(ws);
			if (this.viewportOwner === ws) {
				this.viewportOwner = undefined;
				if (!this.closed) {
					for (const [viewer, access] of this.viewers) {
						if (!access.canInput || viewer.readyState !== viewer.OPEN) continue;
						this.viewportOwner = viewer;
						send(viewer, { type: "viewport-control", canResize: true });
						break;
					}
				}
			}
			void this.updateScreencast();
		});
		const title = await this.page.title().catch(() => "");
		if (ws.readyState !== ws.OPEN) return;
		send(ws, { type: "state", ...this.status(), title, canInput, canResize: ws === this.viewportOwner });
		if (canInput) {
			send(ws, { type: "focus", ...this.focus });
			send(ws, { type: "editables", boxes: this.editables });
		}
		if (this.frame && this.viewers.get(ws)?.visible) ws.send(this.frame);
		await this.updateScreencast();
	}

	private async handle(ws: WebSocket, canInput: boolean, raw: unknown) {
		const message = clientMessage.parse(raw);
		if (message.type === "presentation") {
			const viewer = this.viewers.get(ws);
			if (!viewer) return;
			const resumed = !viewer.visible && message.visible;
			viewer.visible = message.visible;
			viewer.size = message.size;
			if (resumed && this.frame && ws.readyState === ws.OPEN && ws.bufferedAmount < 2_000_000) ws.send(this.frame);
			await this.updateScreencast();
			return;
		}
		if (message.type === "inspect") {
			const hit = (await this.page.evaluate(`(${PICK})(${JSON.stringify({ x: message.x, y: message.y, depth: message.depth, hover: true })})`)) as { box: Pick["box"]; label: string; depth: number; count: number } | null;
			return send(ws, { type: "hover", ...hit });
		}
		if (message.type === "pick") {
			const pick = await this.pick(message.rect ?? { x: message.x ?? 0, y: message.y ?? 0, depth: message.depth });
			return send(ws, { type: "picked", id: message.id, ...pick });
		}
		if (message.type === "copy" && !message.cut) {
			return send(ws, { type: "copied", id: message.id, text: await this.copySelection(false) });
		}
		if (!canInput) throw new Error("You have view-only access to this browser.");
		if (message.type === "mouse" || message.type === "key" || message.type === "text" || message.type === "press" || message.type === "copy") this.lastInput = { ws, at: Date.now() };
		if (message.type === "copy") return send(ws, { type: "copied", id: message.id, text: await this.copySelection(true) });
		if (message.type === "quote" || message.type === "select-text") {
			const text = await this.page.evaluate((range) => {
				if (range) {
					const start = document.caretRangeFromPoint(range.start.x, range.start.y);
					const end = document.caretRangeFromPoint(range.end.x, range.end.y);
					const isText = (node?: Node) => node?.nodeType === Node.TEXT_NODE && !node.parentElement?.closest('input, textarea, [contenteditable]');
					if (!start || !end || !isText(start.startContainer) || !isText(end.startContainer)) return "";
					const selection = window.getSelection();
					selection?.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
				}
				const selection = window.getSelection();
				if (!selection || selection.anchorNode?.parentElement?.closest('input, textarea, [contenteditable]')) return "";
				return selection.toString().trim().slice(0, 4000);
			}, message.type === "select-text" ? { start: message.start, end: message.end } : undefined);
			if (!text) throw new Error("Select text on the page first.");
			return send(ws, { type: "quoted", text });
		}
		switch (message.type) {
			case "navigate":
				await this.goto(message.url);
				break;
			case "back":
				await this.page.goBack().catch(() => {});
				break;
			case "forward":
				await this.page.goForward().catch(() => {});
				break;
			case "reload":
				await this.page.reload().catch(() => {});
				break;
			case "viewport": {
				if (ws !== this.viewportOwner) break;
				const { width, height } = message;
				const current = this.page.viewportSize();
				if (current?.width === width && current.height === height) break;
				// Keep the stream running: restarting can capture the old surface at the new limits.
				this.frame = undefined;
				await this.page.setViewportSize({ width, height });
				await this.announce();
				break;
			}
			case "mouse":
				await this.cdp?.send("Input.dispatchMouseEvent", {
					type: message.action === "down" ? "mousePressed" : message.action === "up" ? "mouseReleased" : message.action === "wheel" ? "mouseWheel" : "mouseMoved",
					x: message.x,
					y: message.y,
					button: message.action === "move" || message.action === "wheel" ? "none" : message.button,
					buttons: message.buttons,
					clickCount: message.clickCount,
					deltaX: message.deltaX ?? 0,
					deltaY: message.deltaY ?? 0,
					modifiers: message.modifiers,
				});
				break;
			case "key":
				// Keys Playwright does not know (dead keys, IME composition) are skipped; text arrives as "text".
				await (message.action === "down" ? this.page.keyboard.down(message.key) : this.page.keyboard.up(message.key)).catch(() => {});
				break;
			case "text":
				await this.page.keyboard.insertText(message.text);
				break;
			case "press":
				await this.page.keyboard.press(message.key).catch(() => {});
				break;
			case "close":
				await close(this.key);
				break;
		}
	}

	async goto(input: string) {
		let url = normalizeUrl(input);
		if (input.trim() !== url && url.startsWith(`${SEARCH_PAGE}?`)) {
			const query = new URL(url).searchParams.get("q") ?? "";
			if (!process.env.BRAVE_SEARCH_API_KEY) {
				url = /^hacker\s*news$/i.test(query) ? "https://news.ycombinator.com/" : `https://www.bing.com/search?${new URLSearchParams({ q: query, setlang: "en", cc: "US" })}`;
			} else {
				this.searchHistory.set(url, await searchPage(query));
				if (this.searchHistory.size > 50) this.searchHistory.delete(this.searchHistory.keys().next().value!);
			}
		}
		const response = await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
		const error = searchResponseError(url, response?.status());
		if (error) throw new Error(error);
		await this.page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
	}

	/** The elements at a point or in a rectangle, with a PNG of that area (base64). */
	async pick(target: { x: number; y: number; width?: number; height?: number; depth?: number }) {
		const arg = target.width ? { rect: target } : target;
		const pick = (await this.page.evaluate(`(${PICK})(${JSON.stringify(arg)})`)) as Pick | null;
		if (!pick || !pick.elements.length) throw new Error("Nothing there to pick.");
		const viewport = this.page.viewportSize() ?? VIEWPORT;
		const pad = 4;
		const x = Math.max(0, pick.box.x - pad);
		const y = Math.max(0, pick.box.y - pad);
		const clip = { x, y, width: Math.min(viewport.width, pick.box.x + pick.box.width + pad) - x, height: Math.min(viewport.height, pick.box.y + pick.box.height + pad) - y };
		let image: string | undefined;
		if (clip.width > 2 && clip.height > 2) {
			// Chromium can stream the temporary cropped surface. Keep showing the last full frame.
			this.capturingPick = true;
			try {
				await this.updateScreencast();
				image = (await this.page.screenshot({ clip, type: "png" })).toString("base64");
			} finally {
				this.capturingPick = false;
				await this.updateScreencast();
			}
		}
		return { url: this.page.url(), title: await this.page.title().catch(() => ""), ...pick, image };
	}

	async close() {
		if (this.closed) return;
		this.closed = true;
		clearTimeout(this.idle);
		for (const ws of this.viewers.keys()) ws.close(1000, "Browser closed");
		await this.context.close().catch(() => {});
		platform().realtime.publish(this.key, { type: "browser", open: false });
	}
}

const point = { x: z.number().finite(), y: z.number().finite() };
const clientMessage = z.discriminatedUnion("type", [
	z.object({ type: z.literal("presentation"), visible: z.boolean(), size: z.object({ width: z.number().int().min(1).max(MAX_VIEWPORT.width * PIXEL_RATIO), height: z.number().int().min(1).max(MAX_VIEWPORT.height * PIXEL_RATIO) }).optional() }),
	z.object({ type: z.literal("inspect"), ...point, depth: z.number().int().min(0).max(200).optional() }),
	z.object({ type: z.literal("pick"), id: z.string().max(100), x: z.number().finite().optional(), y: z.number().finite().optional(), depth: z.number().int().min(0).max(200).optional(), rect: z.object({ ...point, width: z.number().positive(), height: z.number().positive() }).optional() }),
	z.object({ type: z.literal("navigate"), url: z.string().min(1).max(4000) }),
	z.object({ type: z.enum(["back", "forward", "reload", "close", "quote"]) }),
	z.object({ type: z.literal("select-text"), start: z.object(point), end: z.object(point) }),
	z.object({ type: z.literal("viewport"), width: z.number().int().min(320).max(MAX_VIEWPORT.width), height: z.number().int().min(320).max(MAX_VIEWPORT.height) }),
	z.object({
		type: z.literal("mouse"),
		action: z.enum(["move", "down", "up", "wheel"]),
		...point,
		button: z.enum(["left", "middle", "right"]).default("left"),
		buttons: z.number().int().min(0).max(31).optional(),
		clickCount: z.number().int().min(0).max(3).default(1),
		deltaX: z.number().finite().optional(),
		deltaY: z.number().finite().optional(),
		modifiers: z.number().int().min(0).max(15).optional(),
	}),
	z.object({ type: z.literal("key"), action: z.enum(["down", "up"]), key: z.string().min(1).max(40) }),
	z.object({ type: z.literal("text"), text: z.string().max(100_000) }),
	// A key or combination for Playwright, e.g. "Backspace" or "Control+a".
	z.object({ type: z.literal("press"), key: z.string().min(1).max(60) }),
	z.object({ type: z.literal("copy"), id: z.string().max(100), cut: z.boolean().optional() }),
]);

import { SEARCH_PAGE, searchPage, searchUrl } from "./browser-search.js";

export function searchResponseError(url: string, status?: number): string | undefined {
	if (![202, 403, 429].includes(status ?? 0)) return;
	const target = new URL(url);
	if (target.origin === "https://html.duckduckgo.com" && target.pathname === "/html/" && target.searchParams.has("q")) {
		return `DuckDuckGo blocked or challenged this browser’s search (HTTP ${status}). Open a site directly or try another search engine.`;
	}
}

/** http(s) only; a bare host gets http:// when it is local and https:// otherwise. Anything that is not an address is searched. */
export function normalizeUrl(input: string) {
	const text = input.trim();
	if (text === "about:blank") return text;
	const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(localhost|\[::1\])(?=[:/?#]|$)/i.test(text) || /^[^\s/]+:\d+(?=[/?#]|$)/.test(text) || /^[^\s/?#]+\.[a-z][a-z0-9-]*\.?(?=[:/?#]|$)/i.test(text) || /^\d+\.\d+\.\d+\.\d+(?=[:/?#]|$)/.test(text);
	if (!address) return searchUrl(text);
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : /^(localhost|127\.|\[::1\]|0\.0\.0\.0|\d+\.\d+\.\d+\.\d+)/.test(text) || /^[^/]+:\d+/.test(text) ? `http://${text}` : `https://${text}`;
	const url = new URL(withScheme);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages can be opened.");
	return url.href;
}

function send(ws: WebSocket, message: unknown) {
	if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const sessions = new Map<string, Promise<SessionBrowser>>();

function get(key: string) {
	let session = sessions.get(key);
	if (!session) {
		if (sessions.size >= MAX_SESSIONS) throw new HttpError(429, `At most ${MAX_SESSIONS} browsers can be open at once; close one first.`);
		session = SessionBrowser.open(key);
		session.catch(() => sessions.delete(key));
		sessions.set(key, session);
	}
	return session;
}

async function close(key: string) {
	const session = sessions.get(key);
	if (!session) return;
	sessions.delete(key);
	await (await session.catch(() => undefined))?.close();
	if (sessions.size === 0) {
		const browser = chromium;
		chromium = undefined;
		await (await browser?.catch(() => undefined))?.close().catch(() => {});
	}
}

/** Close a session's browser, e.g. when the session is deleted. */
export const closeSessionBrowser = (key: string) => close(key);

export async function closeBrowsers() {
	await Promise.allSettled([...sessions.keys()].map(close));
}

async function status(key: string) {
	const session = await sessions.get(key)?.catch(() => undefined);
	return session && !session.closed ? { ...session.status(), title: await session.page.title().catch(() => "") } : { open: false };
}

/**
 * The browser of a session over a WebSocket at /api/browser?key=<session>. Server frames are JPEG
 * frames (binary) and JSON messages; client frames are the JSON messages `clientMessage` accepts.
 */
export function attachBrowser(server: Server) {
	const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

	server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (url.pathname !== "/api/browser") return;
		const request = req as Request;
		authenticate(request, {} as Response, () => {
			const refuse = (status: string) => {
				socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
				socket.destroy();
			};
			if (!request.user) return refuse("401 Unauthorized");
			if (!isTenantMember(request.user.id)) return refuse("403 Forbidden");
			if (url.searchParams.get("tenant") && url.searchParams.get("tenant") !== tenantId()) return refuse("403 Forbidden");
			if (!sameOrigin(req)) return refuse("403 Forbidden");
			const key = url.searchParams.get("key") ?? "";
			const meta = store.session(key);
			const access = meta && !meta.deleted ? accessOf(request.user, meta) : undefined;
			if (!access) return refuse("404 Not Found");
			const canInput = access === "admin" || access === "owner" || access === "write";
			wss.handleUpgrade(req, socket, head, async (ws) => {
				// Read-only viewers can watch a browser someone opened, not start one.
				if (!canInput && !sessions.has(key)) return ws.close(4004, "Nobody has opened a browser in this session yet.");
				try {
					await (await get(key)).join(ws, canInput);
				} catch (error) {
					ws.close(4000, (error as Error).message.slice(0, 120));
				}
			});
		});
	});
}

const selector = z.string().min(1).max(2000);
const bridgeAction = z.discriminatedUnion("action", [
	z.object({ action: z.literal("open"), url: z.string().min(1).max(4000) }),
	z.object({ action: z.literal("snapshot"), selector: selector.optional() }),
	z.object({ action: z.literal("screenshot"), selector: selector.optional(), fullPage: z.boolean().optional() }),
	z.object({ action: z.literal("click"), selector, button: z.enum(["left", "right", "middle"]).optional(), clickCount: z.number().int().min(1).max(3).optional() }),
	z.object({ action: z.literal("type"), selector, text: z.string().max(10_000), submit: z.boolean().optional(), append: z.boolean().optional() }),
	z.object({ action: z.literal("press"), key: z.string().min(1).max(60), selector: selector.optional() }),
	z.object({ action: z.literal("hover"), selector }),
	z.object({ action: z.literal("select"), selector, values: z.array(z.string().max(1000)).min(1).max(50) }),
	z.object({ action: z.literal("scroll"), selector: selector.optional(), to: z.enum(["top", "bottom"]).optional(), dx: z.number().finite().optional(), dy: z.number().finite().optional() }),
	z.object({
		action: z.literal("wait"),
		selector: selector.optional(),
		state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
		text: z.string().min(1).max(1000).optional(),
		url: z.string().min(1).max(4000).optional(),
		load: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
		timeoutMs: z.number().int().min(0).max(30_000).optional(),
	}),
	z.object({ action: z.literal("history"), go: z.enum(["back", "forward", "reload"]) }),
	z.object({ action: z.literal("evaluate"), expression: z.string().min(1).max(20_000) }),
	z.object({ action: z.literal("console"), errorsOnly: z.boolean().optional(), limit: z.number().int().min(1).max(300).optional(), clear: z.boolean().optional() }),
	z.object({ action: z.literal("close") }),
]);

const stringify = (value: unknown) => {
	if (value === undefined) return "undefined";
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
	return text.length > 20_000 ? `${text.slice(0, 20_000)}\n…(truncated)` : text;
};

export function browserRoutes(): Router {
	const router = express.Router();

	router.get("/sessions/:key/browser", requireAuth, async (req, res) => {
		const meta = store.session(String(req.params.key));
		if (!meta || meta.deleted || !accessOf(req.user!, meta)) throw new HttpError(404, "Session not found");
		res.json(await status(meta.key));
	});

	/** The agent drives the same browser the people in the session see, through its bridge credential. */
	router.use("/browser-bridge/:key", (req, _res, next) => {
		const key = String(req.params.key);
		if (!bridgeCredentialValid(key, req.headers.authorization)) throw new HttpError(403, "Invalid bridge credential");
		const tenant = tenantOf(store.session(key)?.tenantId ?? "work");
		return tenant ? inTenant(tenant, next) : next();
	});
	router.post("/browser-bridge/:key", async (req, res) => {
		const key = String(req.params.key);
		const meta = store.session(key);
		if (!meta || meta.deleted) throw new HttpError(404, "Session not found");
		const body = bridgeAction.parse(req.body);
		if (body.action === "close") {
			await close(key);
			return void res.json({ closed: true });
		}
		if (body.action !== "open" && !sessions.has(key)) throw new HttpError(409, "No browser is open in this session; open a URL first.");
		const session = await get(key);
		session.touch();
		const page = session.page;
		const done = async (extra: Record<string, unknown> = {}) => res.json({ url: page.url(), title: await page.title().catch(() => ""), ...extra });
		try {
			switch (body.action) {
				case "open":
					await session.goto(body.url);
					return void (await done());
				case "snapshot": {
					const snapshot = await page.locator(body.selector ?? "body").first().ariaSnapshot({ timeout: 5000 });
					return void (await done({ snapshot: snapshot.length > 20_000 ? `${snapshot.slice(0, 20_000)}\n…(truncated)` : snapshot }));
				}
				case "screenshot": {
					const image = body.selector
						? await page.locator(body.selector).first().screenshot({ type: "jpeg", quality: 70, timeout: 5000 })
						: await page.screenshot({ type: "jpeg", quality: 70, fullPage: body.fullPage });
					return void (await done({ image: image.toString("base64") }));
				}
				case "click":
					await page.click(body.selector, { timeout: 5000, button: body.button, clickCount: body.clickCount });
					await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
					return void (await done());
				case "type":
					if (body.append) {
						await page.focus(body.selector, { timeout: 5000 });
						await page.keyboard.press("End");
						await page.keyboard.insertText(body.text);
					} else await page.fill(body.selector, body.text, { timeout: 5000 });
					if (body.submit) await page.press(body.selector, "Enter");
					return void (await done());
				case "press":
					if (body.selector) await page.press(body.selector, body.key, { timeout: 5000 });
					else await page.keyboard.press(body.key);
					await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
					return void (await done());
				case "hover":
					await page.hover(body.selector, { timeout: 5000 });
					return void (await done());
				case "select": {
					const selected = await page.selectOption(body.selector, body.values, { timeout: 5000 });
					return void (await done({ selected }));
				}
				case "scroll": {
					const by = { dx: body.dx ?? 0, dy: body.dy ?? 0 };
					if (body.selector && !body.to && !by.dx && !by.dy) await page.locator(body.selector).first().scrollIntoViewIfNeeded({ timeout: 5000 });
					else if (body.selector) {
						// That element's own scroll area, e.g. a list or a panel in an app.
						await page.locator(body.selector).first().evaluate((el, { to, dx, dy }) => (to ? el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight }) : el.scrollBy(dx, dy)), { to: body.to, ...by }, { timeout: 5000 });
					} else if (body.to) {
						await page.evaluate((to) => {
							// The page, or the largest scrolling element when the page itself does not scroll (app shells).
							const root = document.scrollingElement ?? document.documentElement;
							const scrollers = [root, ...document.querySelectorAll("*")].filter((el) => el.scrollHeight > el.clientHeight + 1 && (el === root || /auto|scroll/.test(getComputedStyle(el).overflowY)));
							const target = scrollers.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] ?? root;
							target.scrollTo({ top: to === "top" ? 0 : target.scrollHeight });
						}, body.to);
					} else {
						const size = page.viewportSize() ?? VIEWPORT;
						await page.mouse.move(size.width / 2, size.height / 2);
						await page.mouse.wheel(by.dx, by.dy || 600);
					}
					await page.waitForTimeout(200);
					const position = await page.evaluate(() => ({ scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight }));
					return void (await done(position));
				}
				case "wait": {
					const timeout = body.timeoutMs ?? 10_000;
					const started = Date.now();
					if (body.selector) await page.waitForSelector(body.selector, { state: body.state ?? "visible", timeout });
					if (body.text) await page.getByText(body.text).first().waitFor({ state: body.state === "hidden" || body.state === "detached" ? body.state : "visible", timeout });
					if (body.url) await page.waitForURL((url) => url.href.includes(body.url!), { timeout, waitUntil: "commit" });
					if (body.load) await page.waitForLoadState(body.load, { timeout });
					if (!body.selector && !body.text && !body.url && !body.load) await page.waitForTimeout(Math.min(timeout, 10_000));
					return void (await done({ waitedMs: Date.now() - started }));
				}
				case "history": {
					const go = { back: () => page.goBack({ timeout: 10_000 }), forward: () => page.goForward({ timeout: 10_000 }), reload: () => page.reload({ timeout: 10_000 }) }[body.go];
					await go();
					return void (await done());
				}
				case "evaluate": {
					const result = await Promise.race([
						page.evaluate(body.expression),
						new Promise((_, reject) => setTimeout(() => reject(new Error("The script did not finish within 10 seconds.")), 10_000)),
					]);
					return void (await done({ result: stringify(result) }));
				}
				case "console": {
					const entries = session.log.filter((entry) => !body.errorsOnly || entry.level === "error" || entry.level === "warning").slice(-(body.limit ?? 50));
					if (body.clear) session.log.length = 0;
					return void (await done({ entries }));
				}
			}
		} catch (error) {
			throw new HttpError(400, (error as Error).message.split("\n")[0]);
		}
	});

	return router;
}
