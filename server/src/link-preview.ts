import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import express, { type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { HttpError } from "./paths.js";

export interface LinkPreview {
	url: string;
	title?: string;
	description?: string;
	image?: string;
	siteName?: string;
	icon?: string;
}

// Previews fetch what the agent links to, so they must never reach this machine or its network.
const blocked = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 127], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, prefix, "ipv6");
export const publicAddress = (address: string): boolean => {
	const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (mapped) return publicAddress(mapped[1]);
	const family = isIP(address);
	return family !== 0 && !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
};

/** Resolves like the default lookup but refuses private addresses at connect time, so DNS rebinding cannot slip past. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, "", 0);
		const list = addresses as { address: string; family: number }[];
		const bad = list.find((a) => !publicAddress(a.address));
		if (bad || !list.length) return callback(Object.assign(new Error(`Refusing to preview a private address (${hostname})`), { code: "EPRIVATE" }), "", 0);
		if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
		callback(null, list[0].address, list[0].family);
	});
};

const MAX_BYTES = 512 * 1024;
const TIMEOUT = 6000;

function fetchHtml(url: URL, redirects = 3): Promise<{ url: URL; html: string }> {
	return new Promise((resolve, reject) => {
		if (url.protocol !== "http:" && url.protocol !== "https:") return reject(new HttpError(400, "Only http(s) links can be previewed"));
		if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !publicAddress(url.hostname.replace(/^\[|\]$/g, ""))) return reject(new HttpError(400, "Refusing to preview a private address"));
		const client = url.protocol === "https:" ? https : http;
		const req = client.get(url, {
			lookup: safeLookup,
			timeout: TIMEOUT,
			headers: { "User-Agent": "Mozilla/5.0 (compatible; beezy-link-preview)", Accept: "text/html,application/xhtml+xml", "Accept-Language": "en" },
		}, (res) => {
			const status = res.statusCode ?? 0;
			if (status >= 300 && status < 400 && res.headers.location) {
				res.resume();
				if (!redirects) return reject(new HttpError(502, "Too many redirects"));
				return fetchHtml(new URL(res.headers.location, url), redirects - 1).then(resolve, reject);
			}
			if (status >= 400) { res.resume(); return reject(new HttpError(502, `The site answered ${status}`)); }
			if (!/html|xml/i.test(String(res.headers["content-type"] ?? "text/html"))) { res.resume(); return resolve({ url, html: "" }); }
			let size = 0;
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => {
				size += chunk.length;
				chunks.push(chunk);
				// The <head> is all a preview needs.
				if (size >= MAX_BYTES || /<\/head>/i.test(chunk.toString("latin1"))) res.destroy();
			});
			const done = () => resolve({ url, html: Buffer.concat(chunks).toString("utf8") });
			res.on("end", done);
			res.on("close", done);
			res.on("error", done);
		});
		req.on("timeout", () => req.destroy(new HttpError(504, "The site took too long to answer")));
		req.on("error", (error) => reject(error instanceof HttpError ? error : new HttpError(502, (error as Error).message)));
	});
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
	e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m));
const attrs = (tag: string) => {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
	return out;
};
const clip = (s: string | undefined, n: number) => {
	const t = s?.replace(/\s+/g, " ").trim();
	return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : undefined;
};

/** Open Graph / Twitter card / plain HTML metadata of a page. */
export function parsePreview(html: string, base: URL): LinkPreview {
	const meta: Record<string, string> = {};
	for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
		const a = attrs(m[0]);
		const key = (a.property ?? a.name ?? "").toLowerCase();
		if (key && a.content && !(key in meta)) meta[key] = a.content;
	}
	let icon: string | undefined;
	for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
		const a = attrs(m[0]);
		if (/(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(a.rel ?? "") && a.href) { icon = a.href; if (/apple/i.test(a.rel)) break; }
	}
	const absolute = (href?: string) => {
		if (!href) return undefined;
		try {
			const u = new URL(href, base);
			return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
		} catch { return undefined; }
	};
	const title = meta["og:title"] ?? meta["twitter:title"] ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] && decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]));
	return {
		url: base.href,
		title: clip(title, 200),
		description: clip(meta["og:description"] ?? meta["twitter:description"] ?? meta.description, 400),
		image: absolute(meta["og:image:secure_url"] ?? meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"] ?? meta["twitter:image:src"]),
		siteName: clip(meta["og:site_name"] ?? meta["application-name"], 100) ?? base.hostname.replace(/^www\./, ""),
		icon: absolute(icon ?? "/favicon.ico"),
	};
}

const cache = new Map<string, { at: number; value: Promise<LinkPreview> }>();
const TTL = 60 * 60 * 1000;

export function linkPreview(raw: string): Promise<LinkPreview> {
	const url = new URL(raw);
	url.hash = "";
	const key = url.href;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL) return hit.value;
	const value = fetchHtml(url).then(({ url: final, html }) => parsePreview(html, final));
	value.catch(() => cache.delete(key));
	cache.set(key, { at: Date.now(), value });
	if (cache.size > 500) cache.delete(cache.keys().next().value!);
	return value;
}

export function linkPreviewRoutes(): Router {
	const router = express.Router();
	router.get("/link-preview", requireAuth, async (req, res) => {
		const { url } = z.object({ url: z.url({ protocol: /^https?$/ }).max(2000) }).parse(req.query);
		res.setHeader("Cache-Control", "private, max-age=3600");
		res.json(await linkPreview(url));
	});
	return router;
}
