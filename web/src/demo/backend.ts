import type { AgentMessage, Chat, ChatMessage, Project, SessionState, SessionSummary, User } from '@/lib/api'

const now = Date.now()
const at = new Date(now).toISOString()
const folder = 'weekend-planner'
const project: Project = { id: 'general', name: 'General', folder, links: [], general: true, canManage: true, memberIds: [], openToTenant: true, createdAt: at }
const users: User[] = ['Alice', 'Sam', 'Jordan'].map((username, i) => ({ id: `demo-${i}`, username, role: i ? 'member' : 'admin', createdAt: at }))
const alice = users[0]
const model = { provider: 'anthropic', id: 'claude-sonnet-demo' }
const models = [{ ...model, name: 'Claude Sonnet (demo)', contextWindow: 200000, reasoning: true }]
const text = (role: string, text: string, author?: User): AgentMessage => ({ role, timestamp: Date.now(), content: [{ type: 'text', text }], author })
const sources = new Map<string, Set<(data: string) => void>>()
const states = new Map<string, SessionState>()
const sessions = new Map<string, SessionSummary>()
const chats = new Map<string, { chat: Chat; messages: ChatMessage[] }>()
const files = new Map([['README.md', '# Weekend planner\n\nA fictional Beezy project. Browse activities, vote, and make plans together.\n'], ['package.json', '{"name":"weekend-planner","scripts":{"test":"vitest run"}}\n'], ['planner.ts', 'export const activities = ["Farmers market", "Lake trail", "Board games"];\n']])
const browserUrl = 'http://localhost:5173/'
const browserTitle = 'Weekend planner (demo)'
let browserOpen = true
let serial = 10
function createSession(name: string, path = folder, id = `demo-${++serial}`, config = model) {
  const key = `pi:${id}`
  const session: SessionSummary = { key, id, harness: 'pi', path, name, createdAt: at, updatedAt: at, messageCount: 0, live: true, running: false, pinned: false, owner: alice.id, visibility: 'shared', shares: [], projectId: project.id, access: 'admin' }
  sessions.set(key, session)
  states.set(key, { name, messages: [], running: false, live: true, partial: null, toolOutputs: {}, runningTools: [], dialogs: [], queue: { steering: [], followUp: [] }, model: config, thinkingLevel: 'low' })
  return session
}
const planner = createSession('Build the weekend planner', folder, 'planner')
function commands() {
  return [
    { id: 'demo-read', name: 'read', arguments: { path: 'package.json' }, output: files.get('package.json')! },
    { id: 'demo-test', name: 'bash', arguments: { command: 'npm test' }, output: '✓ Activity voting (3 tests)\n✓ Weather card (2 tests)\n\nTest Files  2 passed\nTests       5 passed' },
  ]
}
function example(): AgentMessage[] {
  return commands().flatMap((tool): AgentMessage[] => [
    { role: 'assistant', timestamp: Date.now(), content: [{ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.arguments }] },
    { ...text('toolResult', tool.output), toolCallId: tool.id, toolName: tool.name, isError: false },
  ])
}
states.get(planner.key)!.messages = [text('user', 'Build a responsive weekend planner with activity voting, then run the tests.', alice), text('assistant', 'I’ll check the project setup and verify the planner.'), ...example(), text('assistant', 'All five tests passed. Open the shared browser to try the planner preview.')]
planner.messageCount = states.get(planner.key)!.messages.length
const review = createSession('Review mobile accessibility', folder, 'review')
states.get(review.key)!.messages = [text('user', 'Check keyboard navigation on the planner.', users[1]), text('assistant', 'The activity buttons have visible focus and can be activated from the keyboard.')]
const discussion: Chat = { id: 'demo-team', title: 'Weekend crew', folder, projectId: project.id, sessionKey: planner.key, pi: true, members: users.slice(0, 2), updatedAt: at }
function chatMessage(id: string, message: AgentMessage, assistant = false): ChatMessage {
  return { id: ++serial, chatId: id, message, createdAt: at, ...(assistant ? { status: 'done' as const, sessionKey: chats.get(id)?.chat.sessionKey } : {}) }
}
chats.set(discussion.id, { chat: discussion, messages: [chatMessage(discussion.id, text('user', '@Sam @pi Let’s build a small weekend planner with a weather card and activity voting.', alice)), chatMessage(discussion.id, text('user', 'Sounds good. Can we make it work on phones?', users[1])), { ...chatMessage(discussion.id, text('assistant', 'The planner is ready and all five tests passed. Try the shared browser, or open the agent session to inspect my commands.'), true), sessionKey: planner.key }] })

const tools = { tools: [{ name: 'read', description: 'Read a workspace file', origin: 'builtin' }, { name: 'bash', description: 'Run shell commands (simulated)', origin: 'builtin' }, { name: 'browser', description: 'Inspect the shared browser', origin: 'extension' }], resources: [{ kind: 'skill', name: 'project-style', scope: 'project', description: 'Keep the planner accessible and mobile-friendly.' }], commands: [] }
const totals = { calls: 12, input: 24680, output: 4380, cacheRead: 10240, cacheWrite: 2048, reasoning: 512, cost: 0.18 }
const browserStatus = () => ({ open: browserOpen, url: browserUrl, title: browserTitle })
const emit = (key: string, event: object) => sources.get(key)?.forEach(callback => callback(JSON.stringify(event)))
const snapshot = (key: string) => emit(key, { type: 'state', state: states.get(key) })
const reply = () => text('assistant', 'This is a scripted demo reply. No model was contacted and no commands were executed.')
const json = (data: unknown, status = 200) => Response.json(data, { status })
const unsupported = () => json({ error: 'This operation is not available in the static demo.' }, 404)

async function handle(url: URL, method: string, body: Record<string, any>): Promise<Response> {
  const [area, id, action, item, sub] = url.pathname.slice(5).split('/').map(decodeURIComponent)
  const q = url.searchParams
  const all = [...sessions.values()]
  if (area === 'auth') {
    if (id === 'me' || id === 'login') return json({ user: alice })
    if (id === 'defaults') { alice.sessionDefaults = body as User['sessionDefaults']; return json({ user: alice }) }
    if (['logout', 'avatar', 'password'].includes(id)) return unsupported()
  }
  if (area === 'users') {
    if (action === 'avatar') return unsupported()
    if (method === 'GET') return json({ users })
    if (method === 'POST') { const user: User = { id: `demo-${++serial}`, username: body.username, role: body.role, createdAt: at }; users.push(user); return json({ user }) }
    const index = users.findIndex(u => u.id === id)
    if (index > 0 && method === 'PATCH') { if (body.role) users[index].role = body.role; return json({ user: users[index] }) }
    if (index > 0 && method === 'DELETE') { users.splice(index, 1); return json({ ok: true }) }
  }
  if (area === 'tenants' && method === 'GET') return json({ active: 'demo', tenants: [{ id: 'demo', name: 'Demo workspace', canShare: false }] })
  if (area === 'harnesses') return json(id ? { models } : { harnesses: [{ id: 'pi', label: 'pi', ok: true, durable: false, description: 'pi coding agent' }] })
  if (area === 'projects' && method === 'GET') return json(action === 'links' ? { links: [] } : id === 'moves' ? { moves: [] } : { projects: [project] })
  if (area === 'memory' && method === 'GET') return json(action === 'archives' ? { sessions: [] } : { intervalHours: 24, context: { trimHours: 24, windowHours: 168 }, running: false, batch: 0, batches: 0, sources: [], topics: [], maxTopics: 12, topicMax: 10000, legacy: false })
  if (area === 'memory-models') return json({ harness: 'pi', models })
  if (area === 'sessions') {
    if (!id && method === 'POST') return json({ session: createSession(body.name || 'New demo session', body.path || folder, undefined, body.model) })
    if (!id || id === 'active' || id === 'recent') return json({ path: q.get('path') || '', sessions: all.filter(s => !q.get('path') || s.path === q.get('path')) })
    if (id === 'counts') return json({ counts: { [folder]: { total: all.length, running: 0 } } })
    if (id === 'last-edit') return json({ file: null })
    if (id === 'targets') return json({ targets: [] })
    if (id === 'batch-delete' && method === 'POST') {
      const deleted: string[] = []
      const skipped: { key: string; reason: string }[] = []
      for (const key of new Set<string>(body.keys)) {
        const session = sessions.get(key)
        if (!session || session.running) { skipped.push({ key, reason: session ? 'The agent is running' : 'Session not found' }); continue }
        sessions.delete(key); states.delete(key); emit(key, { type: 'deleted', by: alice.username }); deleted.push(key)
      }
      return json({ deleted, skipped })
    }
    const session = sessions.get(id), state = states.get(id)
    if (!session || !state) return unsupported()
    if (action === 'tools') return json(tools)
    if (action === 'mcp') return json({ servers: [], live: true })
    if (action === 'browser') return json(browserStatus())
    if (action === 'watches') return json({ watches: [] })
    if (action === 'interactions') return json({ interactions: [] })
    if (!action && method === 'GET') return json({ session })
    if (!action && method === 'DELETE') { sessions.delete(id); states.delete(id); emit(id, { type: 'deleted', by: alice.username }); return json({ ok: true }) }
    if (action === 'prompt') {
      state.messages.push(text('user', body.text || '', alice), reply()); session.messageCount = state.messages.length; snapshot(id); return json({ ok: true })
    }
    if (action === 'name' || action === 'generate-title') { session.name = state.name = body.name || session.name || 'Demo session'; snapshot(id); return json({ name: state.name }) }
    if (action === 'model') state.model = { provider: body.provider, id: body.id }
    else if (action === 'thinking') state.thinkingLevel = body.level
    else if (action === 'pin') session.pinned = body.pinned
    else if (action === 'retention' || action === 'acl') Object.assign(session, body)
    else if (action === 'stop' || action === 'abort') state.running = session.running = false
    else return unsupported()
    snapshot(id); return json({ session })
  }
  if (area === 'chats') {
    if (!id && method === 'GET') return json({ chats: [
      ...[...chats.values()].map(({ chat, messages }) => ({ ...chat, kind: 'chat', unread: 0, running: false, canMove: true, canDelete: true, last: { author: 'Beezy', text: messages.at(-1)?.message.content[0].text } })),
      ...all.map(s => ({ kind: 'session', id: s.key, title: s.name, folder: s.path, harness: s.harness, running: s.running, live: s.live, updatedAt: s.updatedAt, projectId: project.id, canMove: true, canDelete: true })),
    ] })
    if (!id && method === 'POST') {
      const session = body.pi ? createSession('New demo conversation', body.folder || folder, undefined, body.model) : undefined
      if (session) { states.get(session.key)!.messages.push(text('user', body.text, alice), reply()); session.messageCount = 2 }
      if (session && !body.userIds?.length) return json({ session: session.key })
      const chatId = `demo-chat-${++serial}`
      chats.set(chatId, { chat: { id: chatId, title: 'New conversation', updatedAt: at, projectId: project.id, folder: body.folder || folder, pi: !!session, sessionKey: session?.key, members: [alice, ...users.filter(u => body.userIds?.includes(u.id) && u !== alice)] }, messages: [chatMessage(chatId, text('user', body.text, alice))] })
      if (session) chats.get(chatId)!.messages.push(chatMessage(chatId, reply(), true))
      return json({ chat: chatId })
    }
    const entry = chats.get(id)
    if (!entry) return unsupported()
    if (!action && method === 'GET') return json(entry)
    if (!action && method === 'DELETE') { chats.delete(id); return json({ ok: true, deleted: true }) }
    if (action === 'read') return json({ ok: true })
    if (action === 'messages' && method === 'GET') return json({ messages: entry.messages.filter(m => m.id > Number(q.get('after')) || q.get('check')?.split(',').includes(String(m.id))) })
    if (action === 'messages' && method === 'POST' && !item) {
      const message = chatMessage(id, text('user', body.text, alice)); entry.messages.push(message)
      if (entry.chat.pi && /@pi\b/i.test(body.text)) entry.messages.push(chatMessage(id, reply(), true))
      return json({ message })
    }
    const message = entry.messages.find(m => m.id === Number(item))
    if (message && sub === 'edit') { message.message = text('user', body.text, alice); message.editedAt = new Date().toISOString(); return json({ message }) }
    if (message && sub === 'reactions') { const reactions = message.reactions ??= {}; reactions[body.emoji] = reactions[body.emoji]?.length ? [] : [alice.id]; return json({ message }) }
    if (message && method === 'DELETE') { entry.messages = entry.messages.filter(m => m !== message); return json({ ok: true, queued: false }) }
  }
  const entries = [...files].map(([name, content]) => ({ name, path: `${folder}/${name}`, type: 'file', symlink: false, size: content.length, mtime: now }))
  const root = { name: folder, path: folder, type: 'dir', symlink: false, size: 0, mtime: now }
  const path = q.get('path') || ''
  if (area === 'folders') { const query = q.get('q')?.toLowerCase() ?? ''; const found = [root, ...entries].filter(e => e.path.toLowerCase().includes(query)); return json({ entries: found, folders: found.filter(e => e.type === 'dir').map(e => e.path), chatFolder: folder }) }
  if (area === 'fs') {
    const filename = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : ''
    if (id === 'info') return json({ root: '/demo', rootName: 'Demo workspace' })
    if (id === 'list') return json({ path, entries: path === folder ? entries : !path ? [root] : [] })
    if (id === 'stat' && files.has(filename)) return json({ ...entries.find(e => e.name === filename), mime: 'text/plain' })
    if ((id === 'raw' || id === 'download') && files.has(filename)) return new Response(files.get(filename), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    if (id === 'missing') return json({ missing: (body.paths || []).filter((p: string) => !entries.some(e => e.path === p)) })
    if (id === 'text' && method === 'PUT' && entries.some(e => e.path === body.path)) { files.set(body.path.slice(folder.length + 1), body.content); return json({ path: body.path, size: body.content.length, mtime: Date.now() }) }
  }
  if (area === 'monitor') return json({ at, system: { hostname: 'fictional-beezy', platform: 'linux', uptimeSec: 18320, cpus: 4, cpuPercent: 18, loadAvg: [0.72, 0.6, 0.34], memTotal: 8e9, memAvailable: 6.8e9, disk: { free: 61.6e9, total: 64e9 }, processInfo: true }, server: { pid: 42, uptimeSec: 5120, rssBytes: 128e6, heapUsedBytes: 54e6, cpuPercent: 2.8, eventLoopLagMs: 1.2, node: '22.19.0' }, storage: { piSessions: { bytes: 82000, files: all.length }, durable: { bytes: 0, files: 0 } }, sessions: all.map(s => ({ key: s.key, name: s.name, harness: s.harness, path: s.path, running: s.running, viewers: 1, lastActivity: at, messages: s.messageCount, model: model.id, pinned: s.pinned })) })
  if (area === 'usage') {
    const count = Math.min(90, Math.max(1, Number(q.get('days')) || 7))
    const days = Array.from({ length: count }, (_, i) => ({ ...totals, input: totals.input + (i % 5) * 2600, date: new Date(now - (count - 1 - i) * 86400000).toISOString().slice(0, 10) }))
    const sum = days.reduce((a, d) => ({ calls: a.calls + d.calls, input: a.input + d.input, output: a.output + d.output, cacheRead: a.cacheRead + d.cacheRead, cacheWrite: a.cacheWrite + d.cacheWrite, reasoning: a.reasoning + d.reasoning, cost: a.cost + d.cost }), { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0 })
    return json({ since: days[0].date, until: at, totals: sum, days, models: [{ ...sum, provider: model.provider, model: model.id }], sessions: [{ ...sum, key: planner.key, name: planner.name, path: folder, lastAt: now }], untracked: [] })
  }
  if (area === 'tools') return json(tools)
  if (area === 'mcp') return json({ servers: [], live: true })
  if (area === 'applets' && !id) return json({ applets: [] })
  if (area === 'jobs' && !id) return json({ jobs: [] })
  if (area === 'vault' && id === 'status') return json({ configured: false, reachable: false })
  if (area === 'lipread') return json({ enabled: false })
  if (area === 'assistance') return json({ configured: false, supportedHarnesses: [], settings: { injectionChecks: false, contextExtraction: false, toolSelection: false, dailyBudgetUsd: 0, maxCallsPerRun: 0 }, records: [] })
  return unsupported()
}

class DemoEvents extends EventTarget {
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readyState = 0
  onopen?: () => void
  onmessage?: (event: MessageEvent) => void
  private key: string | undefined
  private ping: number
  private receive = (data: string) => this.onmessage?.(new MessageEvent('message', { data }))
  constructor(url: string) {
    super()
    this.key = decodeURIComponent(/\/sessions\/([^/]+)\/events/.exec(url)?.[1] ?? '')
    this.ping = window.setInterval(() => this.dispatchEvent(new Event('ping')), 8000)
    queueMicrotask(() => {
      if (this.readyState === 2) return
      this.readyState = 1; this.onopen?.()
      if (!this.key || !states.has(this.key)) return
      if (!sources.has(this.key)) sources.set(this.key, new Set())
      sources.get(this.key)!.add(this.receive)
      this.receive(JSON.stringify({ type: 'state', state: states.get(this.key) }))
    })
  }
  close() { this.readyState = 2; clearInterval(this.ping); if (this.key) sources.get(this.key)?.delete(this.receive) }
}

class DemoSocket {
  static readonly OPEN = 1
  readyState = 0
  binaryType = 'blob'
  onopen?: () => void
  onmessage?: (event: MessageEvent) => void
  onclose?: (event: CloseEvent) => void
  private viewport = { width: 900, height: 550 }
  private votes = 4
  private frame = 0
  private browser: boolean
  constructor(url: string) {
    this.browser = new URL(url).pathname === '/api/browser'
    queueMicrotask(() => {
      if (this.readyState) return
      if (!this.browser) { this.close(1000, 'Terminal execution is disabled in the demo.'); return }
      this.readyState = 1; browserOpen = true; this.onopen?.(); this.render()
    })
  }
  private message(data: object) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) })) }
  private render() {
    const { width, height } = this.viewport
    this.message({ type: 'state', url: browserUrl, title: browserTitle, viewport: this.viewport, canInput: true })
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#faf8f2'; ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#29483b'; ctx.font = 'bold 30px Georgia'; ctx.fillText('Weekend planner', 24, 62)
    ctx.font = '15px sans-serif'; ctx.fillText('Saturday · 22°C · Mostly sunny', 24, 98)
    ctx.fillStyle = '#e9ede1'; ctx.fillRect(24, 135, width - 48, 135)
    ctx.fillStyle = '#29483b'; ctx.font = 'bold 20px Georgia'; ctx.fillText('Coffee & farmers market', 40, 175)
    ctx.font = '14px sans-serif'; ctx.fillText('10:00 AM · Downtown', 40, 200)
    ctx.fillStyle = '#29483b'; ctx.fillRect(40, 215, 126, 36)
    ctx.fillStyle = '#fff'; ctx.fillText(`Vote · ${this.votes}`, 55, 238)
    ctx.fillStyle = '#556b5a'; ctx.fillText('Demo preview · click Vote to try it', 24, 305)
    const frame = ++this.frame
    canvas.toBlob((blob) => { if (blob && this.readyState === 1 && frame === this.frame) this.onmessage?.(new MessageEvent('message', { data: blob })) })
  }
  send(raw: string) {
    const m = JSON.parse(raw)
    if (m.type === 'viewport') {
      this.viewport = { width: Math.max(320, Math.min(1920, Number(m.width) || 900)), height: Math.max(320, Math.min(1600, Number(m.height) || 550)) }; this.render()
    } else if (m.type === 'mouse' && m.action === 'up' && m.x >= 40 && m.x <= 166 && m.y >= 215 && m.y <= 251) { this.votes = this.votes === 4 ? 5 : 4; this.render() }
    else if (m.type === 'navigate') this.message({ type: 'error', message: 'External navigation is disabled in this demo. The preview is fictional.' })
    else if (m.type === 'reload') this.render()
    else if (m.type === 'quote') this.message({ type: 'quoted', text: 'Coffee & farmers market · 10:00 AM' })
    else if (m.type === 'pick') this.message({ type: 'error', message: 'Element capture is not available in the static browser preview.' })
    else if (m.type === 'close' || m.type === 'stop') { browserOpen = false; for (const key of sessions.keys()) emit(key, { type: 'browser', ...browserStatus() }); this.close() }
  }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code, reason })) }
}

export function installDemoBackend() {
  const fetchOriginal = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return fetchOriginal(input, init)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    return handle(url, init?.method ?? (input instanceof Request ? input.method : 'GET'), body)
  }
  window.EventSource = DemoEvents as unknown as typeof EventSource
  window.WebSocket = DemoSocket as unknown as typeof WebSocket
}
