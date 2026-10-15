import type { AgentMessage, LiveSession, PromptInput, SessionEvent, SessionState } from "./types.js";

/** Shared state keeping and fan-out for live sessions. Adapters mutate state through the helpers. */
export abstract class LiveSessionBase implements LiveSession {
	readonly state: SessionState = {
		messages: [],
		partial: null,
		toolOutputs: {},
		runningTools: [],
		running: false,
		queue: { steering: [], followUp: [] },
		dialogs: [],
		live: true,
	};
	lastActivity = Date.now();
	private listeners = new Set<(event: SessionEvent) => void>();
	private partialTimer: NodeJS.Timeout | undefined;
	private outputTimers = new Map<string, NodeJS.Timeout>();
	/** Called when the session ends so the adapter can forget it. */
	onClosed?: () => void;

	constructor(
		readonly id: string,
		readonly cwd: string,
	) {}

	get viewers() {
		return this.listeners.size;
	}

	subscribe(listener: (event: SessionEvent) => void) {
		this.listeners.add(listener);
		listener({ type: "state", state: this.state });
		return () => {
			this.listeners.delete(listener);
			this.touch();
		};
	}

	protected touch() {
		this.lastActivity = Date.now();
	}

	protected emit(event: SessionEvent) {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A broken viewer must not affect the session.
			}
		}
	}

	protected emitState() {
		this.emit({ type: "state", state: this.state });
	}

	protected emitStatus() {
		const { messages: _m, partial: _p, toolOutputs: _t, ...status } = this.state;
		this.emit({ type: "status", status });
	}

	protected pushMessage(message: AgentMessage) {
		this.touch();
		if (message.role === "system") return;
		if (message.role === "toolResult") {
			const id = message.toolCallId as string;
			if (this.state.messages.some((m) => m.role === "toolResult" && m.toolCallId === id)) return;
		}
		this.state.messages.push(message);
		this.emit({ type: "message", message });
	}

	/** Streaming deltas arrive fast; viewers get the partial at most every 120 ms. */
	protected partialChanged(immediate = false) {
		this.touch();
		if (immediate) {
			if (this.partialTimer) clearTimeout(this.partialTimer);
			this.partialTimer = undefined;
			this.emit({ type: "partial", partial: this.state.partial });
			return;
		}
		this.partialTimer ??= setTimeout(() => {
			this.partialTimer = undefined;
			this.emit({ type: "partial", partial: this.state.partial });
		}, 120);
	}

	protected toolOutputChanged(toolCallId: string) {
		this.touch();
		if (this.outputTimers.has(toolCallId)) return;
		this.outputTimers.set(
			toolCallId,
			setTimeout(() => {
				this.outputTimers.delete(toolCallId);
				const output = this.state.toolOutputs[toolCallId];
				if (output !== undefined) this.emit({ type: "tool_output", toolCallId, output });
			}, 150),
		);
	}

	protected notice(level: "info" | "warn" | "error", text: string) {
		this.state.notice = { level, text };
		this.emit({ type: "notify", level, text });
		this.emitStatus();
	}

	protected markClosed() {
		if (!this.state.live) return;
		this.state.live = false;
		this.state.running = false;
		this.state.runningTools = [];
		this.state.partial = null;
		this.state.dialogs = [];
		this.emitState();
		this.onClosed?.();
	}

	abstract prompt(input: PromptInput): Promise<void>;
	abstract abort(): Promise<void>;
	abstract setModel(provider: string, modelId: string): Promise<void>;
	abstract setThinkingLevel(level: string): Promise<void>;
	abstract setName(name: string): Promise<void>;
	abstract answerDialog(id: string, answer: { value?: string; confirmed?: boolean; cancelled?: boolean }): void;
	abstract close(): Promise<void>;
}

/** Apply one streamed content-block change to an assistant message in place. */
export function applyAssistantDelta(message: AgentMessage, event: Record<string, unknown>) {
	const content = (message.content ??= []) as Record<string, unknown>[];
	const index = event.contentIndex as number;
	switch (event.type) {
		case "text_start":
			content[index] = { type: "text", text: "" };
			break;
		case "text_delta":
			if (content[index]) content[index].text = `${content[index].text ?? ""}${event.delta}`;
			else content[index] = { type: "text", text: event.delta };
			break;
		case "text_end":
			content[index] = { ...(content[index] ?? {}), type: "text", text: event.content };
			break;
		case "thinking_start":
			content[index] = { type: "thinking", thinking: "" };
			break;
		case "thinking_delta":
			if (content[index]) content[index].thinking = `${content[index].thinking ?? ""}${event.delta}`;
			else content[index] = { type: "thinking", thinking: event.delta };
			break;
		case "thinking_end":
			content[index] = { ...(content[index] ?? {}), type: "thinking", thinking: event.content };
			break;
		case "toolcall_start":
			content[index] = { type: "toolCall", id: event.id, name: event.toolName, arguments: {}, partialArgs: "" };
			break;
		case "toolcall_delta":
			if (content[index]) content[index].partialArgs = `${content[index].partialArgs ?? ""}${event.delta}`;
			break;
		case "toolcall_end":
			content[index] = event.toolCall as Record<string, unknown>;
			break;
	}
}

/** Text of a tool result-ish content array. */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? String((c as { text?: string }).text ?? "") : ""))
		.join("");
}
