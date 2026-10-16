import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { save, store } from "../store.js";
import { LiveSessionBase } from "./live-base.js";
import type { AgentMessage, CreateOptions, HarnessAdapter, ModelInfo, PromptInput, SessionListing } from "./types.js";

/*
 * pi-durable is experimental and its API changes between releases, so it is loaded dynamically and typed
 * loosely: if it is missing or incompatible, this adapter reports itself unavailable and pi over RPC keeps working.
 */
type Any = any;

interface Modules {
	durable: Any;
	sqlite: Any;
	envNode: Any;
	tools: Any;
	ctx: Any;
	providers: Any;
}

const PREAMBLE = [
	"You are an expert coding agent running on the user's machine through a shared web interface.",
	"Use the read, write, edit and bash tools to inspect and change files in the working directory.",
	"Be concise, explain what you change, and prefer small, verifiable steps.",
].join("\n");

/** Credentials shared with the pi CLI: ~/.pi/agent/auth.json, one type-tagged credential per provider. */
class PiAuthFileStore {
	private file = path.join(config.piAgentDir, "auth.json");
	private chain: Promise<unknown> = Promise.resolve();

	private readAll(): Record<string, Any> {
		try {
			return JSON.parse(readFileSync(this.file, "utf8"));
		} catch {
			return {};
		}
	}

	private writeAll(all: Record<string, Any>) {
		mkdirSync(path.dirname(this.file), { recursive: true });
		const tmp = `${this.file}.pi-group.tmp`;
		writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
		renameSync(tmp, this.file);
	}

	async read(providerId: string) {
		return this.readAll()[providerId];
	}

	async list() {
		return Object.entries(this.readAll()).map(([providerId, c]) => ({ providerId, type: c?.type }));
	}

	modify(providerId: string, fn: (current: Any) => Promise<Any>) {
		const run = this.chain.then(async () => {
			const all = this.readAll();
			const next = await fn(all[providerId]);
			if (next === undefined) delete all[providerId];
			else all[providerId] = next;
			this.writeAll(all);
			return next;
		});
		this.chain = run.catch(() => {});
		return run;
	}

	async delete(providerId: string) {
		await this.modify(providerId, async () => undefined);
	}
}

/** Displayable messages of durable transcript entries. */
function entryMessages(entry: Any): AgentMessage[] {
	if (entry.kind === "pi.compaction") {
		return [{ role: "compactionSummary", summary: entry.data?.summary ?? "", timestamp: Date.now() }];
	}
	return ((entry.model ?? []) as AgentMessage[]).filter((m) => m.role !== "system");
}

class DurableLiveSession extends LiveSessionBase {
	private stream: Any;
	private seen = new Set<string>();

	constructor(
		id: string,
		cwd: string,
		private conversation: Any,
		private harness: Any,
		private m: Modules,
	) {
		super(id, cwd);
	}

	private get ctx() {
		return this.m.ctx.BACKGROUND_CONTEXT;
	}

	async start() {
		this.stream = await this.m.durable.watchEvents(this.harness, this.conversation.id, this.ctx);
		this.applySnapshot(this.stream.snapshot);
		this.stream.start(async (events: Any[]) => {
			for (const event of events) this.handle(event);
		});
		this.stream.closed.then(() => this.markClosed());
	}

	private applySnapshot(snapshot: Any) {
		this.seen.clear();
		const messages: AgentMessage[] = [];
		for (const entry of snapshot.entries ?? []) {
			this.seen.add(String(entry.id));
			messages.push(...entryMessages(entry));
		}
		this.state.messages = messages;
		this.state.partial = snapshot.generation?.message ? structuredClone(snapshot.generation.message) : null;
		this.state.running = Boolean(snapshot.run);
		this.state.runningTools = (snapshot.tools ?? []).map((t: Any) => t.toolCallId ?? t.callId).filter(Boolean);
		this.applyInbox(snapshot.inbox ?? []);
		this.applyAgent(snapshot.agent ?? {});
		this.emitState();
	}

	private applyAgent(agent: Any) {
		if (agent.model) this.state.model = { provider: agent.model.provider, id: agent.model.modelId };
		if (agent.thinkingLevel) this.state.thinkingLevel = agent.thinkingLevel;
	}

	private applyInbox(items: Any[]) {
		this.state.queue = {
			steering: items.filter((i) => i.mode === "steer").map(() => "(queued steer)"),
			followUp: items.filter((i) => i.mode !== "steer").map(() => "(queued follow-up)"),
		};
	}

	private addEntry(entry: Any) {
		const id = String(entry.id);
		if (this.seen.has(id)) return;
		this.seen.add(id);
		const messages = entryMessages(entry);
		if (messages.some((m) => m.role === "assistant")) {
			this.state.partial = null;
			this.partialChanged(true);
		}
		for (const message of messages) {
			this.pushMessage(message);
			if (message.role === "assistant" && message.stopReason === "error" && message.errorMessage) this.notice("error", String(message.errorMessage));
		}
	}

	private handle(event: Any) {
		switch (event.type) {
			case "snapshot":
				this.applySnapshot(event);
				break;
			case "run_start":
				this.state.running = true;
				this.state.notice = undefined;
				this.emitStatus();
				break;
			case "run_end":
				this.state.running = false;
				this.state.partial = null;
				this.state.runningTools = [];
				this.partialChanged(true);
				this.emitStatus();
				break;
			case "message_start":
				if (event.message?.role === "assistant") {
					this.state.partial = structuredClone(event.message);
					this.partialChanged(true);
				}
				break;
			case "message_update": {
				const partial = (this.state.partial ??= { role: "assistant", content: [], timestamp: Date.now() });
				const content = ((partial.content as Any[]) ??= []);
				for (const change of event.changes ?? []) {
					if (change.type === "message") this.state.partial = structuredClone(change.message);
					else if (change.type === "block" || change.type.endsWith("_start")) content[change.contentIndex] = structuredClone(change.block);
					else if (change.type === "text_delta" && content[change.contentIndex]) content[change.contentIndex].text += change.delta;
					else if (change.type === "thinking_delta" && content[change.contentIndex]) content[change.contentIndex].thinking += change.delta;
				}
				if (event.usage && this.state.partial) this.state.partial.usage = event.usage;
				this.partialChanged();
				break;
			}
			case "message_end":
			case "entry_appended":
				if (event.entry) this.addEntry(event.entry);
				break;
			case "tool_execution_start":
				this.state.runningTools = [...new Set([...this.state.runningTools, event.toolCallId])];
				this.state.toolOutputs[event.toolCallId] = "";
				this.emitStatus();
				break;
			case "tool_execution_update": {
				const out = event.output;
				if (!out) break;
				let text = this.state.toolOutputs[event.toolCallId] ?? "";
				if ("set" in out) text = out.set;
				else text = text.slice(out.trimStart ?? 0) + (out.append ?? "");
				this.state.toolOutputs[event.toolCallId] = text;
				this.toolOutputChanged(event.toolCallId);
				break;
			}
			case "tool_execution_end":
				this.state.runningTools = this.state.runningTools.filter((id) => id !== event.toolCallId);
				delete this.state.toolOutputs[event.toolCallId];
				if (event.entry) this.addEntry(event.entry);
				this.emitStatus();
				break;
			case "inbox_update":
				this.applyInbox(event.items ?? []);
				this.emitStatus();
				break;
			case "agent_changed":
				this.applyAgent(event.agent ?? {});
				this.emitStatus();
				break;
			case "auto_retry_start":
				this.notice("warn", `Retrying (attempt ${event.attempt}): ${event.errorMessage}`);
				break;
			case "task_failed":
				this.notice("error", `${event.kind} failed: ${event.message}`);
				break;
			case "compaction_start":
				this.notice("info", `Compacting context (${event.reason})…`);
				break;
			case "compaction_end":
				if (event.error) this.notice("warn", `Compaction failed: ${event.error}`);
				break;
		}
	}

	async prompt(input: PromptInput) {
		this.touch();
		if (!this.state.model) throw new Error("Pick a model first");
		const content = input.images?.length
			? [{ type: "text", text: input.text }, ...input.images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }))]
			: input.text;
		await this.conversation.submit({ type: "input", content, whenBusy: input.mode ?? "followUp" }, this.ctx);
	}

	async abort() {
		await this.conversation.abort(this.ctx);
	}

	async setModel(provider: string, modelId: string) {
		await this.conversation.configure({ model: { provider, modelId } }, this.ctx);
		this.state.model = { provider, id: modelId };
		this.emitStatus();
	}

	async setThinkingLevel(level: string) {
		await this.conversation.configure({ thinkingLevel: level }, this.ctx);
		this.state.thinkingLevel = level;
		this.emitStatus();
	}

	async setName(name: string) {
		this.state.name = name;
		this.emitStatus();
	}

	answerDialog() {}

	/** Stops watching only; the durable run itself keeps going in the harness. */
	async close() {
		await this.stream?.stop();
		this.markClosed();
	}
}

export class PiDurableAdapter implements HarnessAdapter {
	readonly id = "pi-durable";
	readonly label = "pi durable";
	readonly description = "pi-durable harness in the web app process: every turn is committed to SQLite, runs resume after a restart.";
	readonly durable = true;
	private m?: Modules;
	private loadError?: string = "Still loading…";
	private models?: Any;
	private registry?: Any;
	private harnesses = new Map<string, Promise<Any>>();
	private sessions = new Map<string, DurableLiveSession>();
	private starting = new Map<string, Promise<DurableLiveSession>>();

	async init() {
		if (!config.enableDurable) {
			this.loadError = "Disabled with ENABLE_DURABLE=false";
			return;
		}
		try {
			this.m = {
				durable: await import("@earendil-works/pi-durable" as string),
				sqlite: await import("@earendil-works/pi-durable/storage/sqlite/node" as string),
				envNode: await import("@earendil-works/pi-durable/env/node" as string),
				tools: await import("@earendil-works/pi-durable/tools" as string),
				ctx: await import("@earendil-works/chord/context" as string),
				providers: await import("@earendil-works/pi-ai/providers/all" as string),
			};
			this.loadError = undefined;
			const { durable, tools, providers } = this.m;
			this.models = providers.builtinModels({ credentials: new PiAuthFileStore() });
			if (process.env.PI_GROUP_DEMO_MODEL === "1") await this.installDemoModel();
			this.registry = durable.createRegistry();
			this.registry.install(tools.CodingTools);
			this.registry.install(
				durable.defineExtension({
					name: "pi-group",
					sections: [
						durable.section("preamble", () => PREAMBLE, { tag: false }),
						durable.section("cwd", (input: Any) => input.agent?.cwd),
					],
				}),
			);
		} catch (error) {
			this.m = undefined;
			this.loadError = `pi-durable could not be loaded: ${(error as Error).message}`;
			console.warn(this.loadError);
			return;
		}
		// Reopen every known storage so runs interrupted by a restart continue now.
		for (const folder of store.data.durableFolders) {
			if (!existsSync(folder)) continue;
			this.harnessFor(folder, false)
				.then((harness) => this.attachBusy(harness, folder))
				.catch((error) => console.warn(`pi-durable: could not reopen ${folder}: ${error.message}`));
		}
	}

	private get ctx() {
		return this.m!.ctx.BACKGROUND_CONTEXT;
	}

	/**
	 * Offline model for trying the UI without API keys: it thinks, lists the folder with bash,
	 * then answers. Enabled with PI_GROUP_DEMO_MODEL=1.
	 */
	private async installDemoModel() {
		const faux: Any = await import("@earendil-works/pi-ai/providers/faux" as string);
		const handle = faux.fauxProvider({
			provider: "demo",
			models: [{ id: "demo-agent", name: "Demo agent (offline)", reasoning: true }],
			tokensPerSecond: 60,
		});
		const respond = (context: Any) => {
			const last = context.messages?.at(-1);
			if (last?.role === "toolResult") {
				const output = (last.content ?? []).map((c: Any) => c.text ?? "").join("").trim();
				return faux.fauxAssistantMessage(
					[
						faux.fauxThinking("The listing came back; summarizing it for the user."),
						faux.fauxText(`Here is what I found in the folder:\n\n\`\`\`\n${output.slice(0, 1500)}\n\`\`\`\n\nThis is the **offline demo model**; configure a real provider in pi to do actual work.`),
					],
					{ stopReason: "stop" },
				);
			}
			return faux.fauxAssistantMessage(
				[faux.fauxThinking("Let me look at the working directory first."), faux.fauxToolCall("bash", { command: "ls -la" })],
				{ stopReason: "toolUse" },
			);
		};
		handle.setResponses(Array.from({ length: 10_000 }, () => respond));
		this.models.setProvider(handle.provider);
	}

	async available() {
		return this.m ? { ok: true } : { ok: false, reason: this.loadError };
	}

	async listModels(): Promise<ModelInfo[]> {
		if (!this.models) return [];
		const models = await this.models.getAvailable();
		return (models as Any[]).map((m) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id, reasoning: m.reasoning, contextWindow: m.contextWindow, input: m.input }));
	}

	private storagePath(folder: string) {
		const hash = createHash("sha256").update(folder).digest("hex").slice(0, 16);
		return path.join(config.dataDir, "durable", `${path.basename(folder) || "root"}-${hash}.sqlite`);
	}

	/** One Harness (one SQLite file) per folder; its conversations are that folder's sessions. */
	private harnessFor(folder: string, create: boolean): Promise<Any> {
		const existing = this.harnesses.get(folder);
		if (existing) return existing;
		const file = this.storagePath(folder);
		if (!create && !existsSync(file)) return Promise.resolve(undefined);
		const opening = (async () => {
			const { durable, sqlite, envNode } = this.m!;
			mkdirSync(path.dirname(file), { recursive: true });
			const storage = await sqlite.openNodeSqliteStorage(file);
			const harness = await durable.Harness.open(
				storage,
				{
					models: this.models,
					registry: this.registry,
					env: ({ cwd }: Any) => new envNode.NodeExecutionEnv({ cwd: cwd ?? folder }),
					onReport: (error: unknown) => console.warn("pi-durable:", error),
				},
				this.ctx,
			);
			harness.resume();
			harness.closed.then(() => this.harnesses.delete(folder));
			if (!store.data.durableFolders.includes(folder)) {
				store.data.durableFolders.push(folder);
				save();
			}
			return harness;
		})();
		this.harnesses.set(folder, opening);
		opening.catch(() => this.harnesses.delete(folder));
		return opening;
	}

	/** Watch conversations that still have unsettled work, so they show as running. */
	private async attachBusy(harness: Any, folder: string) {
		if (!harness) return;
		const inspection = await harness.inspect(this.ctx);
		const ids = new Set<string>((inspection.submissions ?? []).map((s: Any) => s.conversationId).filter(Boolean));
		for (const id of ids) await this.open(String(id), folder).catch(() => {});
	}

	async listSessions(cwd: string): Promise<SessionListing[]> {
		if (!this.m) return [];
		const harness = await this.harnessFor(cwd, false);
		if (!harness) return [];
		const page = await harness.commit((tx: Any) => tx.scanConversations({ order: "descending" }, 500), this.ctx);
		return (page.items as Any[])
			.filter((c) => !c.owner)
			.map((c) => {
				const id = String(c.id);
				const meta = store.session(`${this.id}:${id}`);
				const now = new Date().toISOString();
				return {
					id,
					cwd,
					name: meta?.name,
					firstMessage: meta?.firstMessage,
					createdAt: meta?.createdAt ?? now,
					updatedAt: meta?.updatedAt ?? meta?.createdAt ?? now,
					messageCount: this.sessions.get(id)?.state.messages.length ?? 0,
				};
			});
	}

	async readSession(id: string, cwd: string) {
		if (!this.m) return undefined;
		const harness = await this.harnessFor(cwd, false);
		const conversation = harness && (await harness.conversation(Number(id), this.ctx));
		if (!conversation) return undefined;
		const messages: AgentMessage[] = [];
		let cursor: Any;
		do {
			const page = await conversation.entries({ order: "ascending" }, 500, cursor, this.ctx);
			for (const entry of page.items) messages.push(...entryMessages(entry));
			cursor = page.next;
		} while (cursor);
		return { messages };
	}

	live(id: string) {
		const session = this.sessions.get(id);
		return session?.state.live ? session : undefined;
	}

	liveSessions() {
		return [...this.sessions.values()].filter((s) => s.state.live);
	}

	open(id: string, cwd: string): Promise<DurableLiveSession> {
		if (!this.m) return Promise.reject(new Error(this.loadError));
		const live = this.live(id);
		if (live) return Promise.resolve(live);
		const pending = this.starting.get(id);
		if (pending) return pending;
		const start = (async () => {
			const harness = await this.harnessFor(cwd, false);
			const conversation = harness && (await harness.conversation(Number(id), this.ctx));
			if (!conversation) throw new Error("Conversation not found");
			const session = new DurableLiveSession(id, cwd, conversation, harness, this.m!);
			await session.start();
			this.sessions.set(id, session);
			session.onClosed = () => {
				if (this.sessions.get(id) === session) this.sessions.delete(id);
			};
			return session;
		})().finally(() => this.starting.delete(id));
		this.starting.set(id, start);
		return start;
	}

	async create(cwd: string, options: CreateOptions) {
		if (!this.m) throw new Error(this.loadError);
		const harness = await this.harnessFor(cwd, true);
		const agent: Any = { cwd };
		if (options.model) agent.model = { provider: options.model.provider, modelId: options.model.id };
		if (options.thinkingLevel) agent.thinkingLevel = options.thinkingLevel;
		const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, this.ctx);
		const session = await this.open(String(conversation.id), cwd);
		if (options.name) await session.setName(options.name);
		return session;
	}

	/** pi-durable has no way to erase a conversation: stop its run and let the app hide it. */
	async deleteSession(id: string, cwd: string) {
		const session = await this.open(id, cwd).catch(() => undefined);
		if (session?.state.running) await session.abort();
		await session?.close();
		return false;
	}

	async shutdown() {
		for (const session of this.sessions.values()) await session.close().catch(() => {});
		for (const harness of this.harnesses.values()) await (await harness.catch(() => undefined))?.close(this.ctx).catch(() => {});
	}
}
