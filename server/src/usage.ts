import express, { type Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { toRel } from "./files.js";
import type { HarnessAdapter, UsageRecord } from "./harness/types.js";
import { accessOf } from "./sessions.js";
import { store } from "./store.js";

/** Token totals of a group of model calls. `input` is the uncached part; cache hits are `cacheRead`. */
export interface UsageTotals {
	calls: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	cost: number;
}

const empty = (): UsageTotals => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 });

function add(totals: UsageTotals, r: UsageRecord) {
	totals.calls++;
	totals.input += r.input;
	totals.output += r.output;
	totals.cacheRead += r.cacheRead;
	totals.cacheWrite += r.cacheWrite;
	totals.reasoning += r.reasoning ?? 0;
	totals.cost += r.cost;
}

/** The viewer's calendar day of a timestamp; `offsetMin` is their Date#getTimezoneOffset(). */
export const dayOf = (timestamp: number, offsetMin: number) => new Date(timestamp - offsetMin * 60_000).toISOString().slice(0, 10);

/** Sum usage records into totals per day (every day of the window, empty ones too), per model and per session. */
export function summarize(sessions: { key: string; name: string; path: string; records: UsageRecord[] }[], since: number, until: number, offsetMin: number) {
	const totals = empty();
	const days = new Map<string, UsageTotals>();
	for (let t = since; dayOf(t, offsetMin) <= dayOf(until, offsetMin); t += 86_400_000) days.set(dayOf(t, offsetMin), empty());
	const models = new Map<string, UsageTotals & { provider?: string; model?: string }>();
	const perSession: (UsageTotals & { key: string; name: string; path: string; lastAt: number })[] = [];
	for (const session of sessions) {
		const own = { ...empty(), key: session.key, name: session.name, path: session.path, lastAt: 0 };
		for (const r of session.records) {
			if (r.timestamp < since || r.timestamp > until) continue;
			add(totals, r);
			add(own, r);
			own.lastAt = Math.max(own.lastAt, r.timestamp);
			const day = dayOf(r.timestamp, offsetMin);
			if (!days.has(day)) days.set(day, empty());
			add(days.get(day)!, r);
			const id = `${r.provider ?? "unknown"}/${r.model ?? "unknown"}`;
			if (!models.has(id)) models.set(id, { ...empty(), provider: r.provider, model: r.model });
			add(models.get(id)!, r);
		}
		if (own.calls) perSession.push(own);
	}
	const volume = (t: UsageTotals) => t.input + t.cacheRead + t.cacheWrite + t.output;
	return {
		totals,
		days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, t]) => ({ date, ...t })),
		models: [...models.values()].sort((a, b) => volume(b) - volume(a)),
		sessions: perSession.sort((a, b) => volume(b) - volume(a)),
	};
}

export function usageRoutes(adapters: HarnessAdapter[]): Router {
	const router = express.Router();
	router.use("/usage", requireAuth);

	/**
	 * Token use of the sessions the caller can see (or only their own) over the last `days` days.
	 * Harnesses without per-call records (pi durable) are listed so the UI can say they are missing.
	 */
	router.get("/usage", async (req, res) => {
		const user = req.user!;
		const query = z
			.object({
				days: z.coerce.number().int().min(1).max(366).catch(30),
				scope: z.enum(["visible", "mine"]).catch("visible"),
				tzOffset: z.coerce.number().int().min(-900).max(900).catch(0),
			})
			.parse(req.query);
		const until = Date.now();
		const midnight = new Date(`${dayOf(until, query.tzOffset)}T00:00:00Z`).getTime() + query.tzOffset * 60_000;
		const since = midnight - (query.days - 1) * 86_400_000;
		const byId = new Map(adapters.map((a) => [a.id, a]));
		const untracked = new Set<string>();
		const metas = Object.values(store.data.sessions).filter((m) => !m.deleted && accessOf(user, m) && (query.scope === "visible" || m.ownerId === user.id));
		const sessions = await Promise.all(
			metas.map(async (meta) => {
				const adapter = byId.get(meta.harness);
				if (!adapter?.usageRecords) {
					untracked.add(meta.harness);
					return undefined;
				}
				const records = await adapter.usageRecords(meta.id, meta.cwd).catch(() => []);
				return { key: meta.key, name: meta.name || meta.firstMessage || "Untitled session", path: toRel(meta.cwd), records };
			}),
		);
		res.setHeader("Cache-Control", "no-store");
		res.json({
			since: new Date(since).toISOString(),
			until: new Date(until).toISOString(),
			...summarize(sessions.filter((s) => s !== undefined), since, until, query.tzOffset),
			untracked: [...untracked],
		});
	});

	return router;
}
