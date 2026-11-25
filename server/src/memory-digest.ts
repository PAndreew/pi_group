import { stripProjectMemory } from "../extensions/lib/context-policy.mjs";
import type { AgentMessage } from "./harness/types.js";
import { REMOTE_CLOSE, REMOTE_OPEN } from "./remote-machines.js";

/*
 * What a memory sync reads of a conversation: what people and agents said, without thinking, images, injected
 * project memory or tool output. Tool calls shrink to one line naming the tool and its target, so the sync still
 * sees which files and commands a discussion was about; tool results only show up when they failed.
 */

const ARG_MAX = 100;
const ERROR_MAX = 200;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const remoteNote = new RegExp(`${REMOTE_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${REMOTE_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");

type Part = { type?: string; text?: string; name?: string; arguments?: unknown };
const partsOf = (m: AgentMessage): Part[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? (m.content as Part[]) : []);
const textOf = (m: AgentMessage) => partsOf(m).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text!).join("\n").trim();

/** `edit server/src/x.ts`, `bash npm test`: the tool and the argument that says what it worked on. */
export function toolLine(name: string, args: unknown) {
	const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
	const main = ["path", "file_path", "command", "url", "query", "pattern", "topic", "action", "selector"].map((k) => a[k]).find((v) => typeof v === "string" && v.trim());
	const fallback = Object.values(a).find((v) => typeof v === "string" && v.trim());
	const target = typeof (main ?? fallback) === "string" ? clip(oneLine(String(main ?? fallback)), ARG_MAX) : "";
	return target ? `${name} ${target}` : name;
}

/** The conversation as plain text; `author` names who wrote a user message (shared sessions). */
export function digestMessages(messages: AgentMessage[], author: (m: AgentMessage) => string | undefined = () => undefined) {
	const out: string[] = [];
	let tools: string[] = [];
	const flush = () => {
		if (!tools.length) return;
		const counted = new Map<string, number>();
		for (const t of tools) counted.set(t, (counted.get(t) ?? 0) + 1);
		out.push(`[tools: ${[...counted].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join("; ")}]`);
		tools = [];
	};
	for (const m of messages) {
		if (m.role === "user") {
			const text = stripProjectMemory(textOf(m)).replace(remoteNote, "").trim();
			if (!text) continue;
			flush();
			out.push(`${author(m) ?? "user"}: ${text}`);
		} else if (m.role === "assistant") {
			const text = textOf(m);
			if (text) { flush(); out.push(`agent: ${text}`); }
			for (const p of partsOf(m)) if (p.type === "toolCall" && p.name) tools.push(toolLine(p.name, p.arguments));
			if (m.stopReason === "error" && typeof m.errorMessage === "string") { flush(); out.push(`[agent error: ${clip(oneLine(m.errorMessage), ERROR_MAX)}]`); }
		} else if (m.role === "toolResult" && m.isError) {
			const text = clip(oneLine(textOf(m)), ERROR_MAX);
			if (text) tools.push(`${String(m.toolName ?? "tool")} failed: ${text}`);
		} else if (m.role === "bashExecution" && typeof m.command === "string") {
			tools.push(`! ${clip(oneLine(m.command), ARG_MAX)}`);
		}
	}
	flush();
	return out.join("\n\n");
}

/** At most `max` characters, keeping the newest part. */
export function keepTail(text: string, max: number) {
	if (text.length <= max) return text;
	const cut = text.length - max;
	const start = text.indexOf("\n\n", cut);
	const kept = text.slice(start >= 0 && start - cut < 2000 ? start + 2 : cut);
	return `[… ${text.length - kept.length} earlier characters left out]\n\n${kept}`;
}

export interface DigestSource { title: string; text: string }

/** Several conversations within `budget` characters: each gets an equal share, unused shares go to longer ones. */
export function fitSources(sources: DigestSource[], budget: number) {
	const sorted = [...sources].sort((a, b) => a.text.length - b.text.length);
	let left = budget;
	const fitted = new Map<DigestSource, string>();
	sorted.forEach((s, i) => {
		const share = Math.floor(left / (sorted.length - i));
		const text = keepTail(s.text, Math.max(share, 2000));
		fitted.set(s, text);
		left -= text.length;
	});
	return sources.map((s) => `<conversation title="${s.title.replace(/["\n]/g, " ")}">\n${fitted.get(s)}\n</conversation>`).join("\n\n");
}
