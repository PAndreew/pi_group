/**
 * Harness abstraction. A harness is an agent runtime (pi over RPC, pi-durable, later ACP agents, ...).
 * Every adapter normalizes to pi-style messages (user / assistant / toolResult / ...), which are close
 * to what ACP and most agent protocols carry, so the web UI renders all harnesses the same way.
 */

/** A pi `AgentMessage`; kept loose because harnesses may add roles. */
export type AgentMessage = { role: string; timestamp?: number; [key: string]: unknown };

export interface ModelInfo {
	provider: string;
	id: string;
	name: string;
	reasoning?: boolean;
	contextWindow?: number;
	input?: string[];
}

export interface SessionListing {
	id: string;
	cwd: string;
	name?: string;
	firstMessage?: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

export interface ExtensionDialog {
	id: string;
	method: "select" | "confirm" | "input" | "editor";
	title?: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
}

export interface SessionState {
	/** Completed messages of the active branch, oldest first. */
	messages: AgentMessage[];
	/** The assistant message being streamed, if any. */
	partial: AgentMessage | null;
	/** Live output of running tool calls, by tool call ID. */
	toolOutputs: Record<string, string>;
	runningTools: string[];
	running: boolean;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	queue: { steering: string[]; followUp: string[] };
	/** Last error worth showing (provider error, retry notice, crashed process). */
	notice?: { level: "info" | "warn" | "error"; text: string };
	dialogs: ExtensionDialog[];
	name?: string;
	live: boolean;
}

export type SessionEvent =
	| { type: "state"; state: SessionState }
	| { type: "message"; message: AgentMessage }
	| { type: "partial"; partial: AgentMessage | null }
	| { type: "tool_output"; toolCallId: string; output: string }
	| { type: "status"; status: Omit<SessionState, "messages" | "partial" | "toolOutputs"> }
	| { type: "notify"; level: "info" | "warn" | "error"; text: string };

export type PromptMode = "steer" | "followUp";

export interface PromptInput {
	text: string;
	images?: { data: string; mimeType: string }[];
	/** Required when the agent is running: steer the current run, or queue a follow-up. */
	mode?: PromptMode;
}

export interface LiveSession {
	readonly id: string;
	readonly cwd: string;
	readonly state: SessionState;
	/** Number of attached viewers; idle sessions without viewers can be reaped. */
	readonly viewers: number;
	readonly lastActivity: number;
	subscribe(listener: (event: SessionEvent) => void): () => void;
	prompt(input: PromptInput): Promise<void>;
	abort(): Promise<void>;
	setModel(provider: string, modelId: string): Promise<void>;
	setThinkingLevel(level: string): Promise<void>;
	setName(name: string): Promise<void>;
	answerDialog(id: string, answer: { value?: string; confirmed?: boolean; cancelled?: boolean }): void;
	close(): Promise<void>;
}

export interface CreateOptions {
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	name?: string;
}

export interface HarnessAdapter {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	/** Whether runs survive restarts of the web app. */
	readonly durable: boolean;
	init(): Promise<void>;
	available(): Promise<{ ok: boolean; reason?: string }>;
	listModels(): Promise<ModelInfo[]>;
	listSessions(cwd: string): Promise<SessionListing[]>;
	/** Messages of a session that is not live, without starting anything. */
	readSession(id: string, cwd: string): Promise<{ messages: AgentMessage[]; name?: string } | undefined>;
	live(id: string): LiveSession | undefined;
	liveSessions(): LiveSession[];
	/** Attach to a session, starting its runtime if needed. */
	open(id: string, cwd: string): Promise<LiveSession>;
	create(cwd: string, options: CreateOptions): Promise<LiveSession>;
	shutdown(): Promise<void>;
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
