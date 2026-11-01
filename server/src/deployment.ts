import { existsSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";

// A controller outside the app owns this marker. Never expose a remote drain command.
export const draining = () => Boolean(process.env.BEEZY_DRAIN_FILE && existsSync(process.env.BEEZY_DRAIN_FILE));
let mutations = 0;
export const activeMutations = () => mutations;
export function deploymentGate(req: Request, res: Response, next: NextFunction) {
	if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
	// Existing runs must still be able to finish tools and receive human answers/aborts.
	const continuation = /^\/api\/(?:[^/]*bridge(?:\/|$)|sessions\/[^/]+\/(?:dialog|abort|interactions\/[^/]+)$|interactions(?:\/|$))/.test(req.path);
	if (draining() && !continuation) {
		res.setHeader("Retry-After", "10");
		res.status(503).json({ error: "Beezy is preparing an update; existing agents are finishing. Please retry shortly." });
		return;
	}
	mutations++;
	let finished = false;
	const done = () => { if (!finished) { finished = true; mutations--; } };
	res.once("finish", done);
	res.once("close", done);
	next();
}
