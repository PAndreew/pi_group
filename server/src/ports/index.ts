/*
 * Ports: what the app needs from the place it runs. The self-hosted server plugs in the Node
 * adapters (ports/node.ts); a cloud deployment plugs in its own (Durable Objects, R2, containers…)
 * without touching the code that uses them. See docs/architecture.md.
 */

import { nodePlatform } from "./node.js";

/** Named JSON documents, saved atomically (the app state in db.json, push keys…). */
export interface DocumentStore {
	load(name: string): unknown;
	save(name: string, doc: unknown): void;
}

export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, unknown>;

export interface SqlStatement {
	run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
	get(...params: SqlValue[]): SqlRow | undefined;
	all(...params: SqlValue[]): SqlRow[];
}

/** A synchronous SQLite database, as node:sqlite and Durable Object storage both offer. */
export interface SqlDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqlStatement;
	close(): void;
}

export interface WorkspaceEntry {
	name: string;
	/** Relative to the workspace root, slash-separated. */
	path: string;
	type: "file" | "dir";
	symlink: boolean;
	size: number;
	mtime: number;
	broken?: boolean;
}

/** The shared files people browse and agents work in. Paths are relative to the (tenant's) root and never leave it. */
export interface WorkspaceStorage {
	list(dir: string): Promise<{ path: string; entries: WorkspaceEntry[] }>;
	stat(file: string): Promise<{ path: string; size: number; mtime: number; type: "file" | "dir" }>;
	/** Write a text file atomically; with `expectMtime`, refuse (409) when it changed since it was read. */
	writeText(file: string, content: string, expectMtime?: number): Promise<{ path: string; size: number; mtime: number }>;
	mkdir(dir: string): Promise<string>;
	/** The file on a local disk, for streaming and uploads; only filesystem-backed storage has one. */
	localPath?(file: string): string;
}

/** Fan-out of live events to whoever watches a topic (a session's viewers, a user's devices). */
export interface Realtime {
	publish(topic: string, event: unknown): void;
	subscribe(topic: string, sink: (event: unknown) => void): () => void;
	subscribers(topic: string): number;
}

export interface SpawnOptions {
	cwd: string;
	env?: Record<string, string | undefined>;
	/** Run `command` through the shell. */
	shell?: boolean;
	/** Own process group, so kill("tree") also stops everything it started. */
	group?: boolean;
}

export interface SandboxProcess {
	readonly pid?: number;
	write(data: string): void;
	end(data?: string): void;
	/** "tree" stops the process and its descendants. */
	kill(signal?: NodeJS.Signals | "tree"): void;
	onStdout(listener: (chunk: Buffer) => void): void;
	onStderr(listener: (chunk: Buffer) => void): void;
	/** The process ended; output may still be arriving. */
	onExit(listener: (code: number | null) => void): void;
	/** The process ended and its output was read to the end. */
	onClose(listener: (code: number | null) => void): void;
	/** It could not be started or signalled. */
	onError(listener: (error: Error) => void): void;
}

/** Where agents and scripts run their processes. */
export interface Sandbox {
	spawn(command: string, args: string[], options: SpawnOptions): SandboxProcess;
}

export interface Scheduler {
	/** Run `task` every `ms`, first after `firstAfterMs` (default `ms`); returns a stop function. Never keeps the process alive. */
	every(ms: number, task: () => void, firstAfterMs?: number): () => void;
}

export interface SecretInfo {
	key: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

/** Key/value secrets per namespace (tenant.user); values only leave through `get`. */
export interface Secrets {
	configured(): boolean;
	reachable(): Promise<boolean>;
	list(namespace: string): Promise<SecretInfo[]>;
	get(namespace: string, key: string): Promise<SecretInfo & { value: string }>;
	put(namespace: string, key: string, body: { value?: string; description: string }): Promise<SecretInfo>;
	delete(namespace: string, key: string): Promise<void>;
}

/** Optional model capabilities; every one may be off, and the app then behaves as without it. */
export type Capability = "triage" | "extract" | "stt" | "tts" | "embed";

export interface CapabilityInfo {
	provider: "none" | "local" | "api";
	model?: string;
}

/** Clef: sort an incoming item into one of `labels`, with confidences. */
export interface Triage {
	classify(item: { kind: string; text: string }, labels: string[]): Promise<{ label: string; confidence: number }[]>;
}

/** Clairic: metadata of a text or image item. */
export interface Extract {
	extract(item: { kind: string; text?: string; image?: { data: Uint8Array; mimeType: string } }): Promise<{ title?: string; summary?: string; tags?: string[]; entities?: string[] }>;
}

export interface SpeechToText {
	transcribe(audio: { data: Uint8Array; mimeType: string }): Promise<{ text: string; language?: string }>;
}

export interface TextToSpeech {
	speak(text: string, options?: { voice?: string }): Promise<{ data: Uint8Array; mimeType: string }>;
}

export interface Embed {
	embed(texts: string[]): Promise<number[][]>;
}

export interface Models {
	info(): Record<Capability, CapabilityInfo>;
	triage?: Triage;
	extract?: Extract;
	stt?: SpeechToText;
	tts?: TextToSpeech;
	embed?: Embed;
}

export interface Platform {
	documents: DocumentStore;
	/** Open (creating if needed) a named SQLite database. */
	openSql(name: string): SqlDatabase;
	/** Whether a named database was created already, to avoid creating one just to find it empty. */
	sqlExists(name: string): boolean;
	storage: WorkspaceStorage;
	realtime: Realtime;
	sandbox: Sandbox;
	scheduler: Scheduler;
	secrets: Secrets;
	models: Models;
}

let current: Platform | undefined;

/** The adapters in use: the Node ones unless a deployment set its own first. */
export function platform(): Platform {
	return (current ??= nodePlatform());
}

export function setPlatform(next: Platform) {
	current = next;
}
