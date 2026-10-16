export type Role = "admin" | "member"
export type Access = "read" | "write"
export type EffectiveAccess = "admin" | "owner" | Access

export interface SessionDefaults {
  harness: string
  model: { provider: string; id: string }
  thinkingLevel: string
}

export interface User {
  id: string
  username: string
  role: Role
  createdAt: string
  sessionDefaults?: SessionDefaults
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
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { "X-Pi-Group": "1" } }
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
  saveDefaults: (defaults: SessionDefaults) => request<{ user: User }>("PUT", "/api/auth/defaults", defaults),
  me: () => request<{ user: User }>("GET", "/api/auth/me"),
  login: (username: string, password: string) => request<{ user: User }>("POST", "/api/auth/login", { username, password }),
  logout: () => request("POST", "/api/auth/logout"),
  changePassword: (current: string, next: string) => request("POST", "/api/auth/password", { current, next }),

  directory: () => request<{ users: { id: string; username: string }[] }>("GET", "/api/users/directory"),
  users: () => request<{ users: User[] }>("GET", "/api/users"),
  createUser: (username: string, password: string, role: Role) => request<{ user: User }>("POST", "/api/users", { username, password, role }),
  updateUser: (id: string, change: { password?: string; role?: Role }) => request<{ user: User }>("PATCH", `/api/users/${id}`, change),
  deleteUser: (id: string) => request("DELETE", `/api/users/${id}`),

  fsInfo: () => request<{ root: string; rootName: string }>("GET", "/api/fs/info"),
  list: (path: string) => request<{ path: string; entries: FsEntry[] }>("GET", `/api/fs/list?${q({ path })}`),
  stat: (path: string) => request<{ path: string; size: number; mtime: number; mime: string; type: string }>("GET", `/api/fs/stat?${q({ path })}`),
  mkdir: (path: string) => request("POST", "/api/fs/mkdir", { path }),
  upload: (dir: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append("files", f, f.name)
    return request<{ files: { name: string; path: string; size: number; mime: string }[] }>("POST", `/api/fs/upload?${q({ path: dir })}`, form)
  },
  rawUrl: (path: string) => `/api/fs/raw?${q({ path })}`,
  downloadUrl: (path: string) => `/api/fs/download?${q({ path })}`,

  harnesses: () => request<{ harnesses: Harness[] }>("GET", "/api/harnesses"),
  models: (harness: string) => request<{ models: ModelInfo[] }>("GET", `/api/harnesses/${enc(harness)}/models`),

  sessions: (path: string) => request<{ path: string; sessions: SessionSummary[] }>("GET", `/api/sessions?${q({ path })}`),
  activeSessions: () => request<{ sessions: SessionSummary[] }>("GET", "/api/sessions/active"),
  recentSessions: (limit = 3) => request<{ sessions: SessionSummary[] }>("GET", `/api/sessions/recent?${q({ limit: String(limit) })}`),
  deleteSession: (key: string) => request("DELETE", `/api/sessions/${enc(key)}`),
  session: (key: string) => request<{ session: SessionSummary }>("GET", `/api/sessions/${enc(key)}`),
  createSession: (body: { harness: string; path: string; name?: string; model?: { provider: string; id: string }; thinkingLevel?: string }) =>
    request<{ session: SessionSummary }>("POST", "/api/sessions", body),
  eventsUrl: (key: string) => `/api/sessions/${enc(key)}/events`,
  prompt: (key: string, body: { text: string; images?: { data: string; mimeType: string }[]; mode?: "steer" | "followUp" }) =>
    request("POST", `/api/sessions/${enc(key)}/prompt`, body),
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
