import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVaultServer } from "./server.mjs";
import { loadMasterKey, SecretStore } from "./store.mjs";

/** KEY=VALUE pairs from .env files, without overriding real environment variables (same rules as Beezy's server). */
function loadDotEnv(file) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
		if (!match || line.trim().startsWith("#")) continue;
		const [, key, raw] = match;
		if (process.env[key] === undefined) process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
	}
}

loadDotEnv(path.resolve(process.cwd(), ".env"));
loadDotEnv(path.resolve(process.cwd(), "..", ".env"));

const expandHome = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
const dataDir = path.resolve(expandHome(process.env.VAULT_DATA_DIR ?? "~/.beezy-vault"));
const host = process.env.VAULT_HOST ?? "127.0.0.1";
const port = Number(process.env.VAULT_PORT ?? 8790);

const store = new SecretStore(path.join(dataDir, "secrets.sqlite"), loadMasterKey(dataDir, process.env.VAULT_MASTER_KEY));
let server;
try {
	server = createVaultServer({ store, token: process.env.VAULT_TOKEN });
} catch (error) {
	console.error(`vault: ${error.message}. Generate one with: openssl rand -hex 32`);
	process.exit(1);
}
server.listen(port, host, () => {
	console.log(`beezy vault listening on http://${host}:${port}`);
	console.log(`  data dir: ${dataDir}`);
});

const shutdown = () => {
	server.close();
	store.close();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
