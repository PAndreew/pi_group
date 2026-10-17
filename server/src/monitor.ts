import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statfsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import express, { type Router } from "express";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { toRel } from "./files.js";
import type { HarnessAdapter } from "./harness/types.js";
import { accessOf } from "./sessions.js";
import { store } from "./store.js";

interface Proc {
	ppid: number;
	rssBytes: number;
	/** CPU time used so far, in seconds. */
	cpuSeconds: number;
}

/** Memory page size: 4 KiB on most systems, 16 KiB on e.g. the Raspberry Pi 5 kernel. */
const pageSize = (() => {
	if (!existsSync("/proc/self/stat")) return 4096;
	try {
		return Number(execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim()) || 4096;
	} catch {
		return 4096;
	}
})();

/** Linux and Termux: every process from /proc (Android only shows our own, which is all we need). */
function procTable(): Map<number, Proc> {
	const table = new Map<number, Proc>();
	const ticks = 100; // USER_HZ is 100 on every Linux/Android kernel in practice.
	for (const name of readdirSync("/proc")) {
		if (!/^\d+$/.test(name)) continue;
		try {
			const stat = readFileSync(`/proc/${name}/stat`, "utf8");
			// The command name may contain spaces and parentheses; fields resume after the last ")".
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			table.set(Number(name), { ppid: Number(fields[1]), cpuSeconds: (Number(fields[11]) + Number(fields[12])) / ticks, rssBytes: Number(fields[21]) * pageSize });
		} catch {
			// The process exited while we looked.
		}
	}
	return table;
}

/** macOS (and other Unixes with ps): rss in KiB, cumulative cpu time as [[dd-]hh:]mm:ss. */
function psTable(): Promise<Map<number, Proc>> {
	return new Promise((resolve) => {
		execFile("ps", ["-A", "-o", "pid=,ppid=,rss=,time="], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			const table = new Map<number, Proc>();
			if (error) return resolve(table);
			for (const line of stdout.trim().split("\n")) {
				const [pid, ppid, rss, time] = line.trim().split(/\s+/);
				const [days, rest] = time.includes("-") ? time.split("-") : ["0", time];
				const seconds = rest.split(":").reverse().reduce((sum, part, i) => sum + parseFloat(part) * 60 ** i, 0) + Number(days) * 86400;
				table.set(Number(pid), { ppid: Number(ppid), rssBytes: Number(rss) * 1024, cpuSeconds: seconds });
			}
			resolve(table);
		});
	});
}

async function processTable(): Promise<Map<number, Proc> | undefined> {
	if (existsSync("/proc/self/stat")) return procTable();
	if (process.platform !== "win32") return psTable();
	return undefined;
}

/** A process and all its descendants (pi plus the shells and tools it started). */
function treeOf(table: Map<number, Proc>, root: number) {
	const children = new Map<number, number[]>();
	for (const [pid, p] of table) children.set(p.ppid, [...(children.get(p.ppid) ?? []), pid]);
	const pids: number[] = [];
	for (let queue = [root]; queue.length; ) {
		const pid = queue.pop()!;
		if (!table.has(pid) || pids.includes(pid)) continue;
		pids.push(pid);
		queue.push(...(children.get(pid) ?? []));
	}
	return { pids, rssBytes: pids.reduce((sum, pid) => sum + table.get(pid)!.rssBytes, 0), cpuSeconds: pids.reduce((sum, pid) => sum + table.get(pid)!.cpuSeconds, 0) };
}

/** Available memory as the kernel reports it (MemAvailable), which os.freemem() underestimates on Linux. */
function availableMemory() {
	try {
		const kib = /^MemAvailable:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1];
		if (kib) return Number(kib) * 1024;
	} catch {
		// Not Linux.
	}
	return os.freemem();
}

function diskFree(dir: string) {
	try {
		const s = statfsSync(dir);
		return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
	} catch {
		return undefined;
	}
}

async function dirBytes(dir: string, depth = 2): Promise<{ bytes: number; files: number }> {
	let bytes = 0;
	let files = 0;
	for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory() && depth > 0) {
			const sub = await dirBytes(full, depth - 1);
			bytes += sub.bytes;
			files += sub.files;
		} else if (entry.isFile()) {
			bytes += (await fs.stat(full).catch(() => undefined))?.size ?? 0;
			files++;
		}
	}
	return { bytes, files };
}

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/** CPU time per root pid at the previous sample, so CPU% covers the time since the last refresh. */
const lastCpu = new Map<number, { at: number; cpuSeconds: number }>();
let lastServerCpu = { at: Date.now(), usage: process.cpuUsage() };

function cpuPercent(pid: number, cpuSeconds: number) {
	const now = Date.now();
	const previous = lastCpu.get(pid);
	lastCpu.set(pid, { at: now, cpuSeconds });
	if (!previous || now - previous.at < 250) return undefined;
	return (100 * (cpuSeconds - previous.cpuSeconds)) / ((now - previous.at) / 1000);
}

export function monitorRoutes(adapters: HarnessAdapter[]): Router {
	const router = express.Router();
	router.use("/monitor", requireAuth);

	router.get("/monitor", async (req, res) => {
		const user = req.user!;
		const table = await processTable();
		const live = adapters.flatMap((adapter) => adapter.liveSessions().map((session) => ({ adapter, session, meta: store.session(`${adapter.id}:${session.id}`) })));
		const sessions = await Promise.all(
			live
				.filter(({ meta }) => meta && !meta.deleted && accessOf(user, meta))
				.map(async ({ adapter, session, meta }) => {
					const usage = await adapter.usage(session.id, session.cwd).catch(() => ({}) as Awaited<ReturnType<HarnessAdapter["usage"]>>);
					const tree = usage.pid && table ? treeOf(table, usage.pid) : undefined;
					return {
						key: meta!.key,
						name: session.state.name || meta!.name || meta!.firstMessage || "Untitled session",
						harness: adapter.id,
						path: toRel(session.cwd),
						running: session.state.running,
						viewers: session.viewers,
						lastActivity: new Date(session.lastActivity).toISOString(),
						messages: session.state.messages.length,
						model: session.state.model?.id,
						pinned: Boolean(meta!.pinned),
						pid: usage.pid,
						processes: tree?.pids.length,
						rssBytes: tree?.rssBytes,
						cpuPercent: tree && usage.pid ? cpuPercent(usage.pid, tree.cpuSeconds) : undefined,
						storageBytes: usage.storageBytes,
						sharedStorage: usage.sharedStorage,
						tokens: usage.tokens,
						cost: usage.cost,
					};
				}),
		);
		for (const pid of lastCpu.keys()) if (!sessions.some((s) => s.pid === pid)) lastCpu.delete(pid);

		const now = Date.now();
		const usage = process.cpuUsage(lastServerCpu.usage);
		const serverCpu = (100 * (usage.user + usage.system)) / 1000 / Math.max(now - lastServerCpu.at, 1);
		lastServerCpu = { at: now, usage: process.cpuUsage() };
		const [piStorage, durableStorage] = await Promise.all([dirBytes(config.piSessionsDir), dirBytes(path.join(config.dataDir, "durable"), 0)]);

		res.json({
			at: new Date(now).toISOString(),
			system: {
				hostname: os.hostname(),
				platform: `${os.type()} ${os.release()} (${os.arch()})`,
				uptimeSec: os.uptime(),
				cpus: os.cpus().length,
				loadAvg: process.platform === "win32" ? undefined : os.loadavg(),
				memTotal: os.totalmem(),
				memAvailable: availableMemory(),
				disk: diskFree(config.dataDir),
				processInfo: Boolean(table),
			},
			server: {
				pid: process.pid,
				uptimeSec: process.uptime(),
				rssBytes: process.memoryUsage.rss(),
				heapUsedBytes: process.memoryUsage().heapUsed,
				cpuPercent: serverCpu,
				eventLoopLagMs: loopDelay.percentile(99) / 1e6,
				node: process.version,
			},
			storage: { piSessions: piStorage, durable: durableStorage },
			sessions: sessions.sort((a, b) => Number(b.running) - Number(a.running) || (b.rssBytes ?? 0) - (a.rssBytes ?? 0)),
		});
		loopDelay.reset();
	});

	return router;
}
