import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { authenticate, authRoutes, ensureAdmin } from "./auth.js";
import { attachBrowser, browserRoutes, closeBrowsers } from "./browser.js";
import { capabilityRoutes } from "./capabilities.js";
import { closeChats } from "./chats.js";
import { config } from "./config.js";
import { fileRoutes, HttpError } from "./files.js";
import { PiDurableAdapter } from "./harness/pi-durable.js";
import { PiRpcAdapter } from "./harness/pi-rpc.js";
import type { HarnessAdapter } from "./harness/types.js";
import { monitorRoutes } from "./monitor.js";
import { pushRoutes } from "./push.js";
import { expireInteractions } from "./interactions.js";
import { sessionRoutes } from "./sessions.js";
import { attachTerminal } from "./terminal.js";
import { loadStore, saveNow } from "./store.js";
import { tenantRoutes } from "./tenants.js";
import { usageRoutes } from "./usage.js";
import { vaultRoutes } from "./vault.js";

loadStore();
expireInteractions();
ensureAdmin();

const adapters: HarnessAdapter[] = [new PiRpcAdapter(), new PiDurableAdapter()];

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use((_req, res, next) => {
	res.setHeader("X-Frame-Options", "SAMEORIGIN");
	res.setHeader("Referrer-Policy", "same-origin");
	next();
});
app.use(express.json({ limit: "60mb" }));
app.use(authenticate);

const api = express.Router();
api.use(authRoutes());
api.use(tenantRoutes());
api.use(capabilityRoutes());
api.use(fileRoutes());
api.use(pushRoutes());
api.use(vaultRoutes());
api.use(monitorRoutes(adapters));
api.use(usageRoutes(adapters));
api.use(browserRoutes());
api.use(sessionRoutes(adapters));
api.use((_req, res) => void res.status(404).json({ error: "Not found" }));
app.use("/api", api);

if (existsSync(config.webDist)) {
	app.use(express.static(config.webDist, {
		index: false,
		maxAge: "1h",
		setHeaders(res, file) {
			if (file.endsWith(".webmanifest") || path.basename(file) === "sw.js") {
				res.setHeader("Cache-Control", "no-cache");
			}
		},
	}));
	app.get(/^(?!\/api\/).*/, (_req, res) => {
		// HTML must always discover the latest hashed assets after a local deployment.
		res.setHeader("Cache-Control", "no-store");
		res.sendFile(path.join(config.webDist, "index.html"), { cacheControl: false });
	});
} else {
	app.get("/", (_req, res) => void res.type("text").send("pi_group API is running. Build the web app (npm run build) or use the Vite dev server."));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
	if (res.headersSent) return;
	if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
	if (error instanceof ZodError) return void res.status(400).json({ error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
	const code = (error as NodeJS.ErrnoException)?.code;
	if (code === "ENOENT") return void res.status(404).json({ error: "No such file or directory" });
	if (code === "EACCES" || code === "EPERM") return void res.status(403).json({ error: "Permission denied" });
	if (code === "LIMIT_FILE_SIZE") return void res.status(413).json({ error: `File larger than ${config.maxUploadMb} MB` });
	console.error(error);
	res.status(500).json({ error: (error as Error)?.message ?? "Internal error" });
});

const server = app.listen(config.port, config.host, () => {
	console.log(`pi_group listening on http://${config.host}:${config.port}`);
	console.log(`  files root: ${config.fsRoot}`);
	console.log(`  data dir:   ${config.dataDir}`);
	console.log(`  pi:         ${config.piBin} (sessions in ${config.piSessionsDir})`);
});
attachTerminal(server);
attachBrowser(server);
server.on("upgrade", (req, socket) => {
	const { pathname } = new URL(req.url ?? "/", "http://localhost");
	if (pathname !== "/api/terminal" && pathname !== "/api/browser") socket.destroy();
});

// Adapters load in the background so the UI is reachable at once (pi-ai's model catalog is large).
void Promise.all(adapters.map((a) => a.init().catch((error) => console.error(`${a.id} init failed:`, error))));

let stopping = false;
async function shutdown() {
	if (stopping) return;
	stopping = true;
	console.log("Shutting down…");
	server.close();
	await Promise.allSettled([...adapters.map((a) => a.shutdown()), closeBrowsers()]);
	saveNow();
	closeChats();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
