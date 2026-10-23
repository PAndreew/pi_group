import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { platform } from "./ports/index.js";

import { HttpError, resolveSafe, toRel } from "./paths.js";

// Other modules import these from here.
export { HttpError, resolveSafe, toRel };

const MIME: Record<string, string> = {
	".html": "text/html",
	".htm": "text/html",
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".bmp": "image/bmp",
	".avif": "image/avif",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".flac": "audio/flac",
	".json": "application/json",
	".zip": "application/zip",
};

export const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "text/plain";

/** Avoid clobbering: "a.txt" becomes "a (1).txt" when taken. */
async function uniqueName(dir: string, name: string) {
	const ext = path.extname(name);
	const base = name.slice(0, name.length - ext.length);
	let candidate = name;
	for (let i = 1; existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
	return candidate;
}

/** Matches the viewer's text limit: larger files are not loaded into the editor. */
const MAX_EDIT_BYTES = 3 * 1024 * 1024;

const sanitize = (name: string) => path.basename(name).replace(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 200) || "upload";

const queryPath = (value: unknown) => (typeof value === "string" ? value : "");

/** Streaming and uploads work on local files; storage without them (object storage) needs its own routes. */
function localFile(value: unknown) {
	const storage = platform().storage;
	if (!storage.localPath) throw new HttpError(501, "This storage cannot serve files directly");
	return storage.localPath(queryPath(value));
}

export function fileRoutes(): Router {
	const router = express.Router();
	router.use("/fs", requireAuth);

	router.get("/fs/info", (_req, res) => {
		res.json({ root: config.fsRoot, rootName: path.basename(config.fsRoot) || config.fsRoot });
	});

	router.get("/fs/list", async (req, res) => {
		res.json(await platform().storage.list(queryPath(req.query.path)));
	});

	router.get("/fs/stat", async (req, res) => {
		const stat = await platform().storage.stat(queryPath(req.query.path));
		res.json({ ...stat, mime: mimeFor(stat.path) });
	});

	/** Inline content for the in-app viewers. Served sandboxed so user HTML/SVG can never run with the app's origin. */
	router.get("/fs/raw", async (req, res) => {
		const file = localFile(req.query.path);
		const stat = await fs.stat(file);
		if (!stat.isFile()) throw new HttpError(400, "Not a file");
		const mime = mimeFor(file);
		res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Cache-Control", "private, no-cache");
		res.sendFile(file, {
			headers: { "Content-Type": mime.startsWith("text/") || mime === "application/json" ? `${mime}; charset=utf-8` : mime },
			dotfiles: "allow",
		});
	});

	router.get("/fs/download", async (req, res) => {
		const file = localFile(req.query.path);
		const stat = await fs.stat(file);
		if (!stat.isFile()) throw new HttpError(400, "Not a file");
		res.download(file, path.basename(file), { dotfiles: "allow" });
	});

	/** Save a text file from the in-app editor; `mtime` from the load refuses to overwrite someone else's newer save. */
	router.put("/fs/text", async (req, res) => {
		const body = z.object({ path: z.string().min(1), content: z.string().max(MAX_EDIT_BYTES), mtime: z.number().optional() }).parse(req.body);
		res.json(await platform().storage.writeText(body.path, body.content, body.mtime));
	});

	router.post("/fs/mkdir", async (req, res) => {
		const body = z.object({ path: z.string().min(1) }).parse(req.body);
		res.json({ path: await platform().storage.mkdir(body.path) });
	});

	const upload = multer({
		limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
		storage: multer.diskStorage({
			destination: (req, _file, cb) => {
				try {
					const dir = localFile(req.query.path);
					fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir), (error) => cb(error, dir));
				} catch (error) {
					cb(error as Error, "");
				}
			},
			filename: (req, file, cb) => {
				const dir = localFile(req.query.path);
				// Browsers send multipart filenames as latin1; recover UTF-8 names.
				const name = sanitize(Buffer.from(file.originalname, "latin1").toString("utf8"));
				uniqueName(dir, name).then((n) => cb(null, n), (error) => cb(error, name));
			},
		}),
	});

	router.post("/fs/upload", upload.array("files"), (req, res) => {
		const files = (req.files as Express.Multer.File[]) ?? [];
		res.json({ files: files.map((f) => ({ name: f.filename, path: toRel(f.path), size: f.size, mime: f.mimetype })) });
	});

	return router;
}
