export interface ContextPolicy {
	/** Hours after a turn ends before its reasoning and tool output are trimmed; 0 = never. */
	trimHours: number;
	/** Hours of history shown when an epoch starts; older turns are reachable through session_history. 0 = all. */
	windowHours: number;
}
export interface ContextCutoffs {
	trimBefore: number;
	hideBefore: number;
}
type Message = { role: string; timestamp?: number | string; [key: string]: unknown };

export const CONTEXT_DEFAULTS: ContextPolicy;
export const EPOCH_IDLE_MS: number;
export function wrapProjectMemory(memory: string): string;
export function stripProjectMemory(text: string): string;
export function lastMemoryAt(messages: readonly Message[]): number | undefined;
export function cutoffsOf(policy: ContextPolicy, now: number): ContextCutoffs;
export function epochTracker(load: (key: string) => Promise<ContextPolicy> | ContextPolicy): (key: string, now?: number) => Promise<ContextCutoffs>;
export function applyContextPolicy<M extends Message>(messages: readonly M[], cutoffs: ContextCutoffs): M[];
export function historyPage(messages: readonly Message[], params?: { query?: string; from?: number; date?: string }): string;
export const HISTORY_TOOL: { name: string; label: string; description: string; parameters: Record<string, unknown> };
