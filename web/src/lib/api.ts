export type Role = "admin" | "member"
export type Access = "read" | "write"
export type EffectiveAccess = "admin" | "owner" | Access

export interface SessionDefaults {
  harness: string
  model: { provider: string; id: string }
  thinkingLevel: string
}

export interface AssistanceSettings {
  injectionChecks: boolean
  contextExtraction: boolean
  toolSelection: boolean
  dailyBudgetUsd: number
  maxCallsPerRun: number
}
export interface AssistanceStatus {
  configured: boolean
  credentialSource?: "environment" | "vault" | "none"
  vaultKey?: string
  supportedHarnesses: string[]
  settings: AssistanceSettings
  meter?: { day: string; cost: number; calls: number }
  records: { runId: string; sessionKey: string; model: string; purpose: string; timestamp: string; inputTokens?: number; cost: number; latencyMs: number; status: string }[]
}

export interface User {
  id: string
  username: string
  role: Role
  createdAt: string
  sessionDefaults?: SessionDefaults
  assistance?: AssistanceSettings
}

export interface Harness {
  id: string
  label: string
  description: string
  durable: boolean
  ok: boolean
  reason?: string
}

export interface ModelInfo {
  provider: string
  id: string
  name: string
  thinkingLevels?: string[];
  reasoning?: boolean
  contextWindow?: number
  input?: string[]
}

export interface FsEntry {
  name: string
  path: string
  type: "dir" | "file"
  symlink: boolean
  size: number
  mtime: number
  broken?: boolean
}

export interface SessionSummary {
  key: string
  harness: string
  id: string
  path: string
  name?: string
  firstMessage?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  live: boolean
  running: boolean
  pinned: boolean
  owner?: string
  visibility: "private" | "shared"
  shares: { userId: string; username: string; access: Access }[]
  access?: EffectiveAccess
}

/** A pi AgentMessage; loose on purpose, harnesses may add roles. */
export type AgentMessage = { role: string; timestamp?: number; author?: { id: string; username: string }; [key: string]: any }

export interface ExtensionDialog {
  id: string
  method: "select" | "confirm" | "input" | "editor"
  title?: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
}

export interface SessionState {
  messages: AgentMessage[]
  partial: AgentMessage | null
  toolOutputs: Record<string, string>
  runningTools: string[]
  running: boolean
  model?: { provider: string; id: string }
  thinkingLevel?: string
  queue: { steering: string[]; followUp: string[] }
  notice?: { level: "info" | "warn" | "error"; text: string }
  dialogs: ExtensionDialog[]
  name?: string
  live: boolean
  /** Prompts that will be deleted once the current run ends. */
  pendingDeletes?: { timestamp?: number; text: string }[]
}

export interface VaultSecret {
  key: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface Interaction {
  id: string
  sessionKey: string
  toolCallId: string
  createdAt: string
  spec: { version: 1; type: "single_choice" | "multi_choice"; title: string; description?: string; options: { id: string; label: string; description?: string }[]; submitLabel?: string }
  status: "pending" | "answered" | "cancelled" | "expired"
  selected?: string[]
  respondent?: { id: string; username: string }
}

export interface SessionTools {
  tools: { name: string; description?: string; origin?: string }[]
  toolsNote?: string
  /** Extension commands, prompt templates and skills; absent unless the session is running. */
  commands?: { name: string; description?: string; source: string; path?: string }[]
  resources: { kind: "package" | "extension" | "skill" | "prompt"; name: string; scope: "user" | "project"; path?: string; description?: string }[]
}

export interface McpServer {
  name: string
  scope?: string
  transport?: string
  enabled: boolean
  state?: string
  tools?: string[]
  error?: string
  target?: string
}

export interface MonitorSession {
  key: string
  name: string
  harness: string
  path: string
  running: boolean
  viewers: number
  lastActivity: string
  messages: number
  model?: string
  pinned: boolean
  pid?: number
  processes?: number
  rssBytes?: number
  cpuPercent?: number
  storageBytes?: number
  sharedStorage?: boolean
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
  cost?: number
}

/** Token totals of a group of model calls; `input` is the uncached part, cache hits are `cacheRead`. */
export interface UsageTotals {
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
}

export interface UsageReport {
  since: string
  until: string
  totals: UsageTotals
  days: (UsageTotals & { date: string })[]
  models: (UsageTotals & { provider?: string; model?: string })[]
  sessions: (UsageTotals & { key: string; name: string; path: string; lastAt: number })[]
  /** Harnesses whose sessions keep no per-call usage. */
  untracked: string[]
}

export interface MonitorReport {
  at: string
  system: {
    hostname: string
    platform: string
    uptimeSec: number
    cpus: number
    /** Share of all cores busy since the previous refresh. */
    cpuPercent?: number
    loadAvg?: number[]
    memTotal: number
    memAvailable: number
    disk?: { free: number; total: number }
    processInfo: boolean
  }
  server: { pid: number; uptimeSec: number; rssBytes: number; heapUsedBytes: number; cpuPercent: number; eventLoopLagMs: number; node: string }
  storage: { piSessions: { bytes: number; files: number }; durable: { bytes: number; files: number } }
  sessions: MonitorSession[]
}

export type PiStatus = "working" | "done" | "error" | "aborted"

/** A chat message in pi's message shape; pi's own carry a status while it works. */
export interface ChatMessage {
  id: number
  chatId: string
  message: AgentMessage
  status?: PiStatus
  sessionKey?: string
  createdAt: string
  editedAt?: string
  /** Emoji → ids of the people who reacted. */
  reactions?: Record<string, string[]>
}

export interface Chat {
  id: string
  title: string
  folder: string
  sessionKey?: string
  pi: boolean
  members: { id: string; username: string }[]
  updatedAt: string
}

/** The home screen list: chats with people, and sessions shown as pi-only chats. */
export type ChatListItem =
  | { kind: "chat"; id: string; title: string; folder: string; pi: boolean; members: { id: string; username: string }[]; running: boolean; updatedAt: string; unread: number; last?: { author: string; text: string } }
  | { kind: "session"; id: string; title: string; folder: string; harness: string; running: boolean; live: boolean; updatedAt: string; memory: boolean; canDelete?: boolean }

/** A session or a chat with people, as the source or target of a shared message. */
export type ShareRef = { kind: "session" | "chat"; id: string }
export type ShareTarget = ShareRef & { title: string; folder: string; running: boolean; updatedAt: string }

export type JobStep =
  | { type: "prompt"; text: string }
  | { type: "script"; command: string; timeoutSec: number }
  | { type: "http"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; headers: Record<string, string>; body?: string; timeoutSec: number }

export interface JobSessionRef {
  key: string
  folder: string
  name: string
}

/** A scheduled job: runs its steps in order on its schedule, once a person approved it. */
export interface Job {
  id: string
  name: string
  schedule: string
  steps: JobStep[]
  enabled: boolean
  approved: boolean
  approvedBy?: string
  approvedAt?: string
  canApprove: boolean
  /** It runs a script, so only an admin can approve it. */
  needsAdmin: boolean
  folder: string
  owner: string
  recipients?: string[]
  session?: JobSessionRef
  proposedIn?: JobSessionRef
  note?: string
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRun?: { at: string; ok: boolean; output: string; ms: number }
  failures: number
  running: boolean
}

export type JobInput = Pick<Job, "name" | "schedule" | "steps" | "enabled">

import { activeTenant, tenantUrl } from "@/lib/tenant"

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { "X-Pi-Group": "1", "X-Pi-Tenant": activeTenant() } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)["Content-Type"] = "application/json"
  }
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("pi-group:unauthorized"))
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return data as T
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString()
const enc = encodeURIComponent

export const api = {
  interactions: (key: string) => request<{ interactions: Interaction[] }>("GET", `/api/sessions/${enc(key)}/interactions`),
  answerInteraction: (key: string, id: string, answer: { selected?: string[]; cancelled?: boolean }) => request<Interaction>("POST", `/api/sessions/${enc(key)}/interactions/${enc(id)}`, answer),
  assistanceStatus: () => request<AssistanceStatus>("GET", "/api/assistance/status"),
  saveAssistance: (settings: AssistanceSettings) => request<{ user: User }>("PUT", "/api/auth/assistance", settings),
  saveDefaults: (defaults: SessionDefaults) => request<{ user: User }>("PUT", "/api/auth/defaults", defaults),
  me: () => request<{ user: User; tenantId?: string }>("GET", "/api/auth/me"),
  tenants: () => request<{ active: string; tenants: { id: string; name: string }[] }>("GET", "/api/tenants"),
  switchTenant: (id: string) => request("POST", "/api/tenants/switch", { id }),
  login: (username: string, password: string) => request<{ user: User }>("POST", "/api/auth/login", { username, password }),
  saveAvatar: (avatar: string | null) => request("PUT", "/api/auth/avatar", { avatar }),
  logout: () => request("POST", "/api/auth/logout"),
  pushKey: () => request<{ publicKey: string }>("GET", "/api/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request("POST", "/api/push/subscribe", subscription),
  pushUnsubscribe: (endpoint: string) => request("POST", "/api/push/unsubscribe", { endpoint }),
  changePassword: (current: string, next: string) => request("POST", "/api/auth/password", { current, next }),

  directory: () => request<{ users: { id: string; username: string }[] }>("GET", "/api/users/directory"),
  users: () => request<{ users: User[] }>("GET", "/api/users"),
  createUser: (username: string, password: string, role: Role) => request<{ user: User }>("POST", "/api/users", { username, password, role }),
  updateUser: (id: string, change: { password?: string; role?: Role }) => request<{ user: User }>("PATCH", `/api/users/${id}`, change),
  deleteUser: (id: string) => request("DELETE", `/api/users/${id}`),

  fsInfo: () => request<{ root: string; rootName: string }>("GET", "/api/fs/info"),
  list: (path: string) => request<{ path: string; entries: FsEntry[] }>("GET", `/api/fs/list?${q({ path })}`),
  saveText: (path: string, content: string, mtime?: number) => request<{ path: string; size: number; mtime: number }>("PUT", "/api/fs/text", { path, content, mtime }),
  stat: (path: string) => request<{ path: string; size: number; mtime: number; mime: string; type: string }>("GET", `/api/fs/stat?${q({ path })}`),
  mkdir: (path: string) => request("POST", "/api/fs/mkdir", { path }),
  upload: (dir: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append("files", f, f.name)
    return request<{ files: { name: string; path: string; size: number; mime: string }[] }>("POST", `/api/fs/upload?${q({ path: dir })}`, form)
  },
  rawUrl: (path: string) => tenantUrl(`/api/fs/raw?${q({ path })}`),
  downloadUrl: (path: string) => tenantUrl(`/api/fs/download?${q({ path })}`),

  vaultStatus: () => request<{ configured: boolean; reachable: boolean }>("GET", "/api/vault/status"),
  vaultSecrets: () => request<{ secrets: VaultSecret[] }>("GET", "/api/vault/secrets"),
  vaultSecret: (key: string) => request<VaultSecret & { value: string }>("GET", `/api/vault/secrets/${enc(key)}`),
  saveVaultSecret: (key: string, body: { value?: string; description: string }) => request<VaultSecret>("PUT", `/api/vault/secrets/${enc(key)}`, body),
  deleteVaultSecret: (key: string) => request("DELETE", `/api/vault/secrets/${enc(key)}`),

  harnesses: () => request<{ harnesses: Harness[] }>("GET", "/api/harnesses"),
  models: (harness: string) => request<{ models: ModelInfo[] }>("GET", `/api/harnesses/${enc(harness)}/models`),

  sessions: (path: string) => request<{ path: string; sessions: SessionSummary[] }>("GET", `/api/sessions?${q({ path })}`),
  sessionCounts: (path: string) => request<{ counts: Record<string, { total: number; running: number }> }>("GET", `/api/sessions/counts?${q({ path })}`),
  monitor: () => request<MonitorReport>("GET", "/api/monitor"),
  usage: (days: number, scope: "visible" | "mine") => request<UsageReport>("GET", `/api/usage?${q({ days: String(days), scope, tzOffset: String(new Date().getTimezoneOffset()) })}`),
  chats: () => request<{ chats: ChatListItem[] }>("GET", "/api/chats"),
  /** Admins: fold every conversation not yet in memory into it now. */
  consolidateMemory: () => request<{ started: boolean; pending?: number; reason?: string }>("POST", "/api/memory/consolidate", { all: true }),
  chat: (id: string) => request<{ chat: Chat; messages: ChatMessage[] }>("GET", `/api/chats/${enc(id)}`),
  startChat: (body: { text: string; pi: boolean; userIds: string[]; folder?: string; model?: { provider: string; id: string }; thinkingLevel?: string }) => request<{ chat?: string; session?: string }>("POST", "/api/chats", body),
  /** Messages after `after`, plus the current state of `check` (replies still shown as working). */
  chatSince: (id: string, after: number, check: number[]) =>
    request<{ messages: ChatMessage[] }>("GET", `/api/chats/${enc(id)}/messages?${q({ after: String(after), check: check.join(",") })}`),
  sendChat: (id: string, text: string, config?: { model?: { provider: string; id: string }; thinkingLevel?: string }) => request<{ message: ChatMessage }>("POST", `/api/chats/${enc(id)}/messages`, { text, ...config }),
  deleteChatMessage: (id: string, messageId: number) => request<{ ok: true; queued: boolean }>("DELETE", `/api/chats/${enc(id)}/messages/${messageId}`),
  editChat: (id: string, messageId: number, text: string) => request<{ message: ChatMessage }>("POST", `/api/chats/${enc(id)}/messages/${messageId}/edit`, { text }),
  reactChat: (id: string, messageId: number, emoji: string) => request<{ message: ChatMessage }>("POST", `/api/chats/${enc(id)}/messages/${messageId}/reactions`, { emoji }),
  readChat: (id: string, upTo: number) => request("POST", `/api/chats/${enc(id)}/read`, { upTo }),
  searchFolders: (query: string) => request<{ folders: string[]; chatFolder: string }>("GET", `/api/folders/search?${q({ q: query })}`),
  searchPaths: (query: string) => request<{ entries: { path: string; type: "dir" | "file" }[] }>("GET", `/api/folders/search?${q({ q: query, files: "1" })}`),
  toolsAt: (path: string) => request<SessionTools>("GET", `/api/tools?${q({ path })}`),
  mcpAt: (path: string) => request<{ servers: McpServer[]; live: boolean; note?: string }>("GET", `/api/mcp?${q({ path })}`),
  activeSessions: () => request<{ sessions: SessionSummary[] }>("GET", "/api/sessions/active"),
  recentSessions: (limit = 3) => request<{ sessions: SessionSummary[] }>("GET", `/api/sessions/recent?${q({ limit: String(limit) })}`),
  /** Sessions and chats the caller can send a shared message into. */
  shareTargets: () => request<{ targets: ShareTarget[] }>("GET", "/api/sessions/targets"),
  /** Add a message to the end of other sessions and chats; it waits while the source or a target agent is running. */
  forward: (body: { text: string; from?: ShareRef; to: ShareRef[] }) => request<{ shared: number; waiting: number }>("POST", "/api/sessions/forward", body),
  jobs: () => request<{ jobs: Job[] }>("GET", "/api/jobs"),
  updateJob: (id: string, job: JobInput) => request<{ job: Job }>("PUT", `/api/jobs/${enc(id)}`, job),
  approveJob: (id: string) => request<{ job: Job }>("POST", `/api/jobs/${enc(id)}/approve`),
  runJob: (id: string) => request<{ job: Job }>("POST", `/api/jobs/${enc(id)}/run`),
  deleteJob: (id: string) => request("DELETE", `/api/jobs/${enc(id)}`),
  deleteSession: (key: string) => request("DELETE", `/api/sessions/${enc(key)}`),
  session: (key: string) => request<{ session: SessionSummary }>("GET", `/api/sessions/${enc(key)}`),
  createSession: (body: { harness: string; path: string; name?: string; model?: { provider: string; id: string }; thinkingLevel?: string }) =>
    request<{ session: SessionSummary }>("POST", "/api/sessions", body),
  eventsUrl: (key: string) => tenantUrl(`/api/sessions/${enc(key)}/events`),
  tools: (key: string) => request<SessionTools>("GET", `/api/sessions/${enc(key)}/tools`),
  mcp: (key: string) => request<{ servers: McpServer[]; live: boolean; note?: string }>("GET", `/api/sessions/${enc(key)}/mcp`),
  /** A session's folder, or a plain folder when there is no session yet. */
  terminalUrl: (target: { key?: string; path?: string }, cols: number, rows: number) =>
    tenantUrl(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal?${q({ ...(target.key ? { key: target.key } : { path: target.path ?? "" }), cols: String(cols), rows: String(rows) })}`),
  prompt: (key: string, body: { text: string; images?: { data: string; mimeType: string }[]; mode?: "steer" | "followUp" }) =>
    request("POST", `/api/sessions/${enc(key)}/prompt`, body),
  /** Edit a message of a session whose agent is not running; `expect` is its current text. */
  deleteMessage: (key: string, target: { index: number; timestamp?: number; expect: string }) => request<{ queued: boolean }>("POST", `/api/sessions/${enc(key)}/messages/delete`, target),
  editMessage: (key: string, edit: { index: number; timestamp?: number; expect: string; text: string }) => request("POST", `/api/sessions/${enc(key)}/messages/edit`, edit),
  abort: (key: string) => request("POST", `/api/sessions/${enc(key)}/abort`),
  setModel: (key: string, provider: string, id: string) => request("POST", `/api/sessions/${enc(key)}/model`, { provider, id }),
  setThinking: (key: string, level: string) => request("POST", `/api/sessions/${enc(key)}/thinking`, { level }),
  rename: (key: string, name: string) => request("POST", `/api/sessions/${enc(key)}/name`, { name }),
  answerDialog: (key: string, answer: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean }) =>
    request("POST", `/api/sessions/${enc(key)}/dialog`, answer),
  pin: (key: string, pinned: boolean) => request<{ session: SessionSummary }>("POST", `/api/sessions/${enc(key)}/pin`, { pinned }),
  stop: (key: string) => request("POST", `/api/sessions/${enc(key)}/stop`),
  setAcl: (key: string, visibility: "private" | "shared", shares: { userId: string; access: Access }[]) =>
    request<{ session: SessionSummary }>("PUT", `/api/sessions/${enc(key)}/acl`, { visibility, shares }),
  setOwner: (key: string, userId: string) => request<{ session: SessionSummary }>("POST", `/api/sessions/${enc(key)}/owner`, { userId }),
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
