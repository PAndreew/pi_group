import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage, PromptInput } from "./harness/types.js";

export interface Author { id: string; username: string }
export interface Authorship {
	authors: Record<string, Author>;
	pending: { id: string; content: string; author: Author; existing: string[] }[];
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const contentKey = (content: unknown) => {
	const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
	return hash(Array.isArray(blocks) ? blocks.map((block) => {
		if (block?.type === "text") return { type: "text", text: block.text };
		if (block?.type === "image") return { type: "image", data: block.data, mimeType: block.mimeType };
		return block;
	}) : blocks);
};

/** Include occurrence for harnesses without timestamps; no prompt text is stored in the sidecar. */
function messageKeys(messages: AgentMessage[]) {
	const counts = new Map<string, number>();
	return messages.map((message) => {
		const key = hash({ role: message.role, timestamp: message.timestamp, content: contentKey(message.content) });
		const occurrence = counts.get(key) ?? 0;
		counts.set(key, occurrence + 1);
		return `${key}:${occurrence}`;
	});
}

export function registerPrompt(ledger: Authorship, messages: AgentMessage[], input: PromptInput, author: Author) {
	const id = randomUUID();
	const content = [{ type: "text", text: input.text }, ...(input.images ?? []).map((image) => ({ type: "image", ...image }))];
	ledger.pending.push({ id, content: contentKey(content), author, existing: messageKeys(messages) });
	return id;
}

/** Match delivered prompts, not submission order (steering can overtake follow-ups). */
export function attributeMessages(ledger: Authorship, messages: AgentMessage[]) {
	const keys = messageKeys(messages);
	return messages.map((message, index) => {
		if (message.role !== "user") return message;
		const key = keys[index];
		if (!ledger.authors[key]) {
			const candidates = ledger.pending.filter((p) => p.content === contentKey(message.content) && !p.existing.includes(key));
			// Identical queued prompts from different people cannot be distinguished by the harness.
			if (candidates.length && candidates.every((p) => p.author.id === candidates[0].author.id)) {
				ledger.authors[key] = candidates[0].author;
				ledger.pending = ledger.pending.filter((p) => p.id !== candidates[0].id);
			} else if (candidates.length) {
				ledger.pending = ledger.pending.filter((p) => !candidates.includes(p));
			}
		}
		return { ...message, author: ledger.authors[key] };
	});
}

/** Keep authors attached after `before` was rewritten as `after` (same messages, edited content). */
export function rekeyAuthors(ledger: Authorship, before: AgentMessage[], after: AgentMessage[]) {
	const oldKeys = messageKeys(before);
	const newKeys = messageKeys(after);
	const moved = Object.fromEntries(oldKeys.flatMap((key, i) => (ledger.authors[key] ? [[newKeys[i], ledger.authors[key]]] : [])));
	for (const key of oldKeys) delete ledger.authors[key];
	Object.assign(ledger.authors, moved);
}

/** Keep authors attached after the message at `index` was removed from `before`. */
export function dropAuthor(ledger: Authorship, before: AgentMessage[], index: number) {
	const oldKeys = messageKeys(before);
	const newKeys = messageKeys(before.filter((_, i) => i !== index));
	const moved = Object.fromEntries(oldKeys.flatMap((key, i) => (i !== index && ledger.authors[key] ? [[newKeys[i < index ? i : i - 1], ledger.authors[key]]] : [])));
	for (const key of oldKeys) delete ledger.authors[key];
	Object.assign(ledger.authors, moved);
}
