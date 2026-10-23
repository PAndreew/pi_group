import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
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
