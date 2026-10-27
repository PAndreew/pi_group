import { capabilityExtensions, toolCapabilities } from "../tool-capabilities.js";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { agentEnvironment } from "../assistance.js";
import { config } from "../config.js";
import { platform, type SandboxProcess } from "../ports/index.js";
import { expireInteractions, interactionEnvironment } from "../interactions.js";
import { applyAssistantDelta, contentText, LiveSessionBase } from "./live-base.js";
import type { AgentMessage, CommandInfo, CreateOptions, ExtensionDialog, HarnessAdapter, ModelInfo, PromptInput, SessionInventory, SessionListing, SessionUsage, ToolInfo, UsageRecord } from "./types.js";

type RpcRecord = Record<string, any>;
type Any = any;

function piCommand(args: string[]) {
	const isScript = config.piBin.endsWith(".js") || config.piBin.endsWith(".mjs");
	return { command: isScript ? process.execPath : config.piBin, argv: isScript ? [config.piBin, ...args] : args, shell: process.platform === "win32" && !isScript };
}

/** Run a one-shot pi CLI command (e.g. `pi mcp list --json`) and collect its output. */
export function runPi(args: string[], cwd: string, timeoutMs = 30_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const { command, argv, shell } = piCommand(args);
		const child = platform().sandbox.spawn(command, argv, { cwd, env: { ...agentEnvironment(), PI_SKIP_VERSION_CHECK: "1" }, shell });
		child.end();
		let stdout = "";
		let stderr = "";
		child.onStdout((chunk) => (stdout += chunk.toString("utf8")));
		child.onStderr((chunk) => (stderr = (stderr + chunk.toString("utf8")).slice(-4000)));
		const timer = setTimeout(() => {
			stderr += `
pi ${args.join(" ")} timed out`;
			child.kill();
		}, timeoutMs);
		child.onError((error) => (stderr += `
${error.message}`));
		child.onClose((code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

/**
 * The tools a session declared to the model: pi stores the loadout as system entries with
 * `toolsAdded` / `toolsRemoved` (the first request carries all of them, later ones patches).
 */
function declaredTools(records: RpcRecord[]): ToolInfo[] | undefined {
	let tools: Map<string, ToolInfo> | undefined;
	for (const record of records) {
		const entry = [record, record.message, record.data].find((e) => e && (Array.isArray(e.toolsAdded) || Array.isArray(e.toolsRemoved)));
		if (!entry) continue;
		tools ??= new Map();
		for (const t of entry.toolsRemoved ?? []) tools.delete(t.name);
		for (const t of entry.toolsAdded ?? []) if (t?.name) tools.set(t.name, { name: t.name, description: t.description, origin: /^mcp__(.+?)__/.exec(t.name)?.[1] });
	}
	return tools && [...tools.values()];
}

/**
 * One `pi --mode rpc` child process. Pi's RPC framing is strict JSONL split on LF only
 * (Node's readline would also split on U+2028/U+2029, which are valid inside JSON strings).
 */
class RpcProcess {
	private child: SandboxProcess;
	private pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void }>();
	private buffer = "";
	private decoder = new StringDecoder("utf8");
	stderrTail = "";
	exited = false;

	get pid() {
		return this.child.pid;
	}
	onRecord: (record: RpcRecord) => void = () => {};
	onExit: (code: number | null) => void = () => {};

	constructor(args: string[], cwd: string, sessionKey?: string) {
		// Production uses the extension snapshot from the same build as the server.
		// Source development can still load server/extensions directly.
		const builtExtensions = path.resolve(import.meta.dirname, "..", "extensions");
		const extension = (name: string) => ["--extension", path.resolve(existsSync(builtExtensions) ? builtExtensions : path.resolve(import.meta.dirname, "..", "..", "extensions"), name)];
		if (sessionKey) args = [...args, "--session-dir", sessionDirFor(cwd), "--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-approve", "--no-builtin-tools", "--tools", ["scope", "scoped_bash", "delegate_project", "butler_sessions", ...toolCapabilities().flatMap(c => c.tools.map(t => t.name))].join(","), ...capabilityExtensions().flatMap(file => ["--extension", file]), ...extension("project-scope.mjs")];
		const { command, argv, shell } = piCommand(args);
		this.child = platform().sandbox.spawn(command, argv, {
			cwd,
			env: { ...agentEnvironment(), PI_SKIP_VERSION_CHECK: "1", BEEZY_MCP_CONFIG: path.join(config.piAgentDir, "mcp.json"), ...(sessionKey ? interactionEnvironment(sessionKey) : {}) },
			shell,
		});
		this.child.onStdout((chunk) => this.read(this.decoder.write(chunk)));
		this.child.onStderr((chunk) => {
			this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-4000);
		});
		this.child.onError((error) => {
			this.stderrTail += `\n${error.message}`;
		});
		this.child.onExit((code) => {
			if (sessionKey) expireInteractions(sessionKey);
			this.exited = true;
			for (const { reject } of this.pending.values()) reject(new Error(`pi exited (${code}): ${this.stderrTail.trim().slice(-500)}`));
			this.pending.clear();
			this.onExit(code);
		});
	}

	private read(text: string) {
		this.buffer += text;
		let newline = this.buffer.indexOf("\n");
		while (newline >= 0) {
			let line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.trim()) {
				try {
					this.dispatch(JSON.parse(line));
				} catch {
					// Not protocol data; ignore.
				}
			}
			newline = this.buffer.indexOf("\n");
		}
	}

	private dispatch(record: RpcRecord) {
		if (record.type === "response" && record.id && this.pending.has(record.id)) {
			const waiter = this.pending.get(record.id)!;
			this.pending.delete(record.id);
			if (record.success) waiter.resolve(record.data);
			else waiter.reject(new Error(record.error ?? `${record.command} failed`));
			return;
		}
		this.onRecord(record);
	}

	write(record: RpcRecord) {
		if (this.exited) throw new Error("pi process is not running");
		this.child.write(`${JSON.stringify(record)}\n`);
	}

	send<T = any>(command: RpcRecord, timeoutMs = 60_000): Promise<T> {
		const id = randomUUID();
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`pi did not answer ${command.type} in time`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (data) => {
					clearTimeout(timer);
					resolve(data);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			try {
				this.write({ ...command, id });
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error as Error);
			}
		});
	}

	/** Closing stdin asks pi to shut down cleanly; kill if it does not. */
	async close() {
		if (this.exited) return;
		this.child.end();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.child.kill("SIGTERM");
				resolve();
			}, 5000);
			this.child.onExit(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
}

const toModelInfo = (m: any): ModelInfo => ({
	provider: m.provider,
	id: m.id,
	name: m.name ?? m.id,
	reasoning: m.reasoning,
	thinkingLevels: getSupportedThinkingLevels(m),
	contextWindow: m.contextWindow,
	input: m.input,
});

class PiLiveSession extends LiveSessionBase {
	sessionFile?: string;

	constructor(
		id: string,
		cwd: string,
		readonly rpc: RpcProcess,
	) {
		super(id, cwd);
		rpc.onRecord = (record) => this.handle(record);
		rpc.onExit = (code) => {
			if (code && code !== 0) this.notice("error", `pi exited with code ${code}. ${this.rpc.stderrTail.trim().slice(-400)}`);
			this.markClosed();
		};
	}

	async start(initialMessages?: AgentMessage[]) {
		const state = await this.rpc.send({ type: "get_state" }, 30_000);
		this.applyState(state);
		this.sessionFile = state.sessionFile;
		if (initialMessages) this.state.messages = initialMessages;
		else {
			const { messages } = await this.rpc.send({ type: "get_messages" });
			this.state.messages = (messages as AgentMessage[]).filter((m) => m.role !== "system");
		}
		this.emitState();
	}

	private applyState(state: any) {
		if (state.model) this.state.model = { provider: state.model.provider, id: state.model.id };
		this.state.thinkingLevel = state.thinkingLevel;
		this.state.running = Boolean(state.isStreaming);
		this.state.name = state.sessionName;
	}

	private handle(record: RpcRecord) {
		switch (record.type) {
			case "agent_start":
				this.state.running = true;
				this.state.notice = undefined;
				this.emitStatus();
				break;
			case "agent_settled":
				this.state.running = false;
				this.state.runningTools = [];
				this.state.partial = null;
				this.partialChanged(true);
				this.emitStatus();
				break;
			case "message_start":
				if (record.message?.role === "assistant") {
					this.state.partial = { ...record.message, content: [...(record.message.content ?? [])] };
					this.partialChanged(true);
				}
				break;
			case "message_update":
				if (!this.state.partial) this.state.partial = { role: "assistant", content: [], timestamp: Date.now() };
				applyAssistantDelta(this.state.partial, record.assistantMessageEvent ?? {});
				if (record.usage) this.state.partial.usage = record.usage;
				this.partialChanged();
				break;
			case "message_end": {
				const message = record.message as AgentMessage;
				if (message.role === "assistant") {
					this.state.partial = null;
					this.partialChanged(true);
					if (message.stopReason === "error" && message.errorMessage) this.notice("error", String(message.errorMessage));
				}
				this.pushMessage(message);
				break;
			}
			case "turn_end":
				for (const result of record.toolResults ?? []) this.pushMessage(result);
				break;
			case "tool_execution_start":
				this.state.runningTools = [...new Set([...this.state.runningTools, record.toolCallId])];
				this.state.toolOutputs[record.toolCallId] = "";
				this.emitStatus();
				break;
			case "tool_execution_update": {
				const text = contentText(record.partialResult?.content);
				this.state.toolOutputs[record.toolCallId] = text;
				this.toolOutputChanged(record.toolCallId);
				break;
			}
			case "tool_execution_end":
				this.state.runningTools = this.state.runningTools.filter((id) => id !== record.toolCallId);
				delete this.state.toolOutputs[record.toolCallId];
				this.emitStatus();
				break;
			case "queue_update":
				this.state.queue = { steering: record.steering ?? [], followUp: record.followUp ?? [] };
				this.emitStatus();
				break;
			case "thinking_level_changed":
				this.state.thinkingLevel = record.level;
				this.emitStatus();
				break;
			case "session_info_changed":
				this.state.name = record.name;
				this.emitStatus();
				break;
			case "auto_retry_start":
				this.notice("warn", `Retrying (${record.attempt}/${record.maxAttempts}): ${record.errorMessage}`);
				break;
			case "auto_retry_end":
				if (!record.success) this.notice("error", `Retries failed: ${record.finalError ?? "unknown error"}`);
				break;
			case "compaction_start":
				this.notice("info", `Compacting context (${record.reason})…`);
				break;
			case "compaction_end":
				if (record.errorMessage) this.notice("warn", `Compaction failed: ${record.errorMessage}`);
				else if (record.result) this.pushMessage({ role: "compactionSummary", summary: record.result.summary, tokensBefore: record.result.tokensBefore, timestamp: Date.now() });
				break;
			case "extension_ui_request":
				this.extensionUi(record);
				break;
			case "extension_error":
				this.notice("warn", `Extension error: ${record.error}`);
				// Pi normally logs extension exceptions and continues. A failed context
				// guard must not silently send the unfiltered result to the provider.
				if (["cloudflare-assistance.mjs", "project-scope.mjs"].some(name => String(record.extensionPath ?? "").endsWith(name))) this.rpc.write({ type: "abort" });
				break;
		}
	}

	private extensionUi(record: RpcRecord) {
		if (["select", "confirm", "input", "editor"].includes(record.method)) {
			const dialog: ExtensionDialog = {
				id: record.id,
				method: record.method,
				title: record.title,
				message: record.message,
				options: record.options,
				placeholder: record.placeholder,
				prefill: record.prefill,
			};
			this.state.dialogs = [...this.state.dialogs, dialog];
			this.emitStatus();
			if (record.timeout) setTimeout(() => this.dropDialog(record.id), record.timeout);
		} else if (record.method === "notify") {
			this.notice(record.notifyType === "error" ? "error" : record.notifyType === "warning" ? "warn" : "info", String(record.message ?? ""));
		}
	}

	private dropDialog(id: string) {
		if (!this.state.dialogs.some((d) => d.id === id)) return;
		this.state.dialogs = this.state.dialogs.filter((d) => d.id !== id);
		this.emitStatus();
	}

	answerDialog(id: string, answer: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
		this.rpc.write({ type: "extension_ui_response", id, ...answer });
		this.dropDialog(id);
	}

	async verifyAssistance() {
		const { commands } = await this.rpc.send({ type: "get_commands" });
		if (!commands?.some((c: Any) => c.name === "beezy-assistance-ready")) throw new Error("Cloudflare runtime extension is unavailable. Reopen the session with a compatible pi version.");
	}

	async prompt(input: PromptInput) {
		const { commands } = await this.rpc.send({ type: "get_commands" });
		if (!commands?.some((c: Any) => c.name === "beezy-scope-ready")) throw new Error("Scoped runtime extension unavailable; refusing an unscoped run");
		this.touch();
		const images = input.images?.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }));
		if (this.state.running) {
			const type = input.mode === "steer" ? "steer" : "follow_up";
			await this.rpc.send({ type, message: input.text, images });
		} else {
			await this.rpc.send({ type: "prompt", message: input.text, images });
		}
	}

	async abort() {
		await this.rpc.send({ type: "abort" }, 120_000);
	}

	async setModel(provider: string, modelId: string) {
		const model = await this.rpc.send({ type: "set_model", provider, modelId });
		this.state.model = { provider: model.provider, id: model.id };
		this.emitStatus();
	}

	async setThinkingLevel(level: string) {
		await this.rpc.send({ type: "set_thinking_level", level });
		const state = await this.rpc.send({ type: "get_state" });
		this.state.thinkingLevel = state.thinkingLevel;
		this.emitStatus();
	}

	async setName(name: string) {
		await this.rpc.send({ type: "set_session_name", name });
		this.state.name = name;
		this.emitStatus();
	}

	async availableModels(): Promise<ModelInfo[]> {
		const { models } = await this.rpc.send({ type: "get_available_models" });
		return (models as any[]).map(toModelInfo);
	}

	async close() {
		await this.rpc.close();
		this.markClosed();
	}
}

/** Pi's own naming of a cwd's session directory (session-manager.ts getDefaultSessionDirPath). */
export function sessionDirFor(cwd: string) {
	const safe = `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return path.join(config.piSessionsDir, safe);
}

interface ParsedFile {
	mtime: number;
	size: number;
	listing: SessionListing;
	file: string;
}

function firstText(content: unknown): string | undefined {
	const text = typeof content === "string" ? content : contentText(content);
	return text.trim().slice(0, 200) || undefined;
}

/** Turn session-file entries on the active branch into displayable messages. */
function entriesToMessages(entries: RpcRecord[]): AgentMessage[] {
	return displayed(entries).map((d) => d.message);
}

/** Displayable messages of the active branch, each with the file entry it came from. */
function displayed(entries: RpcRecord[]): { entry: RpcRecord; message: AgentMessage }[] {
	const byId = new Map(entries.filter((e) => e.id).map((e) => [e.id, e]));
	const leaf = [...entries].reverse().find((e) => e.id);
	const chain: RpcRecord[] = [];
	for (let e = leaf; e; e = e.parentId ? byId.get(e.parentId) : undefined) {
		chain.push(e);
		if (chain.length > byId.size) break; // corrupt parent cycle
	}
	chain.reverse();
	const ts = (e: RpcRecord) => Date.parse(e.timestamp) || undefined;
	const messages: { entry: RpcRecord; message: AgentMessage }[] = [];
	for (const e of chain) {
		if (e.type === "message" && e.message?.role !== "system") messages.push({ entry: e, message: e.message });
		else if (e.type === "compaction") messages.push({ entry: e, message: { role: "compactionSummary", summary: e.summary, tokensBefore: e.tokensBefore, timestamp: ts(e) } });
		else if (e.type === "branch_summary") messages.push({ entry: e, message: { role: "branchSummary", summary: e.summary, timestamp: ts(e) } });
		else if (e.type === "custom_message" && e.display) messages.push({ entry: e, message: { role: "custom", customType: e.customType, content: e.content, timestamp: ts(e) } });
	}
	return messages;
}

async function readJsonl(file: string): Promise<RpcRecord[]> {
	const text = await fs.readFile(file, "utf8");
	const records: RpcRecord[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			records.push(JSON.parse(line));
		} catch {
			// A torn last line while pi is writing; skip it.
		}
	}
	return records;
}

export class PiRpcAdapter implements HarnessAdapter {
	readonly id = "pi";
	readonly label = "pi";
	readonly description = "pi coding agent over RPC: one pi process per open session, sessions shared with the pi CLI.";
	readonly durable = false;
	private sessions = new Map<string, PiLiveSession>();
	private starting = new Map<string, Promise<PiLiveSession>>();
	private files = new Map<string, ParsedFile>();
	private usageCache = new Map<string, { mtime: number; size: number; records: UsageRecord[] }>();
	private modelCache?: { at: number; models: ModelInfo[] };
	private version?: string;

	async init() {}

	async available() {
		if (this.version) return { ok: true };
		try {
			const probe = new RpcProcess(["--version"], os.tmpdir());
			const code = await new Promise<number | null>((resolve) => (probe.onExit = resolve));
			if (code === 0) {
				this.version = "ok";
				return { ok: true };
			}
			return { ok: false, reason: probe.stderrTail.trim() || `pi --version exited with ${code}` };
		} catch (error) {
			return { ok: false, reason: (error as Error).message };
		}
	}

	async listModels(): Promise<ModelInfo[]> {
		const live = [...this.sessions.values()].find((s) => s.state.live);
		if (live) return live.availableModels();
		if (this.modelCache && Date.now() - this.modelCache.at < 120_000) return this.modelCache.models;
		const probe = new PiLiveSession("probe", os.tmpdir(), new RpcProcess(["--mode", "rpc", "--no-session"], os.tmpdir()));
		try {
			const models = await probe.availableModels();
			this.modelCache = { at: Date.now(), models };
			return models;
		} finally {
			void probe.close();
		}
	}

	private async parseFile(file: string): Promise<ParsedFile | undefined> {
		const stat = await fs.stat(file);
		const cached = this.files.get(file);
		if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached;
		const records = await readJsonl(file);
		const header = records.find((r) => r.type === "session");
		if (!header) return undefined;
		let name: string | undefined;
		let firstMessage: string | undefined;
		let messageCount = 0;
		for (const r of records) {
			if (r.type === "session_info") name = r.name || undefined;
			if (r.type === "message" && (r.message?.role === "user" || r.message?.role === "assistant")) {
				messageCount++;
				if (!firstMessage && r.message.role === "user") firstMessage = firstText(r.message.content);
			}
		}
		const parsed: ParsedFile = {
			mtime: stat.mtimeMs,
			size: stat.size,
			file,
			listing: {
				id: header.id,
				cwd: header.cwd,
				name,
				firstMessage,
				createdAt: header.timestamp,
				updatedAt: new Date(stat.mtimeMs).toISOString(),
				messageCount,
			},
		};
		this.files.set(file, parsed);
		return parsed;
	}

	private async filesFor(cwd: string): Promise<ParsedFile[]> {
		const dir = sessionDirFor(cwd);
		if (!existsSync(dir)) return [];
		const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl"));
		const parsed = await Promise.all(names.map((n) => this.parseFile(path.join(dir, n)).catch(() => undefined)));
		return parsed.filter((p): p is ParsedFile => Boolean(p));
	}

	async listSessions(cwd: string): Promise<SessionListing[]> {
		const listings = (await this.filesFor(cwd)).map((p) => p.listing);
		// Sessions created here exist before pi writes their file (it does so on the first message).
		for (const live of this.sessions.values()) {
			if (live.cwd === cwd && !listings.some((l) => l.id === live.id)) {
				listings.push({ id: live.id, cwd, name: live.state.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: live.state.messages.length });
			}
		}
		return listings;
	}

	private async fileOf(id: string, cwd: string) {
		return (await this.filesFor(cwd)).find((p) => p.listing.id === id)?.file;
	}

	async readSession(id: string, cwd: string) {
		const file = await this.fileOf(id, cwd);
		if (!file) return undefined;
		const records = await readJsonl(file);
		const name = records.filter((r) => r.type === "session_info").at(-1)?.name;
		return { messages: entriesToMessages(records), name };
	}

	/** Rewrite the message's line in pi's session file; pi reads the file again when the session is next opened. */
	async editMessage(id: string, cwd: string, index: number, content: unknown) {
		if (this.live(id)) throw new Error("Stop the session before editing it");
		const file = await this.fileOf(id, cwd);
		if (!file) throw new Error("Session file not found");
		const entry = displayed(await readJsonl(file))[index]?.entry;
		if (entry?.type !== "message") throw new Error("Message not found");
		const lines = (await fs.readFile(file, "utf8")).split("\n").map((line) => {
			if (!line.includes(entry.id)) return line;
			try {
				const record = JSON.parse(line);
				return record.id === entry.id ? JSON.stringify({ ...record, message: { ...record.message, content } }) : line;
			} catch {
				return line;
			}
		});
		const temp = `${file}.${randomUUID()}.tmp`;
		await fs.writeFile(temp, lines.join("\n"));
		await fs.rename(temp, file);
		this.files.delete(file);
	}

	/**
	 * Drop the message's entry from pi's session tree: its children hang on its parent instead, and
	 * references to it (compaction's first kept entry, labels) move to its neighbours.
	 */
	async deleteMessage(id: string, cwd: string, index: number) {
		if (this.live(id)) throw new Error("Stop the session before deleting from it");
		const file = await this.fileOf(id, cwd);
		if (!file) throw new Error("Session file not found");
		const records = await readJsonl(file);
		const entry = displayed(records)[index]?.entry;
		if (entry?.type !== "message") throw new Error("Message not found");
		// Labels on the message go with it; anything hanging on a removed entry moves up to the first kept ancestor.
		const removed = new Map<string, string | null>(records.filter((r) => r.id === entry.id || r.targetId === entry.id).map((r) => [r.id, r.parentId ?? null]));
		const kept = (id: string | null): string | null => (id !== null && removed.has(id) ? kept(removed.get(id)!) : id);
		const child = records.find((r) => !removed.has(r.id) && removed.has(r.parentId))?.id;
		const lines = (await fs.readFile(file, "utf8")).split("\n").flatMap((line) => {
			if (![...removed.keys()].some((id) => line.includes(id))) return [line];
			let record: RpcRecord;
			try {
				record = JSON.parse(line);
			} catch {
				return [line];
			}
			if (removed.has(record.id)) return [];
			if (removed.has(record.parentId)) record.parentId = kept(record.parentId);
			if (record.firstKeptEntryId === entry.id) record.firstKeptEntryId = child ?? kept(entry.id);
			return [JSON.stringify(record)];
		});
		const temp = `${file}.${randomUUID()}.tmp`;
		await fs.writeFile(temp, lines.join("\n"));
		await fs.rename(temp, file);
		this.files.delete(file);
	}

	live(id: string) {
		const session = this.sessions.get(id);
		return session?.state.live ? session : undefined;
	}

	liveSessions() {
		return [...this.sessions.values()].filter((s) => s.state.live);
	}

	private track(session: PiLiveSession) {
		this.sessions.set(session.id, session);
		session.onClosed = () => {
			if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
		};
		this.modelCache = undefined;
		return session;
	}

	open(id: string, cwd: string): Promise<PiLiveSession> {
		const live = this.live(id);
		if (live) return Promise.resolve(live as PiLiveSession);
		const pending = this.starting.get(id);
		if (pending) return pending;
		const start = (async () => {
			const file = await this.fileOf(id, cwd);
			if (!file) throw new Error("Session file not found");
			const records = await readJsonl(file);
			const session = new PiLiveSession(id, cwd, new RpcProcess(["--mode", "rpc", "--session", file], cwd, `pi:${id}`));
			await session.start(entriesToMessages(records));
			return this.track(session);
		})().finally(() => this.starting.delete(id));
		this.starting.set(id, start);
		return start;
	}

	async create(cwd: string, options: CreateOptions) {
		const id = randomUUID();
		const args = ["--mode", "rpc", "--session-id", id];
		if (options.name) args.push("--name", options.name);
		const session = new PiLiveSession(id, cwd, new RpcProcess(args, cwd, `pi:${id}`));
		await session.start([]);
		this.track(session);
		if (options.model) await session.setModel(options.model.provider, options.model.id);
		if (options.thinkingLevel) await session.setThinkingLevel(options.thinkingLevel);
		return session;
	}

	async deleteSession(id: string, cwd: string) {
		await this.sessions.get(id)?.close();
		const file = await this.fileOf(id, cwd);
		if (file) {
			await fs.rm(file, { force: true });
			this.files.delete(file);
		}
		return true;
	}

	async inventory(id: string, cwd: string): Promise<SessionInventory> {
		const file = await this.fileOf(id, cwd);
		const declared = file ? declaredTools(await readJsonl(file).catch(() => [])) : undefined;
		const live = this.sessions.get(id);
		let commands: CommandInfo[] | undefined;
		if (live?.state.live) {
			const data = await live.rpc.send<{ commands: Any[] }>({ type: "get_commands" }, 10_000).catch(() => undefined);
			commands = data?.commands?.map((c) => ({ name: c.name, description: c.description, source: c.source, path: c.sourceInfo?.path }));
		}
		if (declared) return { tools: declared, commands };
		return {
			tools: ["read", "bash", "edit", "write"].map((name) => ({ name, origin: "built-in" })),
			toolsNote: "pi's default tools. The exact list, including extension and MCP tools, is known after the agent's first reply.",
			commands,
		};
	}

	async usage(id: string, cwd: string): Promise<SessionUsage> {
		const live = this.sessions.get(id);
		const file = await this.fileOf(id, cwd);
		const storageBytes = file ? (await fs.stat(file).catch(() => undefined))?.size : undefined;
		// get_session_stats: token totals and cost so far; tolerated if this pi version lacks it.
		const stats = live?.state.live ? await live.rpc.send<Any>({ type: "get_session_stats" }, 3_000).catch(() => undefined) : undefined;
		const tokens = stats?.tokens && typeof stats.tokens === "object" ? stats.tokens : undefined;
		const cost = typeof stats?.cost === "number" ? stats.cost : typeof stats?.cost?.total === "number" ? stats.cost.total : undefined;
		return { pid: live?.rpc.pid, storageBytes, tokens, cost };
	}

	/** Usage of every assistant message in the session file, abandoned branches included: those calls were paid for too. */
	async usageRecords(id: string, cwd: string): Promise<UsageRecord[]> {
		const file = await this.fileOf(id, cwd);
		if (!file) return [];
		const stat = await fs.stat(file);
		const cached = this.usageCache.get(file);
		if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.records;
		const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
		const records: UsageRecord[] = [];
		for (const r of await readJsonl(file)) {
			const m = r.type === "message" ? r.message : undefined;
			if (m?.role !== "assistant" || !m.usage) continue;
			const u = m.usage;
			records.push({
				timestamp: num(m.timestamp) || Date.parse(r.timestamp) || stat.mtimeMs,
				provider: m.provider,
				model: m.responseModel ?? m.model,
				input: num(u.input),
				output: num(u.output),
				cacheRead: num(u.cacheRead),
				cacheWrite: num(u.cacheWrite),
				reasoning: typeof u.reasoning === "number" ? u.reasoning : undefined,
				cost: num(u.cost?.total),
			});
		}
		this.usageCache.set(file, { mtime: stat.mtimeMs, size: stat.size, records });
		return records;
	}

	async shutdown() {
		await Promise.all([...this.sessions.values()].map((s) => s.close()));
	}
}
