import { z } from "zod";
import { HttpError } from "./paths.js";
import { platform, type SqlDatabase, type SqlValue } from "./ports/index.js";

// No applet-supplied SQL. Only identifiers matching this grammar enter generated expressions.
export const dataId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
const label = z.string().trim().min(1).max(120);
const columnType = z.enum(["text", "number", "boolean", "date"]);
const system = { id: "number", createdAt: "date" } as const;
const scalar = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);
const mapping = z.record(dataId, dataId);
const collection = z.object({ id: dataId, columns: z.record(dataId, columnType) }).strict();
const write = z.object({ id: dataId, collection: dataId, type: z.enum(["insert", "update", "delete"]), columns: z.array(dataId).max(20), agent: z.boolean().optional(), ifEmpty: dataId.optional() }).strict();
const metric = z.object({ id: dataId, op: z.enum(["count", "sum", "avg", "gapDays"]), column: dataId.optional() }).strict();
const source = { id: dataId, collection: dataId, where: z.record(dataId, scalar).optional() };
const read = z.discriminatedUnion("type", [
	z.object({ ...source, type: z.literal("rows"), columns: z.array(dataId).min(1).max(20), order: z.enum(["newest", "oldest"]).optional() }).strict(),
	z.object({ ...source, type: z.literal("summary"), groupBy: dataId, bucket: z.enum(["day", "month"]).optional(), metrics: z.array(metric).min(1).max(6), sort: z.enum(["group", "value"]).optional() }).strict(),
]);
const view = z.discriminatedUnion("type", [
	z.object({ id: dataId, title: label, read: dataId, type: z.literal("table"), columns: z.array(z.object({ key: dataId, label }).strict()).min(1).max(20) }).strict(),
	z.object({ id: dataId, title: label, read: dataId, type: z.literal("chart"), chart: z.enum(["bar", "line"]), x: dataId, y: dataId, label, unit: z.string().max(30).optional() }).strict(),
]);
export const dataSpec = z.object({ collections: z.array(collection).min(1).max(8), reads: z.array(read).max(16), writes: z.array(write).max(16), views: z.array(view).max(8) }).strict();
export const dataAction = { type: z.literal("data_write"), write: dataId, fields: mapping, reset: z.boolean().optional(), section: label.optional() };
export const readPage = z.object({ limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(5000).default(0) });
export type DataSpec = z.infer<typeof dataSpec>;
export type DataWrite = z.infer<typeof write>;
type DataRead = z.infer<typeof read>;
type Scalar = z.infer<typeof scalar>;
type ColumnType = z.infer<typeof columnType>;
type DataScope = { tenant: string; applet: string; user: string };
const owns = (o: object, k: string) => Object.hasOwn(o, k);
const unique = (ids: string[]) => new Set(ids).size === ids.length;

export const writeInputs = (op: DataWrite) => op.type === "insert" ? op.columns : ["id", ...op.columns];

export function validateDataSpec(data: DataSpec, issue: (message: string) => void) {
	for (const set of [data.collections, data.reads, data.writes, data.views]) {
		if (!unique(set.map((x) => x.id))) issue("Data IDs must be unique within each section");
	}
	for (const c of data.collections) {
		const keys = Object.keys(c.columns);
		if (keys.length < 1 || keys.length > 20 || keys.some((k) => owns(system, k) || k === "constructor")) issue(`Collection ${c.id} must have 1–20 columns and cannot redefine system columns`);
	}
	for (const op of data.writes) {
		const c = data.collections.find((c) => c.id === op.collection);
		if (!c || !unique(op.columns) || op.columns.some((k) => !owns(c.columns, k))) issue(`Write ${op.id} must name valid, distinct columns`);
		if ((op.type === "delete") !== (op.columns.length === 0)) issue(`Only delete writes take no columns: ${op.id}`);
		if (op.ifEmpty && (op.type !== "update" || !c || !owns(c.columns, op.ifEmpty))) issue(`Invalid ifEmpty guard on ${op.id}`);
	}
	const results = new Map<string, Map<string, ColumnType>>();
	for (const q of data.reads) {
		const c = data.collections.find((c) => c.id === q.collection);
		if (!c) { issue(`Read ${q.id} names an unknown collection`); continue; }
		const columns = new Map<string, ColumnType>(Object.entries({ ...c.columns, ...system }));
		const output = new Map<string, ColumnType>();
		for (const [k, v] of Object.entries(q.where ?? {})) {
			const type = columns.get(k);
			if (!type || !validValue(type, v)) issue(`Invalid filter ${k} on ${q.id}`);
		}
		if (q.type === "rows") {
			if (!unique(q.columns)) issue(`Read ${q.id} repeats columns`);
			for (const k of q.columns) {
				const type = columns.get(k);
				if (!type) issue(`Unknown column ${k} on ${q.id}`);
				else output.set(k, type);
			}
		} else {
			const type = columns.get(q.groupBy);
			if (!type || (q.bucket && type !== "date")) issue(`Invalid grouping on ${q.id}`);
			else output.set(q.groupBy, type);
			for (const m of q.metrics) {
				const metricType = m.column ? columns.get(m.column) : undefined;
				if (output.has(m.id) || (m.op === "count" ? m.column !== undefined : metricType !== (m.op === "gapDays" ? "date" : "number"))) issue(`Invalid metric ${m.id} on ${q.id}`);
				output.set(m.id, "number");
			}
		}
		results.set(q.id, output);
	}
	for (const v of data.views) {
		const output = results.get(v.read);
		if (!output || (v.type === "table" ? v.columns.some((c) => !output.has(c.key)) || !unique(v.columns.map((c) => c.key)) : !output.has(v.x) || output.get(v.y) !== "number")) issue(`View ${v.id} must use columns returned by its read (chart y must be numeric)`);
	}
}

export function checkDataUpgrade(previous: DataSpec | undefined, next: DataSpec | undefined) {
	for (const c of previous?.collections ?? []) {
		const updated = next?.collections.find((x) => x.id === c.id);
		if (!updated || Object.entries(c.columns).some(([k, type]) => updated.columns[k] !== type)) {
			throw new HttpError(409, `Existing columns and collections cannot be removed or retyped: ${c.id}`);
		}
	}
}

const DB = "applet-data";
const scopeArgs = (scope: DataScope) => [scope.tenant, scope.applet, scope.user];
const scoped = "tenant = ? AND applet = ? AND user = ? AND collection = ?";
function withDb<T>(fn: (db: SqlDatabase) => T): T {
	const db = platform().openSql(DB);
	try {
		db.exec(`CREATE TABLE IF NOT EXISTS applet_records (
			tenant TEXT NOT NULL, applet TEXT NOT NULL, user TEXT NOT NULL, collection TEXT NOT NULL,
			id INTEGER NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL,
			PRIMARY KEY (tenant, applet, user, collection, id)
		) WITHOUT ROWID;
		CREATE TABLE IF NOT EXISTS applet_sequences (
			tenant TEXT NOT NULL, applet TEXT NOT NULL, user TEXT NOT NULL, collection TEXT NOT NULL, last_id INTEGER NOT NULL,
			PRIMARY KEY (tenant, applet, user, collection)
		) WITHOUT ROWID;`);
		return fn(db);
	} finally {
		db.close();
	}
}

function validValue(type: ColumnType, value: unknown): value is Scalar {
	if (value === null) return true;
	if (type === "text") return typeof value === "string" && value.trim().length > 0 && value.length <= 20_000;
	if (type === "number") return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
	if (type === "boolean") return typeof value === "boolean";
	if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
	const date = new Date(value);
	return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const expr = (key: string) => key === "id" ? "id" : key === "createdAt" ? "created_at" : `json_extract(payload, '$.${key}')`;
const alias = (key: string) => `"${key}"`;
const sqlValue = (v: Scalar): SqlValue => typeof v === "boolean" ? Number(v) : v;

function query(db: SqlDatabase, scope: DataScope, q: DataRead, limit: number, offset: number) {
	const filters = Object.entries(q.where ?? {});
	const where = `${scoped}${filters.map(([k]) => ` AND ${k === "createdAt" ? "substr(created_at, 1, 10)" : expr(k)} IS ?`).join("")}`;
	const args = [...scopeArgs(scope), q.collection, ...filters.map(([, v]) => sqlValue(v)), limit + 1, offset];
	if (q.type === "rows") {
		const columns = q.columns.map((k) => `${expr(k)} AS ${alias(k)}`).join(", ");
		return db.prepare(`SELECT ${columns} FROM applet_records WHERE ${where} ORDER BY id ${q.order === "oldest" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`).all(...args);
	}
	const group = q.bucket ? `substr(${expr(q.groupBy)}, 1, ${q.bucket === "month" ? 7 : 10})` : expr(q.groupBy);
	const metrics = q.metrics.map((m) => {
		const col = m.column ? expr(m.column) : "*";
		const sql = m.op === "gapDays" ? `ROUND((julianday(MAX(${col})) - julianday(MIN(${col}))) / NULLIF(COUNT(${col}) - 1, 0), 1)` : `${m.op.toUpperCase()}(${m.op === "sum" ? `CAST(${col} AS REAL)` : col})`;
		return `${sql} AS ${alias(m.id)}`;
	});
	return db.prepare(`SELECT ${group} AS ${alias(q.groupBy)}, ${metrics.join(", ")} FROM applet_records WHERE ${where} AND ${group} IS NOT NULL GROUP BY ${group} ORDER BY ${q.sort === "value" ? "2 DESC, " : ""}1 ASC LIMIT ? OFFSET ?`).all(...args);
}

function page(db: SqlDatabase, scope: DataScope, data: DataSpec, q: DataRead, limit: number, offset: number) {
	const rows = query(db, scope, q, limit, offset);
	const columns = data.collections.find((c) => c.id === q.collection)!.columns;
	const booleanKeys = q.type === "rows" ? q.columns.filter((k) => columns[k] === "boolean") : columns[q.groupBy] === "boolean" ? [q.groupBy] : [];
	let bytes = 0;
	const shown = [];
	for (const row of rows.slice(0, limit)) {
		for (const key of booleanKeys) if (row[key] !== null) row[key] = row[key] === 1;
		bytes += Buffer.byteLength(JSON.stringify(row));
		if (shown.length && bytes > 48_000) break;
		shown.push(row);
	}
	return { rows: shown, nextOffset: shown.length < rows.length ? offset + shown.length : null };
}

export function readAppletData(scope: DataScope, data: DataSpec, readId: string, limit: number, offset: number) {
	const q = data.reads.find((q) => q.id === readId);
	if (!q) throw new HttpError(404, "Unknown applet read");
	return withDb((db) => page(db, scope, data, q, limit, offset));
}

export function readAppletViews(scope: DataScope, data: DataSpec, viewId?: string, offset = 0) {
	const views = viewId ? data.views.filter((v) => v.id === viewId) : data.views;
	if (viewId && !views.length) throw new HttpError(404, "Unknown applet view");
	return withDb((db) => Object.fromEntries(views.map((v) => [v.id, page(db, scope, data, data.reads.find((r) => r.id === v.read)!, v.type === "chart" ? 30 : 20, offset)])));
}

export function writeAppletData(scope: DataScope, data: DataSpec, op: DataWrite, values: Record<string, unknown>) {
	const keys = writeInputs(op);
	const columns = data.collections.find((c) => c.id === op.collection)!.columns;
	if (Object.keys(values).length !== keys.length || keys.some((k) => !owns(values, k))) throw new HttpError(400, `Expected values: ${keys.join(", ")}`);
	const id = values.id;
	if (op.type !== "insert" && (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) throw new HttpError(400, "A positive integer record ID is required");
	for (const k of op.columns) if (!validValue(columns[k], values[k])) throw new HttpError(400, `Invalid ${columns[k]} value for ${k}`);
	const patch = Object.fromEntries(op.columns.map((k) => [k, values[k]]));
	const args = [...scopeArgs(scope), op.collection];
	const encode = (payload: object) => {
		const json = JSON.stringify(payload);
		if (Buffer.byteLength(json) > 32_000) throw new HttpError(413, "An applet record can hold at most 32 KB");
		return json;
	};
	return withDb((db) => {
		db.exec("BEGIN IMMEDIATE");
		try {
			let result: { id: number; changed: boolean };
			if (op.type === "insert") {
				if (Number(db.prepare(`SELECT COUNT(*) AS size FROM applet_records WHERE ${scoped}`).get(...args)!.size) >= 5000) throw new HttpError(409, "This collection has reached 5,000 records. Delete old records before adding more.");
				const next = db.prepare(`INSERT INTO applet_sequences VALUES (?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET last_id = last_id + 1 RETURNING last_id`).get(...args)!;
				const newId = Number(next.last_id);
				db.prepare("INSERT INTO applet_records VALUES (?, ?, ?, ?, ?, ?, ?)").run(...args, newId, new Date().toISOString(), encode(patch));
				result = { id: newId, changed: true };
			} else {
				const row = db.prepare(`SELECT payload FROM applet_records WHERE ${scoped} AND id = ?`).get(...args, Number(id));
				if (!row) throw new HttpError(404, "Record not found");
				const current = JSON.parse(String(row.payload));
				const changed = !op.ifEmpty || !owns(current, op.ifEmpty) || current[op.ifEmpty] === null;
				if (op.type === "delete") db.prepare(`DELETE FROM applet_records WHERE ${scoped} AND id = ?`).run(...args, Number(id));
				else if (changed) db.prepare(`UPDATE applet_records SET payload = ? WHERE ${scoped} AND id = ?`).run(encode({ ...current, ...patch }), ...args, Number(id));
				result = { id: Number(id), changed };
			}
			db.exec("COMMIT");
			return result;
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	});
}

export function deleteAppletData(tenant: string, applet: string) {
	if (!platform().sqlExists(DB)) return;
	withDb((db) => {
		db.exec("BEGIN IMMEDIATE");
		try {
			db.prepare("DELETE FROM applet_records WHERE tenant = ? AND applet = ?").run(tenant, applet);
			db.prepare("DELETE FROM applet_sequences WHERE tenant = ? AND applet = ?").run(tenant, applet);
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	});
}
