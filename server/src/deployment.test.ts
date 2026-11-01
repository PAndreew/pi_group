import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Request, Response } from "express";
import { activeMutations, deploymentGate, draining } from "./deployment.js";

test("deployment drain rejects new writes but keeps reads, active tools and human answers usable", () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "beezy-drain-"));
	const before = process.env.BEEZY_DRAIN_FILE;
	process.env.BEEZY_DRAIN_FILE = path.join(dir, "drain");
	const request = (method: string, url: string) => {
		const res = Object.assign(new EventEmitter(), { code: 200, headers: {} as Record<string, string>, body: undefined as unknown,
			setHeader(key: string, value: string) { this.headers[key] = value; },
			status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; },
		});
		let passed = false;
		deploymentGate({ method, path: url } as Request, res as unknown as Response, () => { passed = true; });
		return { res, passed };
	};
	try {
		assert.equal(draining(), false);
		const inflight = request("POST", "/api/sessions/a/prompt");
		assert.equal(inflight.passed, true);
		assert.equal(activeMutations(), 1);
		writeFileSync(process.env.BEEZY_DRAIN_FILE!, "");
		assert.equal(draining(), true);
		for (const url of ["/api/sessions/a/prompt", "/api/chats", "/api/jobs/a/run", "/api/memory/consolidate"]) {
			const r = request("POST", url);
			assert.equal(r.passed, false, url);
			assert.equal(r.res.code, 503);
			assert.equal(r.res.headers["Retry-After"], "10");
		}
		for (const url of ["/api/job-bridge/a", "/api/interaction-bridge/a", "/api/sessions/a/dialog", "/api/sessions/a/abort", "/api/sessions/a/interactions/b"]) {
			const r = request("POST", url);
			assert.equal(r.passed, true, url);
			r.res.emit("finish"); r.res.emit("close");
		}
		assert.equal(request("GET", "/api/sessions/a/events").passed, true);
		assert.equal(activeMutations(), 1);
		inflight.res.emit("close"); inflight.res.emit("finish");
		assert.equal(activeMutations(), 0);
	} finally {
		if (before === undefined) delete process.env.BEEZY_DRAIN_FILE; else process.env.BEEZY_DRAIN_FILE = before;
		rmSync(dir, { recursive: true, force: true });
	}
});
