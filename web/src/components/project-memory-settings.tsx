import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { useProjects } from "@/lib/projects"

export function ProjectMemorySettings() {
  const { active: project, projects } = useProjects()
  const active = project?.id
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.projectMemory>>>()
  const [hours, setHours] = useState(0)
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
    void api.projectMemory(active).then(s => { if (alive) { setStatus(s); setHours(s.intervalHours) } }, e => toast.error(e.message))
    void api.memoryArchives(active).then(a => { if (alive) setArchives(a.sessions) }, e => toast.error(e.message))
    const timer = setInterval(() => { if (alive) void reload().catch(e => toast.error(e.message)) }, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [active])
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload() } catch (e) { toast.error((e as Error).message) } }
  if (!active) return <p>Select a project first.</p>
  return <div className="grid gap-3">
    <p className="text-sm">Memory for <strong>{projects.find(p => p.id === active)?.name}</strong>. Public sessions contribute; explicitly private sessions only read it. One-on-one sessions inactive for 24 hours are archived after consolidation unless marked Keep live.</p>
    <label className="grid gap-1 text-sm">Consolidate every N hours (0 = off; manual runs still available)
      <Input type="number" min={0} max={8760} value={hours} onChange={e => setHours(Number(e.target.value))} />
    </label>
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => void act(() => api.setMemorySchedule(active, hours))}>Save schedule</Button>
      <Button disabled={status?.running} onClick={() => void act(() => api.consolidateMemory(active))}>{status?.running ? "Consolidating…" : "Consolidate now"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Schedule and manual runs are managed by the project creator or an admin. Last successful run: {status?.lastRun ?? "Never"}</p>
    {status?.error && <p role="alert" className="text-sm text-destructive">{status.error}</p>}
    <details><summary>Master memory</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{status?.master || "No memory yet."}</pre></details>
    <details><summary>Archived sessions ({archives.length})</summary><div className="grid gap-2">{archives.map(s => <div key={s.key} className="flex items-center justify-between gap-2 text-sm"><span>{s.title}</span><Button variant="outline" size="sm" onClick={() => void act(() => api.sessionRetention(s.key, { archived: false }))}>Restore & keep live</Button></div>)}</div></details>
  </div>
}
