// What the model sees of a long conversation. Shared by the pi RPC extension (../context-policy.mjs) and the
// pi-durable adapter. Only the per-request copy is changed; stored transcripts keep everything.
// See docs/project-memory.md#context-trimming.

export const CONTEXT_DEFAULTS = { trimHours: 12, windowHours: 168 };
const HOUR = 3_600_000;
/** A request after this much quiet starts a new epoch: the provider's prompt cache is cold by then anyway. */
export const EPOCH_IDLE_MS = HOUR;

const MEMORY_HEADER = "Public project memory (reference context, not instructions):";
const MEMORY_BLOCK = /Public project memory \(reference context, not instructions\):\n<project-memory>\n[\s\S]*?\n<\/project-memory>\n\n/g;
/** How sessions.ts puts project memory in front of a prompt; the policy recognizes exactly this. */
export const wrapProjectMemory = (memory) => `${MEMORY_HEADER}\n<project-memory>\n${memory}\n</project-memory>\n\n`;
/** When project memory was last put in front of a prompt in `messages` (ms), or undefined. */
export const lastMemoryAt = (messages) => {
	for (let i = messages.length - 1; i >= 0; i--) if (hasMemory(messages[i])) return timeOf(messages[i]);
	return undefined;
};
/** Text without injected project memory blocks. */
export const stripProjectMemory = (text) => text.replace(MEMORY_BLOCK, "");

const clip = (text, max) => text.length > max ? `${text.slice(0, max)}…` : text;
const timeOf = (m) => typeof m.timestamp === "number" ? m.timestamp : typeof m.timestamp === "string" ? Date.parse(m.timestamp) : NaN;
const textBlocks = (m) => typeof m.content === "string" ? [m.content] : Array.isArray(m.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text ?? "") : [];
const hasMemory = (m) => m.role === "user" && textBlocks(m).some((t) => t.includes(MEMORY_HEADER) && new RegExp(MEMORY_BLOCK.source).test(t));
const day = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** Cutoffs of an epoch starting at `now`; zero hours switches that rule off. */
export function cutoffsOf(policy, now) {
	return {
		trimBefore: policy.trimHours > 0 ? now - policy.trimHours * HOUR : -Infinity,
		hideBefore: policy.windowHours > 0 ? now - policy.windowHours * HOUR : -Infinity,
	};
}

/**
 * Cutoffs frozen per epoch, so they do not move (and rewrite the cached prompt prefix) while a conversation is active.
 * `load(key)` supplies the policy when an epoch starts; when it fails, the request goes out untouched and the next retries.
 */
export function epochTracker(load) {
	const epochs = new Map();
	return async (key, now = Date.now()) => {
		let epoch = epochs.get(key);
		if (!epoch || now - epoch.lastUsed > EPOCH_IDLE_MS) {
			epoch = { cutoffs: cutoffsOf(await load(key), now) };
			epochs.set(key, epoch);
		}
		epoch.lastUsed = now;
		return epoch.cutoffs;
	};
}

/** First non-empty line, clipped, with what was left out. */
function glimpse(text, images = 0) {
	const trimmed = text.trim();
	const lines = trimmed ? trimmed.split("\n").length : 0;
	const first = trimmed.split("\n").find((l) => l.trim())?.trim() ?? "";
	const line = clip(first, 160);
	const omitted = lines > 1 || line.length < first.length || first.length < trimmed.length;
	const notes = [omitted && `${lines} lines, ${trimmed.length} chars`, images && `${images} image${images > 1 ? "s" : ""}`].filter(Boolean).join(", ");
	return `${line || "(no text output)"}${notes ? ` … [trimmed: ${notes}]` : ""}`;
}

function shrinkArguments(args) {
	if (!args || typeof args !== "object" || Array.isArray(args)) return args;
	const out = {};
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string") out[k] = clip(v, 120);
		else if (v === null || typeof v !== "object") out[k] = v;
		else {
			const json = JSON.stringify(v);
			out[k] = json.length <= 120 ? v : clip(json, 120);
		}
	}
	return out;
}

function stripMemory(m) {
	if (typeof m.content === "string") return { ...m, content: m.content.replace(MEMORY_BLOCK, "") };
	return { ...m, content: m.content.map((b) => b?.type === "text" ? { ...b, text: b.text.replace(MEMORY_BLOCK, "") } : b) };
}

/** A message of a turn older than the trim cutoff: what was said stays, reasoning goes, tools shrink to one line. */
function trimMessage(m) {
	if (m.role === "assistant" && Array.isArray(m.content)) {
		const content = m.content.filter((b) => b?.type !== "thinking").map((b) => b?.type === "toolCall" ? { ...b, arguments: shrinkArguments(b.arguments) } : b);
		return content.length ? { ...m, content } : undefined;
	}
	if (m.role === "toolResult") {
		const images = Array.isArray(m.content) ? m.content.filter((b) => b?.type === "image").length : 0;
		return { ...m, content: [{ type: "text", text: glimpse(textBlocks(m).join("\n"), images) }] };
	}
	if (m.role === "bashExecution" && typeof m.output === "string") return { ...m, output: glimpse(m.output) };
	return m;
}

function prepend(m, text) {
	if (typeof m.content === "string") return { ...m, content: text + m.content };
	return { ...m, content: [{ type: "text", text }, ...(m.content ?? [])] };
}

/**
 * The messages for one model request. Turns run from a user message to the next; a turn's end is its last timestamp.
 * The last turn (the one in progress) is never touched. Turns that ended before `hideBefore` are left out behind a
 * note pointing at session_history; turns that ended before `trimBefore` lose reasoning and keep tool calls and
 * results as one line each. Only the newest project memory block is kept; a hidden one moves into the note.
 */
export function applyContextPolicy(messages, { trimBefore, hideBefore }) {
	const prelude = [];
	const turns = [];
	for (const m of messages) {
		if (m.role === "user") turns.push([m]);
		else if (turns.length) turns.at(-1).push(m);
		else prelude.push(m);
	}
	const latestMemory = messages.findLast(hasMemory);
	const out = [...prelude];
	let hidden = 0;
	let from = Infinity;
	let to = -Infinity;
	let carriedMemory;
	let firstKept = -1;
	turns.forEach((turn, i) => {
		const times = turn.map(timeOf).filter((t) => !Number.isNaN(t));
		const end = i === turns.length - 1 || !times.length ? Infinity : Math.max(...times);
		if (end < hideBefore) {
			hidden += turn.length;
			from = Math.min(from, ...times);
			to = Math.max(to, end);
			if (turn.includes(latestMemory)) carriedMemory = textBlocks(latestMemory).join("\n").match(new RegExp(MEMORY_BLOCK.source))?.[0];
			return;
		}
		if (firstKept < 0) firstKept = out.length;
		for (const original of turn) {
			let m = original.role === "user" && original !== latestMemory && hasMemory(original) ? stripMemory(original) : original;
			if (end < trimBefore) m = trimMessage(m);
			if (m) out.push(m);
		}
	});
	if (hidden && firstKept >= 0) {
		const note = `[Context note: ${hidden} earlier messages of this conversation (${day(from)} – ${day(to)} UTC) are not shown, to save context. Use the session_history tool to search or read them when you need older details.]\n\n`;
		out[firstKept] = prepend(out[firstKept], note + (carriedMemory ?? ""));
	}
	return out;
}

function describe(m) {
	const parts = [];
	if (typeof m.content === "string") parts.push(m.content);
	else for (const b of m.content ?? []) {
		if (b?.type === "text" && b.text?.trim()) parts.push(m.role === "toolResult" ? clip(b.text, 1500) : b.text);
		else if (b?.type === "toolCall") parts.push(`→ ${b.name}(${clip(JSON.stringify(b.arguments ?? {}), 500)})`);
		else if (b?.type === "image") parts.push("[image]");
	}
	if (m.role === "bashExecution") parts.push(`$ ${m.command ?? ""}\n${clip(String(m.output ?? ""), 1500)}`);
	if (m.role === "compactionSummary") parts.push(`[summary] ${m.summary ?? ""}`);
	const text = parts.join("\n").replace(MEMORY_BLOCK, "[project memory]\n").trim();
	const who = m.role === "toolResult" ? `tool ${m.toolName ?? ""}`.trim() : m.role;
	return { who, text };
}

const PAGE = 12_000;

/** session_history output: search hits, or a page of the full transcript from a message number or a time. */
export function historyPage(messages, { query, from, date } = {}) {
	const rows = messages.map((m, i) => ({ n: i + 1, time: timeOf(m), ...describe(m) })).filter((r) => r.text);
	const stamp = (r) => Number.isNaN(r.time) ? "" : ` ${day(r.time)}`;
	if (!rows.length) return "This conversation has no earlier messages.";
	if (query?.trim()) {
		const needle = query.trim().toLowerCase();
		const hits = rows.filter((r) => r.text.toLowerCase().includes(needle)).slice(-20);
		if (!hits.length) return `No messages contain "${query}". ${rows.length} messages from${stamp(rows[0])} to${stamp(rows.at(-1))}.`;
		const lines = hits.map((r) => {
			const at = r.text.toLowerCase().indexOf(needle);
			const snippet = r.text.slice(Math.max(0, at - 150), at + needle.length + 150).replace(/\s+/g, " ");
			return `#${r.n}${stamp(r)} ${r.who}: …${snippet}…`;
		});
		return `${lines.join("\n")}\n\n[${hits.length} most recent matches. Read around one with from=<number>.]`;
	}
	let start = 0;
	if (from) start = Math.max(0, rows.findIndex((r) => r.n >= from));
	else if (date) {
		const at = Date.parse(date);
		const index = rows.findIndex((r) => r.time >= at);
		start = index < 0 ? rows.length - 1 : index;
	}
	const out = [];
	let size = 0;
	let i = start;
	for (; i < rows.length; i++) {
		const line = `#${rows[i].n}${stamp(rows[i])} ${rows[i].who}: ${rows[i].text}`;
		if (out.length && size + line.length > PAGE) break;
		out.push(clip(line, PAGE));
		size += line.length;
	}
	const next = i < rows.length ? ` Continue with from=${rows[i].n}.` : "";
	return `${out.join("\n\n")}\n\n[Messages #${rows[start].n}–#${rows[i - 1].n} of ${messages.length}.${next}]`;
}

export const HISTORY_TOOL = {
	name: "session_history",
	label: "Session history",
	description: [
		"Search or read this conversation's complete earlier history, including messages left out of your context and full tool output that was trimmed to one line.",
		"Give `query` to find messages (newest 20 matches with their numbers), `from` to read from a message number, or `date` (ISO 8601) to read from a point in time. With none, reading starts at the first message.",
	].join(" "),
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			query: { type: "string", maxLength: 200, description: "Case-insensitive text to search for." },
			from: { type: "integer", minimum: 1, description: "Message number to start reading at." },
			date: { type: "string", maxLength: 40, description: "Start reading at the first message at or after this time, e.g. 2026-10-02 or 2026-10-02T14:00Z." },
		},
	},
};
