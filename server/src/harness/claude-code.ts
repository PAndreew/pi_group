import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { claudeAccountEnv, claudeBinary, claudeConnected } from "../claude-login.js";
export { claudeEnv } from "../claude-login.js";
import { config } from "../config.js";
import { redactLive } from "../live-redaction.js";
import { HttpError } from "../paths.js";
import { contentText, LiveSessionBase } from "./live-base.js";
import type { AgentMessage, HarnessAdapter, PromptInput } from "./types.js";

export const CLAUDE_CODE = "claude-code";
const tools = ["Read", "Glob", "Grep"];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function claudeArgs(resume?: string) {
	return ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
		"--restricted", "--strict-mcp-config", "--disable-slash-commands", "--permission-mode", "dontAsk",
		"--tools", tools.join(","), "--allowedTools", tools.join(","),
		...(resume ? ["--resume", resume] : [])];
}

type RecordValue = Record<string, unknown>;
const obj = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const blocks = (value: unknown) => Array.isArray(value) ? value.map(obj) : [];
const textBlock = (text: string) => ({ type: "text", text });
const assistantBlock = (block: RecordValue) => {
	if (block.type === "text" && typeof block.text === "string") return textBlock(block.text);
	if (block.type === "thinking" && typeof block.thinking === "string") return { type: "thinking", thinking: block.thinking };
	if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
		return { type: "toolCall", id: block.id, name: block.name, arguments: obj(block.input) };
	}
};

interface Transcript {
	id: string;
	ownerId: string;
	cwd: string;
	resume?: string;
	name?: string;
	createdAt: string;
	updatedAt: string;
	messages: AgentMessage[];
}

class ClaudeSession extends LiveSessionBase {
	private stop?: () => void;
	private done?: Promise<void>;
	constructor(private data: Transcript, private file: string, private binary: string) {
		super(data.id, data.cwd);
		this.state.messages = data.messages;
		this.state.name = data.name;
	}

	private async persist() {
		this.data.updatedAt = new Date().toISOString();
		const temp = `${this.file}.${randomUUID()}.tmp`;
		try {
			await fs.writeFile(temp, JSON.stringify(this.data), { mode: 0o600, flag: "wx" });
			await fs.rename(temp, this.file);
		} finally {
			await fs.rm(temp, { force: true });
		}
	}

	async prompt(input: PromptInput) {
		if (this.state.running) throw new HttpError(409, "Wait for Claude Code to finish or press Stop");
		if (input.images?.length) throw new HttpError(400, "Claude Code sessions accept text only");
		this.state.running = true;
		this.state.notice = undefined;
		this.emitStatus();
		this.pushMessage({ role: "user", content: [textBlock(input.text)], timestamp: Date.now() });
		this.done = this.run(input.text);
	}

	private async run(text: string) {
		let stopped = false;
		let timer: NodeJS.Timeout | undefined;
		let failure: string | undefined;
		let gotResult = false;
		const partial: RecordValue[] = [];
		const seen = new Set<string>();
		const toolNames = new Map<string, string>();
		const env = claudeAccountEnv(this.data.ownerId);
		const safeText = (value: string) => redactLive(`${CLAUDE_CODE}:${this.id}`, value);
		const safeBlock = async (block: RecordValue): Promise<RecordValue> => {
			if (typeof block.text === "string") return { ...block, text: await safeText(block.text) };
			if (typeof block.thinking === "string") return { ...block, thinking: await safeText(block.thinking) };
			if (block.type === "toolCall") {
				const args = await safeText(JSON.stringify(block.arguments ?? {}));
				try { return { ...block, arguments: JSON.parse(args) }; } catch { return { ...block, arguments: {} }; }
			}
			return block;
		};
		try {
			this.stop = () => { stopped = true; };
			// Fail closed rather than accidentally running on a console/API-key login.
			const connected = await claudeConnected(this.binary, env, this.cwd);
			if (stopped) return;
			if (!connected) {
				failure = "Claude Code needs a Pro or Max subscription login. Open your avatar menu → Harness login.";
				return;
			}
			const child = spawn(this.binary, claudeArgs(this.data.resume), { cwd: this.cwd, env, stdio: "pipe" });
			const exit = new Promise<number | null>(resolve => {
				child.once("error", () => { failure = "Could not start Claude Code."; });
				child.once("close", resolve);
			});
			this.stop = () => {
				if (stopped) return;
				stopped = true;
				child.kill("SIGTERM");
				timer = setTimeout(() => child.kill("SIGKILL"), 2000);
				timer.unref();
			};
			child.stderr.resume(); // Never echo raw diagnostics or credentials to chat.
			child.stdin.on("error", () => {});
			child.stdin.end(text);
			const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
			try {
				for await (const line of lines) {
					if (stopped) continue;
					let event: RecordValue;
					try { event = obj(JSON.parse(line)); } catch { continue; }
					if (event.parent_tool_use_id) continue;
					if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string" && uuid.test(event.session_id)) {
						this.data.resume = event.session_id;
					} else if (event.type === "stream_event") {
						const detail = obj(event.event);
						if (detail.type === "message_start") partial.length = 0;
						const i = Number(detail.index);
						if (!Number.isInteger(i) || i < 0 || i > 1024) continue;
						if (detail.type === "content_block_start") {
							const block = assistantBlock(obj(detail.content_block));
							if (block) partial[i] = block;
						} else if (detail.type === "content_block_delta") {
							const delta = obj(detail.delta);
							if (delta.type === "text_delta" && typeof delta.text === "string") partial[i] = textBlock(String(partial[i]?.text ?? "") + delta.text);
							if (delta.type === "thinking_delta" && typeof delta.thinking === "string") partial[i] = { type: "thinking", thinking: String(partial[i]?.thinking ?? "") + delta.thinking };
						}
						this.state.partial = { role: "assistant", content: await Promise.all(partial.filter(Boolean).map(safeBlock)) };
						this.partialChanged();
					} else if (event.type === "assistant") {
						if (event.error && event.error !== "max_output_tokens") {
							failure = await safeText(contentText(obj(event.message).content).slice(0, 1000)) || "Claude Code reported a provider error.";
							continue;
						}
						if (typeof event.uuid === "string") {
							if (seen.has(event.uuid)) continue;
							seen.add(event.uuid);
						}
						const content = await Promise.all(blocks(obj(event.message).content).map(assistantBlock).filter(block => block !== undefined).map(safeBlock));
						for (const block of content) if (block.type === "toolCall") toolNames.set(String(block.id), String(block.name));
						this.state.runningTools = [...toolNames.keys()];
						this.state.partial = null;
						this.partialChanged(true);
						if (content.length) this.pushMessage({ role: "assistant", content, timestamp: Date.now() });
						this.emitStatus();
					} else if (event.type === "user" && !event.isReplay) {
						for (const block of blocks(obj(event.message).content)) {
							const id = String(block.tool_use_id);
							const name = toolNames.get(id);
							if (block.type !== "tool_result" || !name) continue;
							toolNames.delete(id);
							this.pushMessage({ role: "toolResult", toolCallId: id, toolName: name, isError: block.is_error === true,
								content: [textBlock(await safeText(contentText(block.content)))], timestamp: Date.now() });
						}
						this.state.runningTools = [...toolNames.keys()];
						this.emitStatus();
					} else if (event.type === "result") {
						gotResult = true;
						if (event.is_error || event.subtype !== "success") {
							const errors = Array.isArray(event.errors) ? event.errors.filter(e => typeof e === "string").join("\n") : "";
							const detail = errors || (typeof event.result === "string" ? event.result : "");
							failure = detail ? await safeText(detail.slice(0, 1000)) : failure ?? "Claude Code could not finish the turn.";
						} else {
							failure = undefined;
						}
					}
				}
			} finally {
				if (!gotResult && !stopped && child.exitCode === null && child.signalCode === null) {
					child.kill("SIGTERM");
					timer = setTimeout(() => child.kill("SIGKILL"), 2000);
					timer.unref();
				}
				const code = await exit;
				if (!gotResult || code !== 0) failure ??= "Claude Code exited without completing the turn. Check the CLI version and login on the Beezy host.";
			}
		} catch {
			failure ??= "Beezy could not process the Claude Code response.";
		} finally {
			clearTimeout(timer);
			this.stop = undefined;
			this.state.partial = null;
			this.partialChanged(true);
			for (const [id, name] of toolNames) this.pushMessage({ role: "toolResult", toolCallId: id, toolName: name, isError: true,
				content: [textBlock(stopped ? "Stopped" : "No tool result received")], timestamp: Date.now() });
			if (stopped) this.pushMessage({ role: "assistant", content: [], stopReason: "aborted", timestamp: Date.now() });
			try { await this.persist(); } catch { failure = "Beezy could not save the Claude Code transcript."; }
			this.state.runningTools = [];
			if (failure && !stopped) this.notice("error", failure);
			this.state.running = false;
			this.emitStatus();
		}
	}

	async abort() { this.stop?.(); await this.done; }
	async close() { await this.abort(); this.markClosed(); }
	async setName(name: string) { this.state.name = this.data.name = name; this.emitStatus(); }
	async setModel() { throw new HttpError(400, "Claude Code uses the CLI's default model"); }
	async setThinkingLevel() { throw new HttpError(400, "Claude Code uses the CLI's default effort"); }
	answerDialog() {}
}

export class ClaudeCodeAdapter implements HarnessAdapter {
	readonly id = CLAUDE_CODE;
	readonly label = "Claude Code";
	readonly description = "Private subscription chat, with read-only project tools.";
	readonly durable = false;
	private sessions = new Map<string, ClaudeSession>();
	constructor(private root = path.join(config.dataDir, "claude-code"), private binary = claudeBinary) {}
	async init() {}
	async available(): Promise<{ ok: boolean; reason?: string }> {
		if (!path.isAbsolute(this.binary)) return { ok: false, reason: "Set BEEZY_CLAUDE_BINARY to the absolute CLI path" };
		return fs.access(this.binary, constants.X_OK).then(() => ({ ok: true }), () => ({ ok: false, reason: "Claude binary is not executable" }));
	}
	async listModels() { return []; }
	private dir(cwd: string) { return path.join(this.root, createHash("sha256").update(cwd).digest("hex")); }
	private file(id: string, cwd: string) {
		if (!uuid.test(id)) throw new HttpError(404, "Session not found");
		return path.join(this.dir(cwd), `${id}.json`);
	}
	async listSessions(cwd: string) {
		const files = await fs.readdir(this.dir(cwd)).catch(() => []);
		return (await Promise.all(files.filter(file => file.endsWith(".json")).map(file => this.readSession(file.slice(0, -5), cwd))))
			.filter(data => data !== undefined).map(({ messages, ...data }) => ({ ...data, messageCount: messages.length }));
	}
	async readSession(id: string, cwd: string): Promise<Transcript | undefined> {
		try { return JSON.parse(await fs.readFile(this.file(id, cwd), "utf8")) as Transcript; } catch { return undefined; }
	}
	live(id: string) { return this.sessions.get(id); }
	liveSessions() { return [...this.sessions.values()]; }
	private attach(data: Transcript) {
		const live = new ClaudeSession(data, this.file(data.id, data.cwd), this.binary);
		this.sessions.set(data.id, live);
		live.onClosed = () => { this.sessions.delete(data.id); };
		return live;
	}
	async open(id: string, cwd: string) {
		const current = this.live(id);
		if (current) return current;
		const data = await this.readSession(id, cwd);
		if (!data?.ownerId) throw new HttpError(404, "This Claude session has no personal login. Create a new session.");
		return this.live(id) ?? this.attach(data);
	}
	async create(cwd: string, options: { name?: string; ownerId?: string }) {
		if (!options.ownerId) throw new HttpError(403, "Claude Code requires a session owner");
		const available = await this.available();
		if (!available.ok) throw new HttpError(503, available.reason ?? "Claude Code unavailable");
		if (!await claudeConnected(this.binary, claudeAccountEnv(options.ownerId), cwd)) throw new HttpError(409, "Connect Claude Code from your avatar menu → Harness login first");
		const now = new Date().toISOString();
		const data: Transcript = { id: randomUUID(), ownerId: options.ownerId, cwd, name: options.name, createdAt: now, updatedAt: now, messages: [] };
		await fs.mkdir(this.dir(cwd), { recursive: true, mode: 0o700 });
		await fs.writeFile(this.file(data.id, cwd), JSON.stringify(data), { mode: 0o600, flag: "wx" });
		return this.attach(data);
	}
	async deleteSession(id: string, cwd: string) {
		await this.live(id)?.close();
		await fs.rm(this.file(id, cwd), { force: true });
		return true; // Claude's own CLI history is separate from Beezy's transcript.
	}
	async inventory() { return { tools: tools.map(name => ({ name, origin: "Claude Code" })), commands: [] }; }
	async usage() { return {}; }
	async shutdown() { await Promise.all(this.liveSessions().map(live => live.close())); }
}
