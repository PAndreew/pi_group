import { Check, CircleDashed, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ThinkingPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, type ContextPolicy, type MemorySource, type MemoryTopic, type ModelInfo, type ProjectMemoryStatus } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"

const DEFAULTS = "defaults"
const key = (m?: { provider: string; id: string }) => (m ? `${m.provider}/${m.id}` : DEFAULTS)
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Where one source of the current (or last) run is: queued, in batch part n of m, done or failed. */
function SourceRow({ source }: { source: MemorySource }) {
  const nav = useNav()
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      {source.status === "done" ? <Check className="size-4 shrink-0 text-green-600" /> : source.status === "failed" ? <X className="size-4 shrink-0 text-destructive" /> : source.status === "extracting" ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <CircleDashed className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate" title={source.error ?? source.title}>{source.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {source.status === "extracting" ? `part ${source.part}/${source.parts}` : source.status === "failed" ? "failed" : source.status === "done" ? "done" : "queued"}
      </span>
      {source.worker && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => nav.openSession(source.worker!)}>Watch</Button>}
    </li>
  )
}

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
  const [hours, setHours] = useState(0)
  const [context, setContext] = useState<ContextPolicy>({ trimHours: 12, windowHours: 168 })
  const [models, setModels] = useState<ModelInfo[]>([])
  const [runtime, setRuntime] = useState<string>()
  const [model, setModel] = useState<{ provider: string; id: string }>()
  const [thinking, setThinking] = useState<string>()
  const [editing, setEditing] = useState<Partial<MemoryTopic>>()
  const [archives, setArchives] = useState<Awaited<ReturnType<typeof api.memoryArchives>>["sessions"]>([])
  const reload = async () => {
    if (!active) return
    const [s, a] = await Promise.all([api.projectMemory(active), api.memoryArchives(active)])
    setStatus(s); setArchives(a.sessions)
  }
  useEffect(() => {
    setStatus(undefined); setEditing(undefined)
    if (!active) return
    let alive = true
    void api.projectMemory(active).then(s => {
      if (!alive) return
      setStatus(s); setHours(s.intervalHours); setContext(s.context)
      setModel(s.model); setThinking(s.thinkingLevel)
    }, e => toast.error(e.message))
    void api.memoryArchives(active).then(a => { if (alive) setArchives(a.sessions) }, e => toast.error(e.message))
    void api.memoryModels().then(({ harness, models }) => { if (alive) { setModels(models); setRuntime(harness) } }, e => toast.error(e.message))
    const timer = setInterval(() => { if (alive) void reload().catch(e => toast.error(e.message)) }, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [active])
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload() } catch (e) { toast.error((e as Error).message) } }
  if (!active) return <p>Select a project first.</p>
  const levels = models.find(m => m.provider === model?.provider && m.id === model?.id)?.thinkingLevels ?? ["off"]
  const save = () => act(async () => {
    await api.setMemorySettings(active, { intervalHours: hours, context, model: model ? { ...model, thinkingLevel: thinking } : null })
    toast.success("Memory settings saved")
  })
  const pick = (next: ModelInfo) => {
    setModel({ provider: next.provider, id: next.id })
    const supported = next.thinkingLevels ?? ["off"]
    if (!supported.includes(thinking ?? "")) setThinking(supported.includes("low") ? "low" : supported[0])
  }
  const done = status?.sources.filter(s => s.status === "done").length ?? 0
  const maxTopics = status?.maxTopics ?? 10
  const edit = (slug: string) => act(async () => setEditing(await api.memoryTopic(active, slug)))
  const saveTopic = (slug: string, t: TopicInput) => void act(async () => { await api.saveMemoryTopic(active, slug, t); setEditing(undefined) })
  const removeTopic = (slug: string) => { if (confirm(`Delete the memory topic "${slug}"?`)) void act(() => api.deleteMemoryTopic(active, slug)) }
  return <div className="grid gap-3">
    <p className="text-sm">Memory for <strong>{projects.find(p => p.id === active)?.name}</strong>, kept as up to {maxTopics} topics that fit the project, such as design and business, or itinerary and budget. Agents only get the list of topics and read the ones their task needs. Each run reads new or changed conversations: what people said and the agents' reasoning and answers, without tool output. It sorts that into the topics, adding, merging or removing topics as the project changes. Anyone in the project can edit topics too. Public sessions contribute; private sessions can read memory but don't add to it. One-on-one sessions inactive for 24 hours are archived after consolidation unless marked Keep live.</p>
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label>Topics ({status?.topics.length ?? 0}/{maxTopics})</Label>
        <Button variant="outline" size="sm" className="ml-auto h-7" disabled={!status || status.running || status.topics.length >= maxTopics || Boolean(editing)} onClick={() => setEditing({})}><Plus className="size-3.5" /> New topic</Button>
      </div>
      {status?.legacy && <p className="text-xs text-muted-foreground">Agents still get the memory from before topics. The next run splits it into topics.</p>}
      {editing && !editing.slug && <TopicEditor topic={editing} max={status?.topicMax ?? 8000} onSave={saveTopic} onCancel={() => setEditing(undefined)} />}
      {status && !status.topics.length && !editing && <p className="text-sm text-muted-foreground">No topics yet.</p>}
      <ul className="grid gap-1">{status?.topics.map(t => <li key={t.slug}>
        {editing?.slug === t.slug ? <TopicEditor topic={editing} max={status.topicMax} onSave={saveTopic} onCancel={() => setEditing(undefined)} /> : <div className="flex min-w-0 items-start gap-1 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate"><strong>{t.title}</strong> <span className="text-xs text-muted-foreground">{t.slug} · {t.size} chars · {new Date(t.updatedAt).toLocaleDateString()}</span></div>
            <div className="truncate text-xs text-muted-foreground" title={t.description}>{t.description}</div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.title}`} disabled={status.running || Boolean(editing)} onClick={() => void edit(t.slug)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.title}`} disabled={status.running} onClick={() => removeTopic(t.slug)}><Trash2 /></Button>
        </div>}
      </li>)}</ul>
    </div>
    <label className="grid gap-1 text-sm">Consolidate every N hours (0 = off)
      <Input type="number" min={0} max={8760} value={hours} onChange={e => setHours(Number(e.target.value))} />
    </label>
    <div className="grid min-w-0 gap-2">
      <Label>Consolidation model</Label>
      <Select value={key(model)} onValueChange={(next) => { if (next === DEFAULTS) return setModel(undefined); const picked = models.find(m => key(m) === next); if (picked) pick(picked) }}>
        <SelectTrigger className="w-full" aria-label="Consolidation model"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULTS}>Same as the consolidating person's defaults</SelectItem>
          {model && !models.some(m => key(m) === key(model)) && <SelectItem value={key(model)}>{key(model)} (not available now)</SelectItem>}
          {models.map(m => <SelectItem key={key(m)} value={key(m)}>{m.provider} · {m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {model && <ThinkingPicker value={thinking} onChange={setThinking} levels={levels} disabled={levels.length < 2} />}
      <p className="text-xs text-muted-foreground">A smaller, cheaper model is usually enough. Each worker reads about 40,000 characters of conversation and edits the topic files. Workers run on {runtime === "pi-durable" ? "pi durable, so an interrupted run resumes after a restart" : runtime ?? "the default runtime"}.</p>
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
      <Button disabled={status?.running} onClick={() => void act(() => api.consolidateMemory(active))}>{status?.running ? `Consolidating${status.batches ? ` ${status.batch}/${status.batches}` : ""}…` : "Consolidate now"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Settings and runs are managed by the project creator or an admin. Last successful run: {status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Never"}</p>
    {status?.error && <p role="alert" className="text-sm text-destructive">{status.error}</p>}
    {!!status?.sources.length && <details open={status.running}>
      <summary className="text-sm">{status.running ? "Current run" : "Last run"}: {done}/{status.sources.length} conversations{status.running && status.batches ? ` · batch ${status.batch}/${status.batches}` : ""}</summary>
      <ul className="mt-2 grid max-h-56 gap-1 overflow-y-auto">{status.sources.map(s => <SourceRow key={s.id} source={s} />)}</ul>
    </details>}
    <details><summary className="text-sm">Archived sessions ({archives.length})</summary><div className="grid gap-2">{archives.map(s => <div key={s.key} className="flex items-center justify-between gap-2 text-sm"><span>{s.title}</span><Button variant="outline" size="sm" onClick={() => void act(() => api.sessionRetention(s.key, { archived: false }))}>Restore & keep live</Button></div>)}</div></details>
  </div>
}
