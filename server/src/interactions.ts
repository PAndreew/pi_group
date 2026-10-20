import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./files.js";
import { saveNow, store } from "./store.js";
import { pushToUser } from "./push.js";
import { isTenantMember } from "./tenants.js";

const option = z.object({ id: z.string().min(1).max(100), label: z.string().min(1).max(300), description: z.string().max(1000).optional() }).strict();
export const interactionSpec = z.object({
  version: z.literal(1),
  type: z.enum(["single_choice", "multi_choice"]),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  options: z.array(option).min(1).max(30),
  submitLabel: z.string().min(1).max(60).optional(),
}).strict().refine((s) => new Set(s.options.map((o) => o.id)).size === s.options.length, "Option IDs must be unique");

export interface Interaction {
  id: string;
  sessionKey: string;
  toolCallId: string;
  spec: z.infer<typeof interactionSpec>;
  status: "pending" | "answered" | "cancelled" | "expired";
  createdAt: string;
  resolvedAt?: string;
  selected?: string[];
  respondent?: { id: string; username: string };
}

// Credentials live only for this server lifetime, are scoped to one session, and never reach browsers.
const secret = randomBytes(32);
const tokenFor = (key: string) => createHmac("sha256", secret).update(key).digest("hex");
export function interactionEnvironment(key: string) {
  const base = `http://${config.host === "::1" ? "[::1]" : "127.0.0.1"}:${config.port}/api`;
  return {
    BEEZY_INTERACTION_URL: `${base}/interaction-bridge/${encodeURIComponent(key)}`,
    BEEZY_JOBS_URL: `${base}/job-bridge/${encodeURIComponent(key)}`,
    BEEZY_INTERACTION_TOKEN: tokenFor(key),
  };
}

/** Whether an Authorization header carries the bridge credential of session `key`. */
export function bridgeCredentialValid(key: string, authorization?: string) {
  const supplied = Buffer.from(authorization?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(tokenFor(key));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function expireInteractions(key?: string) {
  let changed = false;
  for (const card of store.data.interactions) {
    if (card.status === "pending" && (!key || card.sessionKey === key)) {
      card.status = "expired";
      card.resolvedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveNow();
}

export function mountInteractions(router: Router, load: (req: Request) => { access: string }) {
  const list = (key: string) => store.data.interactions.filter((c) => c.sessionKey === key);
  const find = (req: Request) => {
    const card = list(String(req.params.key)).find((c) => c.id === req.params.id);
    if (!card) throw new HttpError(404, "Interaction not found");
    return card;
  };
  router.use("/interaction-bridge/:key", (req, _res, next) => {
    if (!bridgeCredentialValid(String(req.params.key), req.headers.authorization)) return next(new HttpError(403, "Invalid interaction credential"));
    const meta = store.session(String(req.params.key));
    if (!meta || meta.deleted) return next(new HttpError(404, "Session not found"));
    next();
  });
  router.post("/interaction-bridge/:key", (req, res) => {
    const { toolCallId, spec } = z.object({ toolCallId: z.string().min(1).max(300), spec: interactionSpec }).strict().parse(req.body);
    const existing = list(String(req.params.key)).find((c) => c.toolCallId === toolCallId);
    if (existing) return void res.json(existing);
    const card: Interaction = { id: randomUUID(), sessionKey: String(req.params.key), toolCallId, spec, status: "pending", createdAt: new Date().toISOString() };
    store.data.interactions.push(card);
    saveNow();
    const meta = store.session(card.sessionKey)!;
    const recipients = new Set([meta.ownerId, ...meta.shares.filter((s) => s.access === "write").map((s) => s.userId)]);
    for (const userId of recipients) if (userId && isTenantMember(userId, meta.tenantId ?? "work")) void pushToUser(userId, { type: "interaction", tenantId: meta.tenantId ?? "work", key: card.sessionKey, id: card.id, title: spec.title }).catch((error) => console.error("Interaction push failed:", error.message));
    res.json(card);
  });
  router.get("/interaction-bridge/:key/:id", (req, res) => { res.json(find(req)); });
  router.delete("/interaction-bridge/:key/:id", (req, res) => {
    const card = find(req);
    if (card.status === "pending") { card.status = "expired"; card.resolvedAt = new Date().toISOString(); saveNow(); }
    res.json(card);
  });
  router.get("/sessions/:key/interactions", requireAuth, (req, res) => {
    load(req);
    res.setHeader("Cache-Control", "no-store");
    res.json({ interactions: list(String(req.params.key)) });
  });
  router.post("/sessions/:key/interactions/:id", requireAuth, (req, res) => {
    if (!["owner", "admin", "write"].includes(load(req).access)) throw new HttpError(403, "Prompt access required");
    const card = find(req);
    const answer = z.object({ selected: z.array(z.string()).max(30).default([]), cancelled: z.boolean().default(false) }).strict().parse(req.body);
    if (card.status !== "pending") {
      // Network retries from the winner are safe; competing answers cannot overwrite it.
      if (card.respondent?.id === req.user!.id && card.status === (answer.cancelled ? "cancelled" : "answered") && JSON.stringify(card.selected) === JSON.stringify(answer.cancelled ? [] : answer.selected)) return void res.json(card);
      throw new HttpError(409, "This interaction has already been resolved");
    }
    if (!answer.cancelled && (answer.selected.length === 0 || new Set(answer.selected).size !== answer.selected.length || answer.selected.some((id) => !card.spec.options.some((o) => o.id === id)) || (card.spec.type === "single_choice" && answer.selected.length !== 1))) throw new HttpError(400, "Choose valid options");
    card.selected = answer.cancelled ? [] : answer.selected;
    card.status = answer.cancelled ? "cancelled" : "answered";
    card.respondent = { id: req.user!.id, username: req.user!.username };
    card.resolvedAt = new Date().toISOString();
    saveNow();
    res.json(card);
  });
}
