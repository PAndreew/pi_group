import { useLocale } from "@/lib/i18n"
import { Archive, Brain, Loader2, Pencil, Plus, Scissors, Timer, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api, type ContextPolicy, type MemoryTopic, type ProjectMemoryStatus } from "@/lib/api"
import { useProjects } from "@/lib/projects"
import { MemoryModelSettingsPanel } from "@/components/memory-model-settings"
import { Section } from "@/components/ui/section"

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

type TopicInput = { title: string; description: string; body: string }

/** Edit one topic, or create one when `topic` has no slug yet. */
function TopicEditor({ topic, max, onSave, onCancel }: { topic: Partial<MemoryTopic>; max: number; onSave: (slug: string, t: TopicInput) => void; onCancel: () => void }) {
  const { t: tr } = useLocale()
  const [slug, setSlug] = useState(topic.slug ?? "")
  const [title, setTitle] = useState(topic.title ?? "")
  const [description, setDescription] = useState(topic.description ?? "")
  const [body, setBody] = useState(topic.body ?? "")
  const valid = SLUG.test(slug) && title.trim() && description.trim() && body.trim() && body.length <= max
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-md border p-2">
    {!topic.slug && <Input placeholder={tr("ui.name-e-g-budget-e82a93")} value={slug} maxLength={40} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} aria-label={tr("ui.topic-name-edd8ba")} />}
    <Input placeholder={tr("ui.title-768e0c")} value={title} maxLength={80} onChange={e => setTitle(e.target.value)} aria-label={tr("ui.title-768e0c")} />
    <Input placeholder={tr("ui.one-line-what-this-topic-covers-0e1331")} value={description} maxLength={300} onChange={e => setDescription(e.target.value)} aria-label={tr("ui.description-55f8eb")} />
    <Textarea className="min-h-40 font-mono text-xs" value={body} onChange={e => setBody(e.target.value)} aria-label={tr("ui.content-4f9be0")} />
    <div className="flex items-center gap-2">
      <span className={`text-xs ${body.length > max ? "text-destructive" : "text-muted-foreground"}`}>{body.length}/{max}</span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>{tr("ui.cancel-77dfd2")}</Button>
      <Button size="sm" disabled={!valid} onClick={() => onSave(slug, { title, description, body })}>{tr("ui.save-efc007")}</Button>
    </div>
  </div>
}

export function ProjectMemorySettings() {
  const { t: tr } = useLocale()
  const { active: project, projects } = useProjects()
  const active = project?.id
  const [status, setStatus] = useState<ProjectMemoryStatus>()
  const [overview, setOverview] = useState<string>()
  const [context, setContext] = useState<ContextPolicy>({ trimHours: 12, windowHours: 168 })
  const [editing, setEditing] = useState<Partial<MemoryTopic>>()
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
  const save = () => act(async () => {
    await api.setMemorySettings(active!, { context })
    toast.success("Memory settings saved")
  })
  const saveOverview = () => void act(async () => { await api.saveMemoryOverview(active!, overview ?? ""); setOverview(undefined) })
  const maxTopics = status?.maxTopics ?? 10
  const edit = (slug: string) => act(async () => setEditing(await api.memoryTopic(active!, slug)))
  const saveTopic = (slug: string, t: TopicInput) => void act(async () => { await api.saveMemoryTopic(active!, slug, t); setEditing(undefined) })
  const removeTopic = (slug: string) => { if (confirm(`Delete the memory topic "${slug}"?`)) void act(() => api.deleteMemoryTopic(active!, slug)) }
  const projectName = projects.find(p => p.id === active)?.name
  if (!active) return <Section title={tr("ui.project-memory-b75fca")} icon={<Brain />}><p className="text-sm">{tr("ui.select-a-project-first-7e3fa0")}</p></Section>
  return <>
    <Section title={tr("ui.project-memory-b75fca")} hint={`${projectName ?? "Project"} · ${status?.topics.length ?? 0}/${maxTopics} topics`} icon={<Brain />}>
      <p className="text-sm">{tr("memory.description", { project: projectName ?? "", count: maxTopics })}</p>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-center gap-2">
          <Label>{tr("ui.overview-0efc2e")}</Label>
          {overview === undefined && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={tr("ui.edit-overview-c2098e")} onClick={() => setOverview(status?.overview ?? "")}><Pencil /></Button>}
        </div>
        {overview === undefined ? <p className="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">{status?.overview || "No overview yet."}</p> : <div className="grid gap-2">
          <Textarea className="min-h-24 text-sm" value={overview} maxLength={status?.overviewMax ?? 1500} onChange={e => setOverview(e.target.value)} aria-label={tr("ui.overview-0efc2e")} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{overview.length}/{status?.overviewMax ?? 1500}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOverview(undefined)}>{tr("ui.cancel-77dfd2")}</Button>
            <Button size="sm" onClick={saveOverview}>{tr("ui.save-efc007")}</Button>
          </div>
        </div>}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label>{tr("ui.topics-39becc")}{status?.topics.length ?? 0}/{maxTopics})</Label>
          <Button variant="outline" size="sm" className="ml-auto h-7" disabled={!status || status.topics.length >= maxTopics || Boolean(editing)} onClick={() => setEditing({})}><Plus className="size-3.5" /> {tr("ui.new-topic-b4e4a9")}</Button>
        </div>
        {status?.legacy && <p className="text-xs text-muted-foreground">{tr("ui.agents-still-get-the-memory-from-be-5db449")}</p>}
        {editing && !editing.slug && <TopicEditor topic={editing} max={status?.topicMax ?? 8000} onSave={saveTopic} onCancel={() => setEditing(undefined)} />}
        {status && !status.topics.length && !editing && <p className="text-sm text-muted-foreground">{tr("ui.no-topics-yet-6f6d4e")}</p>}
        <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">{status?.topics.map(t => <li key={t.slug} className="min-w-0">
          {editing?.slug === t.slug ? <TopicEditor topic={editing} max={status.topicMax} onSave={saveTopic} onCancel={() => setEditing(undefined)} /> : <div className="flex min-w-0 items-start gap-1 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate"><strong>{t.title}</strong></div>
              <div className="truncate text-xs text-muted-foreground">{t.slug} · {t.size} {tr("ui.chars-b2b004")} {new Date(t.updatedAt).toLocaleDateString()}</div>
              <div className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground" title={t.description}>{t.description}</div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${t.title}`} disabled={Boolean(editing)} onClick={() => void edit(t.slug)}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.title}`} onClick={() => removeTopic(t.slug)}><Trash2 /></Button>
          </div>}
        </li>)}</ul>
      </div>
      <p className="text-xs text-muted-foreground">{tr("ui.last-memory-update-188384")} {status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Never"}{status?.nextSync && !status.syncing ? ` · next sync ${new Date(status.nextSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
      {status?.syncing && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 shrink-0 animate-spin" />{tr("ui.syncing-memory-from-the-latest-conv-413b6a")}</p>}
      {status?.error && <p role="alert" className="text-sm wrap-anywhere text-destructive">{status.error}</p>}
    </Section>
    <Section title={tr("ui.agent-context-80a5fb")} hint={`Trim after ${context.trimHours || "∞"} h · show last ${context.windowHours || "all"} h`} icon={<Scissors />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{tr("ui.trim-turns-after-n-hours-0-never-e9d1bb")}
          <Input type="number" min={0} max={8760} value={context.trimHours} onChange={e => setContext({ ...context, trimHours: Number(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm">{tr("ui.show-last-n-hours-0-all-e4b717")}
          <Input type="number" min={0} max={87600} value={context.windowHours} onChange={e => setContext({ ...context, windowHours: Number(e.target.value) })} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{tr("ui.saves-tokens-in-long-conversations--31a71a")}</p>
      <div><Button variant="outline" size="sm" onClick={() => void save()}>{tr("ui.save-context-settings-c19b35")}</Button></div>
    </Section>
    <Section title={tr("ui.memory-sync-model-66d012")} hint={tr("ui.hourly-sync-cheapest-model-per-prov-d78642")} icon={<Timer />}>
      <MemoryModelSettingsPanel />
    </Section>
    <Section title={tr("ui.archived-sessions-1d73b5")} hint={`${archives.length} archived`} icon={<Archive />}>
      <p className="text-xs text-muted-foreground">{tr("ui.one-on-one-sessions-inactive-for-24-03c33c")}</p>
      {!archives.length && <p className="text-sm text-muted-foreground">{tr("ui.none-9a9707")}</p>}
      <div className="grid gap-2">{archives.map(s => <div key={s.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{s.title}</span><Button variant="outline" size="sm" onClick={() => void act(() => api.sessionRetention(s.key, { archived: false }))}>{tr("ui.restore-keep-live-46e43e")}</Button></div>)}</div>
    </Section>
  </>
}
