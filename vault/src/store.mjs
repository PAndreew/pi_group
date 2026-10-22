import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/*
 * Secrets are encrypted one by one with AES-256-GCM. The namespace and key are bound in as
 * associated data, so a ciphertext copied to another row (or another owner) fails to decrypt.
 * The master key never touches the database: it comes from VAULT_MASTER_KEY or a 0600 key file.
 */

export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const NAMESPACE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
export const MAX_VALUE_BYTES = 64 * 1024;
export const MAX_DESCRIPTION = 300;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS secrets (
	namespace TEXT NOT NULL, key TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
	iv BLOB NOT NULL, tag BLOB NOT NULL, ciphertext BLOB NOT NULL,
	created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
	PRIMARY KEY (namespace, key)
);
`;

/** 32 bytes from base64 or hex; anything else is a configuration error. */
export function parseMasterKey(text) {
	const value = text.trim();
	const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
	if (key.length !== 32) throw new Error("VAULT_MASTER_KEY must be 32 bytes, base64 or hex encoded");
	return key;
}

/** The configured master key, or one generated once into the data directory. */
export function loadMasterKey(dataDir, configured) {
	if (configured) return parseMasterKey(configured);
	const file = path.join(dataDir, "master.key");
	if (!existsSync(file)) {
		mkdirSync(dataDir, { recursive: true, mode: 0o700 });
		writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
		console.log(`vault: generated a master key in ${file}; back it up, secrets cannot be read without it`);
	}
	return parseMasterKey(readFileSync(file, "utf8"));
}

export class SecretStore {
	constructor(file, masterKey) {
		if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(file);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(SCHEMA);
		this.masterKey = masterKey;
	}

	close() {
		this.db.close();
	}

	list(namespace) {
		return this.db
			.prepare("SELECT key, description, created_at, updated_at FROM secrets WHERE namespace = ? ORDER BY key")
			.all(namespace)
			.map(toInfo);
	}

	get(namespace, key) {
		const row = this.db.prepare("SELECT * FROM secrets WHERE namespace = ? AND key = ?").get(namespace, key);
		if (!row) return undefined;
		const decipher = createDecipheriv("aes-256-gcm", this.masterKey, row.iv);
		decipher.setAAD(aad(namespace, key));
		decipher.setAuthTag(row.tag);
		const value = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
		return { ...toInfo(row), value };
	}

	/** Create or update; `value` may be omitted to change only the description of an existing secret. */
	put(namespace, key, { value, description }) {
		const existing = this.db.prepare("SELECT created_at FROM secrets WHERE namespace = ? AND key = ?").get(namespace, key);
		const now = new Date().toISOString();
		if (value === undefined) {
			if (!existing) throw new VaultError(400, "A new secret needs a value");
			this.db.prepare("UPDATE secrets SET description = ?, updated_at = ? WHERE namespace = ? AND key = ?").run(description ?? "", now, namespace, key);
			return toInfo(this.db.prepare("SELECT * FROM secrets WHERE namespace = ? AND key = ?").get(namespace, key));
		}
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
		cipher.setAAD(aad(namespace, key));
		const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
		this.db
			.prepare(
				`INSERT INTO secrets (namespace, key, description, iv, tag, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (namespace, key) DO UPDATE SET description = excluded.description, iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
			)
			.run(namespace, key, description ?? "", iv, cipher.getAuthTag(), ciphertext, existing?.created_at ?? now, now);
		return toInfo(this.db.prepare("SELECT * FROM secrets WHERE namespace = ? AND key = ?").get(namespace, key));
	}

	delete(namespace, key) {
		return this.db.prepare("DELETE FROM secrets WHERE namespace = ? AND key = ?").run(namespace, key).changes > 0;
	}
}

export class VaultError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

const aad = (namespace, key) => Buffer.from(`${namespace}\0${key}`, "utf8");
const toInfo = (row) => ({ key: row.key, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at });
