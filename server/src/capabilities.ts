import express, { type Router } from "express";
import { requireAuth } from "./auth.js";
import { platform } from "./ports/index.js";

/** What this deployment offers, so the web app shows only the features that work here. */
export function capabilityRoutes(): Router {
	const router = express.Router();
	router.get("/capabilities", requireAuth, (_req, res) => {
		res.json({ models: platform().models.info(), vault: platform().secrets.configured() });
	});
	return router;
}
