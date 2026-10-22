import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { KEY_PATTERN, MAX_DESCRIPTION, MAX_VALUE_BYTES, NAMESPACE_PATTERN, VaultError } from "./store.mjs";

/*
 * HTTP API of the vault. One client (the Beezy server) holds the bearer token and decides which
 * namespace a request belongs to; the vault itself knows nothing about users or sessions, so it
 * can move to other hardware or an enclave without changes on that side.
 *
 *   GET    /health
 *   GET    /v1/namespaces/:ns/secrets          → { secrets: [{ key, description, createdAt, updatedAt }] }
 *   GET    /v1/namespaces/:ns/secrets/:key     → { key, description, value, createdAt, updatedAt }
 *   PUT    /v1/namespaces/:ns/secrets/:key     { value?, description? } → secret info without value
 *   DELETE /v1/namespaces/:ns/secrets/:key     → { deleted: true }
 */

const digest = (text) => createHash("sha256").update(text).digest();

export function createVaultServer({ store, token }) {
	if (!token || token.length < 24) throw new Error("VAULT_TOKEN must be set to at least 24 characters");
	const expected = digest(token);
	const authorized = (header) => timingSafeEqual(digest(String(header ?? "").replace(/^Bearer /, "")), expected);

	return http.createServer(async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		try {
			const url = new URL(req.url ?? "/", "http://vault");
			if (req.method === "GET" && url.pathname === "/health") return reply(res, 200, { ok: true });
			if (!authorized(req.headers.authorization)) throw new VaultError(401, "Unauthorized");
			const match = /^\/v1\/namespaces\/([^/]+)\/secrets(?:\/([^/]+))?$/.exec(url.pathname);
			if (!match) throw new VaultError(404, "Not found");
			const namespace = decodeURIComponent(match[1]);
			const key = match[2] === undefined ? undefined : decodeURIComponent(match[2]);
			if (!NAMESPACE_PATTERN.test(namespace)) throw new VaultError(400, "Invalid namespace");
			if (key !== undefined && !KEY_PATTERN.test(key)) throw new VaultError(400, "Keys are letters, digits and underscores, starting with a letter or underscore (max 64)");

			if (key === undefined) {
				if (req.method !== "GET") throw new VaultError(405, "Method not allowed");
				return reply(res, 200, { secrets: store.list(namespace) });
			}
			if (req.method === "GET") {
				const secret = store.get(namespace, key);
				if (!secret) throw new VaultError(404, "No such secret");
				return reply(res, 200, secret);
			}
			if (req.method === "PUT") {
				const body = await readJson(req);
				if (body.value !== undefined && typeof body.value !== "string") throw new VaultError(400, "value must be a string");
				if (body.value !== undefined && (body.value === "" || Buffer.byteLength(body.value) > MAX_VALUE_BYTES)) throw new VaultError(400, `value must be 1 byte to ${MAX_VALUE_BYTES / 1024} KB`);
				if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > MAX_DESCRIPTION)) throw new VaultError(400, `description must be a string of at most ${MAX_DESCRIPTION} characters`);
				return reply(res, 200, store.put(namespace, key, { value: body.value, description: body.description?.trim() }));
			}
			if (req.method === "DELETE") {
				if (!store.delete(namespace, key)) throw new VaultError(404, "No such secret");
				return reply(res, 200, { deleted: true });
			}
			throw new VaultError(405, "Method not allowed");
		} catch (error) {
			if (error instanceof VaultError) return reply(res, error.status, { error: error.message });
			console.error("vault:", error);
			reply(res, 500, { error: "Internal error" });
		}
	});
}

function reply(res, status, body) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

async function readJson(req) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_VALUE_BYTES * 2) throw new VaultError(413, "Request too large");
		chunks.push(chunk);
	}
	try {
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
		if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
		return body;
	} catch {
		throw new VaultError(400, "Body must be a JSON object");
	}
}
