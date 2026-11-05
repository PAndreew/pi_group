import { Check, CircleDashed, Loader2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelPicker, ThinkingPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type Harness, type MemorySource, type ModelInfo, type ProjectMemoryStatus } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"

const DEFAULTS = "defaults"

/** Where one source of the current (or last) run is: queued, extracting part n of m, done or failed. */
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

export function ProjectMemorySettings() {
  const { active: project, projects } = useProjects()
  const active = project?.id
  const [status, setStatus] = useState<ProjectMemoryStatus>()
  const [hours, setHours] = useState(0)
  const [concurrency, setConcurrency] = useState(3)
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [harness, setHarness] = useState(DEFAULTS)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState<{ provider: string; id: string }>()
  const [thinking, setThinking] = useState<string>()
  const [archives, setArchives] = useState<Awaited<ReturnType<typeof api.memoryArchives>>["sessions"]>([])
  const reload = async () => {
    if (!active) return
    const [s, a] = await Promise.all([api.projectMemory(active), api.memoryArchives(active)])
    setStatus(s); setArchives(a.sessions)
  }
  useEffect(() => {
    setStatus(undefined)
    if (!active) return
    let alive = true
    void api.projectMemory(active).then(s => {
      if (!alive) return
      setStatus(s); setHours(s.intervalHours); setConcurrency(s.concurrency)
      setHarness(s.harness ?? DEFAULTS); setModel(s.model); setThinking(s.thinkingLevel)
    }, e => toast.error(e.message))
    void api.memoryArchives(active).then(a => { if (alive) setArchives(a.sessions) }, e => toast.error(e.message))
    void api.harnesses().then(({ harnesses }) => { if (alive) setHarnesses(harnesses) }, () => {})
    const timer = setInterval(() => { if (alive) void reload().catch(e => toast.error(e.message)) }, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [active])
  useEffect(() => {
    if (harness === DEFAULTS) return setModels([])
    let alive = true
    void api.models(harness).then(({ models }) => { if (alive) setModels(models) }, e => toast.error(e.message))
    return () => { alive = false }
  }, [harness])
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload() } catch (e) { toast.error((e as Error).message) } }
  if (!active) return <p>Select a project first.</p>
  const levels = models.find(m => m.provider === model?.provider && m.id === model?.id)?.thinkingLevels ?? ["off"]
  const save = () => act(async () => {
    await api.setMemorySettings(active, { intervalHours: hours, concurrency, model: harness === DEFAULTS || !model ? null : { harness, ...model, thinkingLevel: thinking } })
    toast.success("Memory settings saved")
  })
  const done = status?.sources.filter(s => s.status === "done").length ?? 0
  return <div className="grid gap-3">
    <p className="text-sm">Memory for <strong>{projects.find(p => p.id === active)?.name}</strong>. Each new or changed conversation is extracted on its own, in parallel, into a timestamped snapshot; the snapshots are then merged into the master. Public sessions contribute; explicitly private sessions only read it. One-on-one sessions inactive for 24 hours are archived after consolidation unless marked Keep live.</p>
    <div className="grid grid-cols-2 gap-3">
      <label className="grid gap-1 text-sm">Every N hours (0 = off)
        <Input type="number" min={0} max={8760} value={hours} onChange={e => setHours(Number(e.target.value))} />
      </label>
      <label className="grid gap-1 text-sm">Conversations at once
        <Input type="number" min={1} max={8} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} />
      </label>
    </div>
    <div className="grid min-w-0 gap-2">
      <Label>Consolidation model</Label>
      <Select value={harness} onValueChange={(next) => { setHarness(next); setModel(undefined) }}>
        <SelectTrigger className="w-full" aria-label="Consolidation runtime"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULTS}>Same as the consolidating person's defaults</SelectItem>
          {harnesses.map(h => <SelectItem key={h.id} value={h.id} disabled={!h.ok}>{h.label}{!h.ok ? " (unavailable)" : ""}</SelectItem>)}
        </SelectContent>
      </Select>
      {harness !== DEFAULTS && <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ModelPicker models={models} value={model} onChange={(next) => { setModel(next); const supported = models.find(m => m.provider === next.provider && m.id === next.id)?.thinkingLevels ?? ["off"]; if (!supported.includes(thinking ?? "")) setThinking(supported.includes("low") ? "low" : supported[0]) }} showProvider />
        <ThinkingPicker value={thinking} onChange={setThinking} levels={levels} disabled={levels.length < 2} />
      </div>}
      <p className="text-xs text-muted-foreground">A smaller, cheaper model is usually enough: it only reads one part of one conversation at a time.</p>
    </div>
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => void save()} disabled={harness !== DEFAULTS && !model}>Save settings</Button>
      <Button disabled={status?.running} onClick={() => void act(() => api.consolidateMemory(active))}>{status?.running ? (status.phase === "merge" ? "Merging…" : "Extracting…") : "Consolidate now"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Settings and runs are managed by the project creator or an admin. Last successful run: {status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Never"}</p>
    {status?.error && <p role="alert" className="text-sm text-destructive">{status.error}</p>}
    {!!status?.sources.length && <details open={status.running}>
      <summary className="text-sm">{status.running ? "Current run" : "Last run"}: {done}/{status.sources.length} conversations{status.phase === "merge" ? " · merging" : ""}</summary>
      <ul className="mt-2 grid max-h-56 gap-1 overflow-y-auto">{status.sources.map(s => <SourceRow key={s.id} source={s} />)}</ul>
    </details>}
    <details><summary className="text-sm">Master memory</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{status?.master || "No memory yet."}</pre></details>
    <details><summary className="text-sm">Archived sessions ({archives.length})</summary><div className="grid gap-2">{archives.map(s => <div key={s.key} className="flex items-center justify-between gap-2 text-sm"><span>{s.title}</span><Button variant="outline" size="sm" onClick={() => void act(() => api.sessionRetention(s.key, { archived: false }))}>Restore & keep live</Button></div>)}</div></details>
  </div>
}
