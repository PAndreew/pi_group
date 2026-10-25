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
			const browser = await playwright.chromium.launch({ executablePath, headless: true, args: ["--disable-dev-shm-usage"] });
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
 * inside a rectangle. Plain JavaScript in a string, since the server is not compiled against the DOM.
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
  const at = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };
  if (arg.rect) {
    const r = arg.rect;
    const inside = [...document.body.querySelectorAll("*")].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.left >= r.x && b.top >= r.y && b.right <= r.x + r.width && b.bottom <= r.y + r.height;
    });
    const set = new Set(inside);
    const outer = inside.filter((el) => !set.has(el.parentElement)).slice(0, 12);
    const found = outer.length ? outer : [at(r.x + r.width / 2, r.y + r.height / 2)].filter(Boolean);
    return { box: r, elements: found.map(describe) };
  }
  const el = at(arg.x, arg.y);
  if (!el) return null;
  if (arg.hover) {
    const cls = [...el.classList].slice(0, 2).map((c) => "." + c).join("");
    return { box: box(el.getBoundingClientRect()), label: el.localName + (el.id ? "#" + el.id : cls) };
  }
  const d = describe(el);
  return { box: d.box, elements: [d] };
}`;

interface Pick {
	box: PickedElement["box"];
	elements: PickedElement[];
}

class SessionBrowser {
	private viewers = new Map<WebSocket, { canInput: boolean }>();
	private cdp?: CDPSession;
	private frame?: Buffer;
	private idle?: NodeJS.Timeout;
	private screencasting = false;
	private queue = Promise.resolve();
	closed = false;

	constructor(
		readonly key: string,
		private context: BrowserContext,
		readonly page: Page,
	) {}

	static async open(key: string) {
		const browser = await launch();
		const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: false });
		const page = await context.newPage();
		const session = new SessionBrowser(key, context, page);
		await session.init();
		return session;
	}

	private async init() {
		this.cdp = await this.context.newCDPSession(this.page);
		this.cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
			void this.cdp?.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
			this.frame = Buffer.from(data, "base64");
			for (const ws of this.viewers.keys()) {
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
			if (this.viewers.size === 0) void close(this.key);
			else this.touch();
		}, IDLE_MS);
		this.idle.unref();
	}

	private async screencast(on: boolean) {
		if (on === this.screencasting || !this.cdp) return;
		this.screencasting = on;
		const viewport = this.page.viewportSize() ?? VIEWPORT;
		if (on) await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: viewport.width, maxHeight: viewport.height }).catch(() => {});
		else await this.cdp.send("Page.stopScreencast").catch(() => {});
	}

	async join(ws: WebSocket, canInput: boolean) {
		this.viewers.set(ws, { canInput });
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
			if (this.viewers.size === 0) void this.screencast(false);
		});
		send(ws, { type: "state", ...this.status(), title: await this.page.title().catch(() => ""), canInput });
		if (this.frame) ws.send(this.frame);
		await this.screencast(true);
	}

	private async handle(ws: WebSocket, canInput: boolean, raw: unknown) {
		const message = clientMessage.parse(raw);
		if (message.type === "inspect") {
			const hit = (await this.page.evaluate(`(${PICK})(${JSON.stringify({ x: message.x, y: message.y, hover: true })})`)) as { box: Pick["box"]; label: string } | null;
			return send(ws, { type: "hover", ...hit });
		}
		if (message.type === "pick") {
			const pick = await this.pick(message.rect ?? { x: message.x ?? 0, y: message.y ?? 0 });
			return send(ws, { type: "picked", id: message.id, ...pick });
		}
		if (!canInput) throw new Error("You have view-only access to this browser.");
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
			case "viewport":
				await this.screencast(false);
				await this.page.setViewportSize({ width: message.width, height: message.height });
				await this.screencast(this.viewers.size > 0);
				await this.announce();
				break;
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
			case "close":
				await close(this.key);
				break;
		}
	}

	async goto(input: string) {
		const url = normalizeUrl(input);
		await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
		await this.page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
	}

	/** The elements at a point or in a rectangle, with a PNG of that area (base64). */
	async pick(target: { x: number; y: number; width?: number; height?: number }) {
		const arg = target.width ? { rect: target } : target;
		const pick = (await this.page.evaluate(`(${PICK})(${JSON.stringify(arg)})`)) as Pick | null;
		if (!pick || !pick.elements.length) throw new Error("Nothing there to pick.");
		const viewport = this.page.viewportSize() ?? VIEWPORT;
		const pad = 4;
		const x = Math.max(0, pick.box.x - pad);
		const y = Math.max(0, pick.box.y - pad);
		const clip = { x, y, width: Math.min(viewport.width, pick.box.x + pick.box.width + pad) - x, height: Math.min(viewport.height, pick.box.y + pick.box.height + pad) - y };
		const image = clip.width > 2 && clip.height > 2 ? (await this.page.screenshot({ clip, type: "png" })).toString("base64") : undefined;
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
	z.object({ type: z.literal("inspect"), ...point }),
	z.object({ type: z.literal("pick"), id: z.string().max(100), x: z.number().finite().optional(), y: z.number().finite().optional(), rect: z.object({ ...point, width: z.number().positive(), height: z.number().positive() }).optional() }),
	z.object({ type: z.literal("navigate"), url: z.string().min(1).max(4000) }),
	z.object({ type: z.enum(["back", "forward", "reload", "close"]) }),
	z.object({ type: z.literal("viewport"), width: z.number().int().min(320).max(1920), height: z.number().int().min(320).max(1600) }),
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
	z.object({ type: z.literal("text"), text: z.string().max(10_000) }),
]);

/** http(s) only; a bare host gets http:// when it is local and https:// otherwise. */
export function normalizeUrl(input: string) {
	const text = input.trim();
	if (text === "about:blank") return text;
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
	const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

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

const bridgeAction = z.discriminatedUnion("action", [
	z.object({ action: z.literal("open"), url: z.string().min(1).max(4000) }),
	z.object({ action: z.literal("snapshot") }),
	z.object({ action: z.literal("screenshot") }),
	z.object({ action: z.literal("click"), selector: z.string().min(1).max(2000) }),
	z.object({ action: z.literal("type"), selector: z.string().min(1).max(2000), text: z.string().max(10_000), submit: z.boolean().optional() }),
	z.object({ action: z.literal("close") }),
]);

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
					const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5000 });
					return void (await done({ snapshot: snapshot.length > 20_000 ? `${snapshot.slice(0, 20_000)}\n…(truncated)` : snapshot }));
				}
				case "screenshot":
					return void (await done({ image: (await page.screenshot({ type: "jpeg", quality: 70 })).toString("base64") }));
				case "click":
					await page.click(body.selector, { timeout: 5000 });
					await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
					return void (await done());
				case "type":
					await page.fill(body.selector, body.text, { timeout: 5000 });
					if (body.submit) await page.press(body.selector, "Enter");
					return void (await done());
			}
		} catch (error) {
			throw new HttpError(400, (error as Error).message.split("\n")[0]);
		}
	});

	return router;
}
