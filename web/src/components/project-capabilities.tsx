import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type Project, type ToolCapability } from "@/lib/api"

export function ProjectCapabilities({ project, onClose }: { project: Project; onClose: () => void }) {
  const [capabilities, setCapabilities] = useState<ToolCapability[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let alive = true
    void api.projectCapabilities(project.id).then(result => {
      if (alive) { setCapabilities(result.capabilities); setLoading(false) }
    }, error => { if (alive) { setError(error.message); setLoading(false) } })
    return () => { alive = false }
  }, [project.id])
  const change = async (capability: ToolCapability, access: ToolCapability["access"]) => {
    setBusy(true)
    try {
      await api.setProjectCapability(project.id, capability.id, access)
      setCapabilities(items => items.map(item => item.id === capability.id ? { ...item, access } : item))
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{project.name}: tools & connections</DialogTitle>
        <DialogDescription>Approve once for this project. Agents and scheduled agent tasks use enabled tools without asking again. Off blocks subsequent calls; already-running operations may finish. Shell isolation stays in place.</DialogDescription>
      </DialogHeader>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto">
        {capabilities.map(capability => <section key={capability.id} className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`cap-${capability.id}`} className="font-medium">{capability.name}</label>
            <select id={`cap-${capability.id}`} className="rounded border bg-background px-2 py-1 text-sm" value={capability.access} disabled={busy || !project.canManageTools} onChange={e => void change(capability, e.target.value as ToolCapability["access"])}>
              <option value="off">Off</option>
              {capability.supportsRead && <option value="read">On · Read-only</option>}
              {capability.supportsWrite && <option value="write">{capability.supportsRead ? "On · Read & write" : "On"}</option>}
            </select>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{capability.description}</p>
          <details className="mt-2 text-xs text-muted-foreground"><summary>Included tools</summary>
            <ul className="mt-1 space-y-1">{capability.tools.map(tool => <li key={tool.name}>{tool.name} · {tool.access}</li>)}</ul>
          </details>
        </section>)}
      </div>
      <p className="text-xs text-muted-foreground">MCP servers from your Pi configuration are on unless turned off here. Other tools must be registered by an administrator; unknown tools remain blocked. Files and shell commands always stay inside this project's folders.</p>
    </DialogContent>
  </Dialog>
}
