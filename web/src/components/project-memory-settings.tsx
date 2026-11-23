import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api, type ContextPolicy, type MemoryTopic, type ProjectMemoryStatus } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"
import { MemoryCacheSettingsPanel } from "@/components/memory-cache-settings"

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

type TopicInput = { title: string; description: string; body: string }

/** Edit one topic, or create one when `topic` has no slug yet. */
function TopicEditor({ topic, max, onSave, onCancel }: { topic: Partial<MemoryTopic>; max: number; onSave: (slug: string, t: TopicInput) => void; onCancel: () => void }) {
  const [slug, setSlug] = useState(topic.slug ?? "")
  const [title, setTitle] = useState(topic.title ?? "")
  const [description, setDescription] = useState(topic.description ?? "")
  const [body, setBody] = useState(topic.body ?? "")
  const valid = SLUG.test(slug) && title.trim() && description.trim() && body.trim() && body.length <= max
  return <div className="grid gap-2 rounded-md border p-2">
    {!topic.slug && <Input placeholder="Name, e.g. budget" value={slug} maxLength={40} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} aria-label="Topic name" />}
    <Input placeholder="Title" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} aria-label="Title" />
    <Input placeholder="One line: what this topic covers" value={description} maxLength={300} onChange={e => setDescription(e.target.value)} aria-label="Description" />
    <Textarea className="min-h-40 font-mono text-xs" value={body} onChange={e => setBody(e.target.value)} aria-label="Content" />
    <div className="flex items-center gap-2">
      <span className={`text-xs ${body.length > max ? "text-destructive" : "text-muted-foreground"}`}>{body.length}/{max}</span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>Cancel</Button>
      <Button size="sm" disabled={!valid} onClick={() => onSave(slug, { title, description, body })}>Save</Button>
    </div>
  </div>
}

export function ProjectMemorySettings() {
  const { active: project, projects } = useProjects()
  const active = project?.id
  const [status, setStatus] = useState<ProjectMemoryStatus>()
  const [overview, setOverview] = useState<string>()
  const [context, setContext] = useState<ContextPolicy>({ trimHours: 12, windowHours: 168 })
  const [editing, setEditing] = useState<Partial<MemoryTopic>>()
  const nav = useNav()
  const [archives, setArchives] = useState<Awaited<ReturnType<typeof api.memoryArchives>>["sessions"]>([])
  const reload = async () => {
    if (!active) return
    const [s, a] = await Promise.all([api.projectMemory(active), api.memoryArchives(active)])
    setStatus(s); setArchives(a.sessions)
  }
  useEffect(() => {
    setStatus(undefined); setEditing(undefined); setOverview(undefined)
    if (!active) return
    let alive = true
    void api.projectMemory(active).then(s => {
      if (!alive) return
      setStatus(s); setContext(s.context)
    }, e => toast.error(e.message))
    void api.memoryArchives(active).then(a => { if (alive) setArchives(a.sessions) }, e => toast.error(e.message))
    const timer = setInterval(() => { if (alive) void reload().catch(e => toast.error(e.message)) }, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [active])
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload() } catch (e) { toast.error((e as Error).message) } }
  if (!active) return <p>Select a project first.</p>
  const save = () => act(async () => {
    await api.setMemorySettings(active, { context })
    toast.success("Memory settings saved")
  })
  const saveOverview = () => void act(async () => { await api.saveMemoryOverview(active, overview ?? ""); setOverview(undefined) })
  const maxTopics = status?.maxTopics ?? 10
  const edit = (slug: string) => act(async () => setEditing(await api.memoryTopic(active, slug)))
  const saveTopic = (slug: string, t: TopicInput) => void act(async () => { await api.saveMemoryTopic(active, slug, t); setEditing(undefined) })
  const removeTopic = (slug: string) => { if (confirm(`Delete the memory topic "${slug}"?`)) void act(() => api.deleteMemoryTopic(active, slug)) }
  return <div className="grid gap-3">
    <p className="text-sm">Memory for <strong>{projects.find(p => p.id === active)?.name}</strong>: a short overview plus up to {maxTopics} topics that fit the project, such as design and marketing, or itinerary and budget. Agents get the overview and the list of topics, and read the topics their task needs. Memory updates itself: when a session or group chat you worked in goes quiet, just before its prompt cache expires, its agent folds what the conversation added into the topics while it is still cached (cheap), adding or merging topics as the project changes. Older sessions and chats are not swept up. Anyone in the project can edit memory too. Private sessions read memory but never add to it. One-on-one sessions inactive for 24 hours are archived once their memory is up to date, unless marked Keep live.</p>
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label>Overview</Label>
        {overview === undefined && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Edit overview" onClick={() => setOverview(status?.overview ?? "")}><Pencil /></Button>}
      </div>
      {overview === undefined ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{status?.overview || "No overview yet."}</p> : <div className="grid gap-2">
        <Textarea className="min-h-24 text-sm" value={overview} maxLength={status?.overviewMax ?? 1500} onChange={e => setOverview(e.target.value)} aria-label="Overview" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{overview.length}/{status?.overviewMax ?? 1500}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOverview(undefined)}>Cancel</Button>
          <Button size="sm" onClick={saveOverview}>Save</Button>
        </div>
      </div>}
    </div>
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label>Topics ({status?.topics.length ?? 0}/{maxTopics})</Label>
        <Button variant="outline" size="sm" className="ml-auto h-7" disabled={!status || status.topics.length >= maxTopics || Boolean(editing)} onClick={() => setEditing({})}><Plus className="size-3.5" /> New topic</Button>
      </div>
      {status?.legacy && <p className="text-xs text-muted-foreground">Agents still get the memory from before topics. The next memory update splits it into topics.</p>}
      {editing && !editing.slug && <TopicEditor topic={editing} max={status?.topicMax ?? 8000} onSave={saveTopic} onCancel={() => setEditing(undefined)} />}
      {status && !status.topics.length && !editing && <p className="text-sm text-muted-foreground">No topics yet.</p>}
      <ul className="grid gap-1">{status?.topics.map(t => <li key={t.slug}>
        {editing?.slug === t.slug ? <TopicEditor topic={editing} max={status.topicMax} onSave={saveTopic} onCancel={() => setEditing(undefined)} /> : <div className="flex min-w-0 items-start gap-1 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate"><strong>{t.title}</strong> <span className="text-xs text-muted-foreground">{t.slug} · {t.size} chars · {new Date(t.updatedAt).toLocaleDateString()}</span></div>
            <div className="truncate text-xs text-muted-foreground" title={t.description}>{t.description}</div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.title}`} disabled={Boolean(editing)} onClick={() => void edit(t.slug)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.title}`} onClick={() => removeTopic(t.slug)}><Trash2 /></Button>
        </div>}
      </li>)}</ul>
    </div>
    <div className="grid gap-2">
      <Label>Agent context</Label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm">Trim turns after N hours (0 = never)
          <Input type="number" min={0} max={8760} value={context.trimHours} onChange={e => setContext({ ...context, trimHours: Number(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm">Show last N hours (0 = all)
          <Input type="number" min={0} max={87600} value={context.windowHours} onChange={e => setContext({ ...context, windowHours: Number(e.target.value) })} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Saves tokens in long conversations. Once a turn is older than the trim time, agents no longer see its reasoning, and each tool call and result shrinks to one line. When an agent picks up a conversation, it sees only the last N hours. It can read everything else with its session_history tool. The full conversation stays stored and visible here.</p>
    </div>
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => void save()}>Save settings</Button>
    </div>
    <p className="text-xs text-muted-foreground">Context settings are managed by the project creator or an admin. Last memory update: {status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Never"}</p>
    {!!status?.updating.length && <ul className="grid gap-1">{status.updating.map(u => <li key={u.key} className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /><span className="min-w-0 flex-1 truncate">Updating memory from “{u.title}”</span><Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => nav.openSession(u.key)}>Open</Button></li>)}</ul>}
    {status?.error && <p role="alert" className="text-sm text-destructive">{status.error}</p>}
    <MemoryCacheSettingsPanel />
    <details><summary className="text-sm">Archived sessions ({archives.length})</summary><div className="grid gap-2">{archives.map(s => <div key={s.key} className="flex items-center justify-between gap-2 text-sm"><span>{s.title}</span><Button variant="outline" size="sm" onClick={() => void act(() => api.sessionRetention(s.key, { archived: false }))}>Restore & keep live</Button></div>)}</div></details>
  </div>
}
