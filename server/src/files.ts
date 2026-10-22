import { existsSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";

/** Relative, slash-separated path under FS_ROOT for display and APIs. */
export const toRel = (abs: string) => path.relative(config.fsRoot, abs).split(path.sep).join("/");

/**
 * Resolve a client path against FS_ROOT and refuse anything that escapes it,
 * including escapes through symlinks of existing path prefixes.
 */
export function resolveSafe(rel: unknown): string {
	const input = typeof rel === "string" ? rel : "";
	const abs = path.resolve(config.fsRoot, input.replace(/^[/\\]+/, ""));
	const inside = (p: string) => p === config.fsRoot || p.startsWith(config.fsRoot + path.sep);
	if (!inside(abs)) throw new HttpError(403, "Path is outside the shared root");
	let probe = abs;
	while (!existsSync(probe) && probe !== config.fsRoot) probe = path.dirname(probe);
	const real = realpathSync(probe);
	const realRoot = realpathSync(config.fsRoot);
	if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new HttpError(403, "Path is outside the shared root");
	return abs;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

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

export function fileRoutes(): Router {
	const router = express.Router();
	router.use("/fs", requireAuth);

	router.get("/fs/info", (_req, res) => {
		res.json({ root: config.fsRoot, rootName: path.basename(config.fsRoot) || config.fsRoot });
	});

	router.get("/fs/list", async (req, res) => {
		const dir = resolveSafe(req.query.path);
		const dirents = await fs.readdir(dir, { withFileTypes: true });
		const entries = await Promise.all(
			dirents.map(async (d) => {
				const full = path.join(dir, d.name);
				try {
					const stat = await fs.stat(full);
					return {
						name: d.name,
						path: toRel(full),
						type: stat.isDirectory() ? ("dir" as const) : ("file" as const),
						symlink: d.isSymbolicLink(),
						size: stat.size,
						mtime: stat.mtimeMs,
					};
				} catch {
					return { name: d.name, path: toRel(full), type: "file" as const, symlink: d.isSymbolicLink(), size: 0, mtime: 0, broken: true };
				}
			}),
		);
		entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1));
		res.json({ path: toRel(dir), entries });
	});

	router.get("/fs/stat", async (req, res) => {
		const file = resolveSafe(req.query.path);
		const stat = await fs.stat(file);
		res.json({ path: toRel(file), size: stat.size, mtime: stat.mtimeMs, type: stat.isDirectory() ? "dir" : "file", mime: mimeFor(file) });
	});

	/** Inline content for the in-app viewers. Served sandboxed so user HTML/SVG can never run with the app's origin. */
	router.get("/fs/raw", async (req, res) => {
		const file = resolveSafe(req.query.path);
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
		const file = resolveSafe(req.query.path);
		const stat = await fs.stat(file);
		if (!stat.isFile()) throw new HttpError(400, "Not a file");
		res.download(file, path.basename(file), { dotfiles: "allow" });
	});

	/** Save a text file from the in-app editor; `mtime` from the load refuses to overwrite someone else's newer save. */
	router.put("/fs/text", async (req, res) => {
		const body = z.object({ path: z.string().min(1), content: z.string().max(MAX_EDIT_BYTES), mtime: z.number().optional() }).parse(req.body);
		const requested = resolveSafe(body.path);
		const stat = await fs.stat(requested).catch(() => undefined);
		// Write through symlinks instead of replacing them; resolveSafe already checked their target.
		const file = stat ? realpathSync(requested) : requested;
		if (stat && !stat.isFile()) throw new HttpError(400, "Not a file");
		if (stat && body.mtime !== undefined && Math.abs(stat.mtimeMs - body.mtime) > 1) throw new HttpError(409, "The file changed on disk since you opened it; reload to see the new version");
		// Same directory, then rename: readers (and the agent) never see a half-written file.
		const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
		await fs.writeFile(temp, body.content, { mode: stat?.mode });
		await fs.rename(temp, file).catch(async (error) => {
			await fs.rm(temp, { force: true });
			throw error;
		});
		const saved = await fs.stat(file);
		res.json({ path: toRel(requested), size: saved.size, mtime: saved.mtimeMs });
	});

	router.post("/fs/mkdir", async (req, res) => {
		const body = z.object({ path: z.string().min(1) }).parse(req.body);
		const dir = resolveSafe(body.path);
		await fs.mkdir(dir, { recursive: true });
		res.json({ path: toRel(dir) });
	});

	const upload = multer({
		limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
		storage: multer.diskStorage({
			destination: (req, _file, cb) => {
				try {
					const dir = resolveSafe(req.query.path);
					fs.mkdir(dir, { recursive: true }).then(() => cb(null, dir), (error) => cb(error, dir));
				} catch (error) {
					cb(error as Error, "");
				}
			},
			filename: (req, file, cb) => {
				const dir = resolveSafe(req.query.path);
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
