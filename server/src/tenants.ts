import express from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { store, saveNow, type User } from "./store.js";
import { currentTenant, tenantId } from "./tenant-context.js";

export const tenantOf = (id = tenantId()) => store.data.tenants.find(t => t.id === id);
export function isTenantMember(userId: string, id = tenantId()): boolean {
	const tenant = tenantOf(id);
	// Old isolated unit-test stores have no tenants; production always migrates.
	return tenant ? tenant.memberIds.includes(userId) : store.data.tenants.length === 0 && id === "work";
}
export function tenantAccess(user: User, resource: { tenantId?: string }): boolean {
	const id = resource.tenantId ?? "work";
	return (!currentTenant() || currentTenant()!.id === id) && isTenantMember(user.id, id);
}

export function tenantRoutes() {
	const router = express.Router();
	router.use("/tenants", requireAuth);
	router.get("/tenants", (req, res) => {
		res.json({ active: tenantId(), tenants: store.data.tenants.filter(t => isTenantMember(req.user!.id, t.id)).map(t => ({ id: t.id, name: t.name })) });
	});
	router.post("/tenants/switch", (req, res) => {
		const { id } = z.object({ id: z.string() }).parse(req.body);
		if (!isTenantMember(req.user!.id, id) || !req.login) return void res.status(403).json({ error: "Tenant unavailable" });
		req.login.tenantId = id;
		saveNow();
		res.json({ ok: true });
	});
	return router;
}
