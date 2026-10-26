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
  projectId?: string
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
  projectId?: string
  sessionKey?: string
  pi: boolean
  members: { id: string; username: string }[]
  updatedAt: string
}

/** The home screen list: chats with people, and sessions shown as pi-only chats. */
type ListedInProject = { projectId: string; canMove: boolean; /** The project a move waits to go to, for approval by the people in it. */ moving?: string }
export type ChatListItem =
  | ({ kind: "chat"; id: string; title: string; folder: string; pi: boolean; canDelete?: boolean; members: { id: string; username: string }[]; running: boolean; updatedAt: string; unread: number; last?: { author: string; text: string } } & ListedInProject)
  | ({ kind: "session"; id: string; title: string; folder: string; harness: string; running: boolean; live: boolean; updatedAt: string; memory: boolean; canDelete?: boolean } & ListedInProject)

/** What sessions and chats are grouped by within a tenant; General is the default. */
export interface Project {
  id: string
  name: string
  /** Its own folder: new sessions start here and uploads land here. */
  folder: string
  /** Existing folders linked to it; sessions working in them belong to it. */
  links: string[]
  general: boolean
  canManage: boolean
  memberIds: string[]
  createdAt: string
}

/** A move of a session or chat to another project, waiting for the people in it. */
export interface MoveRequest {
  id: string
  kind: "session" | "chat"
  itemId: string
  title: string
  from: string
  to: string
  toId: string
  requestedBy: string
  requestedById: string
  approvedBy: string[]
  waitingFor: string[]
  waitingForIds: string[]
  createdAt: string
}

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

interface AppletInput {
  id: string
  label: string
  help?: string
  optional?: boolean
}
/** One part of an applet's form; the server checks the same closed set. */
export type AppletField =
  | { type: "markdown"; text: string }
  | (AppletInput & { type: "text" | "textarea"; placeholder?: string; default?: string })
  | (AppletInput & { type: "number"; min?: number; max?: number; step?: number; default?: number })
  | (AppletInput & { type: "select"; options: string[]; multiple?: boolean; default?: string | string[] })
  | (AppletInput & { type: "radio"; options: string[]; default?: string })
  | { type: "checkbox"; id: string; label: string; help?: string; default?: boolean }
  | (AppletInput & { type: "file"; accept?: string[]; multiple?: boolean })
  | (AppletInput & { type: "folder" })

export interface AppletSpec {
  slug: string
  title: string
  description: string
  fields: AppletField[]
  actions: { id: string; label: string; prompt: string }[]
}

/** A form an agent designed: each button starts a new session with its filled-in prompt, once approved. */
export interface Applet {
  id: string
  slug: string
  title: string
  description: string
  folder: string
  owner: string
  version: number
  approved: boolean
  approvedBy?: string
  approvedAt?: string
  /** A change waiting for approval while the approved version keeps running. */
  hasDraft: boolean
  canManage: boolean
  note?: string
  proposedIn?: JobSessionRef
  createdAt: string
  updatedAt: string
  spec?: AppletSpec
  draft?: AppletSpec
}

export interface AppletRun {
  id: string
  action: string
  values: Record<string, string | number | boolean | string[]>
  status: "running" | "finished" | "error" | "aborted"
  output?: string
  startedAt: string
  finishedAt?: string
  session?: { key: string; folder: string }
}

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

/** A session's shared browser, as the server reports it. */
export interface BrowserStatus {
  open: boolean
  url?: string
  title?: string
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
  chats: (project?: string) => request<{ chats: ChatListItem[] }>("GET", `/api/chats${project ? `?${q({ project })}` : ""}`),
  projects: () => request<{ projects: Project[] }>("GET", "/api/projects"),
  createProject: (body: { name: string; links?: string[] }) => request<{ project: Project }>("POST", "/api/projects", body),
  shareProject: (id: string, memberIds: string[]) => request<{ project: Project }>("PUT", `/api/projects/${enc(id)}/shares`, { memberIds }),
  updateProject: (id: string, body: { name?: string; links?: string[] }) => request<{ project: Project }>("PATCH", `/api/projects/${enc(id)}`, body),
  deleteProject: (id: string) => request("DELETE", `/api/projects/${enc(id)}`),
  moveToProject: (kind: "session" | "chat", id: string, to: string) => request<{ moved: boolean; request?: MoveRequest }>("POST", "/api/projects/move", { kind, id, to }),
  projectMoves: () => request<{ moves: MoveRequest[] }>("GET", "/api/projects/moves"),
  answerMove: (id: string, approve: boolean) => request<{ moved: boolean }>("POST", `/api/projects/moves/${enc(id)}`, { approve }),
  cancelMove: (id: string) => request("DELETE", `/api/projects/moves/${enc(id)}`),
  /** Admins: fold every conversation not yet in memory into it now. */
  consolidateMemory: () => request<{ started: boolean; pending?: number; reason?: string }>("POST", "/api/memory/consolidate", { all: true }),
  chat: (id: string) => request<{ chat: Chat; messages: ChatMessage[] }>("GET", `/api/chats/${enc(id)}`),
  /** Leave a chat; it is deleted once nobody is left in it. */
  deleteChat: (id: string) => request<{ ok: true; deleted: boolean }>("DELETE", `/api/chats/${enc(id)}`),
  startChat: (body: { text: string; pi: boolean; userIds: string[]; folder?: string; projectId?: string; model?: { provider: string; id: string }; thinkingLevel?: string }) => request<{ chat?: string; session?: string }>("POST", "/api/chats", body),
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
  applets: () => request<{ applets: Applet[] }>("GET", "/api/applets"),
  applet: (ref: string) => request<{ applet: Applet & { spec: AppletSpec }; runs: AppletRun[] }>("GET", `/api/applets/${enc(ref)}`),
  approveApplet: (id: string, version: number) => request<{ applet: Applet }>("POST", `/api/applets/${enc(id)}/approve`, { version }),
  discardAppletDraft: (id: string) => request<{ applet: Applet }>("DELETE", `/api/applets/${enc(id)}/draft`),
  runApplet: (id: string, action: string, values: Record<string, unknown>) => request<{ run: AppletRun }>("POST", `/api/applets/${enc(id)}/run`, { action, values }),
  deleteApplet: (id: string) => request("DELETE", `/api/applets/${enc(id)}`),
  deleteSession: (key: string) => request("DELETE", `/api/sessions/${enc(key)}`),
  session: (key: string) => request<{ session: SessionSummary }>("GET", `/api/sessions/${enc(key)}`),
  createSession: (body: { harness: string; path: string; projectId?: string; name?: string; model?: { provider: string; id: string }; thinkingLevel?: string }) =>
    request<{ session: SessionSummary }>("POST", "/api/sessions", body),
  eventsUrl: (key: string) => tenantUrl(`/api/sessions/${enc(key)}/events`),
  tools: (key: string) => request<SessionTools>("GET", `/api/sessions/${enc(key)}/tools`),
  mcp: (key: string) => request<{ servers: McpServer[]; live: boolean; note?: string }>("GET", `/api/sessions/${enc(key)}/mcp`),
  /** A session's folder, or a plain folder when there is no session yet. */
  terminalUrl: (target: { key?: string; path?: string }, cols: number, rows: number) =>
    tenantUrl(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal?${q({ ...(target.key ? { key: target.key } : { path: target.path ?? "" }), cols: String(cols), rows: String(rows) })}`),
  browserUrl: (key: string) => tenantUrl(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/browser?${q({ key })}`),
  browserStatus: (key: string) => request<BrowserStatus>("GET", `/api/sessions/${enc(key)}/browser`),
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
