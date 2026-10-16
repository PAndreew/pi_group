import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import express, { type Router } from "express";
import webpush from "web-push";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { save, store, type PushSubscriptionRecord } from "./store.js";

/** VAPID keys identify this server to the browsers' push services; made once and kept in the data dir. */
function vapidKeys(): { publicKey: string; privateKey: string } {
	if (config.vapidPublicKey && config.vapidPrivateKey) return { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
	const file = path.join(config.dataDir, "vapid.json");
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		const keys = webpush.generateVAPIDKeys();
		writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
		return keys;
	}
}

let keys: ReturnType<typeof vapidKeys> | undefined;
function vapid() {
	keys ??= vapidKeys();
	return keys;
}

/** Deliver a payload to every device of a user; subscriptions the push service rejects are dropped. */
export async function pushToUser(userId: string, payload: unknown) {
	const subscriptions = store.data.pushSubscriptions.filter((s) => s.userId === userId);
	if (!subscriptions.length) return;
	const { publicKey, privateKey } = vapid();
	const body = JSON.stringify(payload);
	await Promise.all(
		subscriptions.map(async (s) => {
			try {
				await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
					vapidDetails: { subject: config.vapidSubject, publicKey, privateKey },
					TTL: 60 * 60,
					urgency: "high",
				});
			} catch (error) {
				const status = (error as { statusCode?: number }).statusCode;
				if (status === 404 || status === 410) removeSubscription(s.endpoint);
				else console.error(`push to ${new URL(s.endpoint).host} failed:`, status ?? (error as Error).message);
			}
		}),
	);
}

function removeSubscription(endpoint: string) {
	const before = store.data.pushSubscriptions.length;
	store.data.pushSubscriptions = store.data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
	if (store.data.pushSubscriptions.length !== before) save();
}

const subscriptionSchema = z.object({
	// Push services are always https; anything else would let a client make the server call internal URLs.
	endpoint: z.url({ protocol: /^https$/ }).max(2000),
	keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export function pushRoutes(): Router {
	const router = express.Router();
	router.use("/push", requireAuth);

	router.get("/push/key", (_req, res) => {
		res.json({ publicKey: vapid().publicKey });
	});

	/** One record per device (endpoint); re-subscribing moves the device to the caller. */
	router.post("/push/subscribe", (req, res) => {
		const { endpoint, keys } = subscriptionSchema.parse(req.body);
		const record: PushSubscriptionRecord = { userId: req.user!.id, endpoint, keys, createdAt: new Date().toISOString() };
		store.data.pushSubscriptions = [...store.data.pushSubscriptions.filter((s) => s.endpoint !== endpoint), record];
		save();
		res.json({ ok: true });
	});

	router.post("/push/unsubscribe", (req, res) => {
		const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
		const before = store.data.pushSubscriptions.length;
		store.data.pushSubscriptions = store.data.pushSubscriptions.filter((s) => s.endpoint !== endpoint || s.userId !== req.user!.id);
		if (store.data.pushSubscriptions.length !== before) save();
		res.json({ ok: true });
	});

	return router;
}
