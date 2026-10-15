import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelPicker, ThinkingPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { api, type Harness, type ModelInfo, type SessionSummary } from "@/lib/api"

export function NewSessionDialog({
  folder,
  open,
  onOpenChange,
  onCreated,
  defaultsOnly = false,
}: {
  folder: string
  defaultsOnly?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (session: SessionSummary) => void
}) {
  const { user, saveDefaults } = useAuth()
  const defaults = user?.sessionDefaults
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [harness, setHarness] = useState<string>()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [model, setModel] = useState<{ provider: string; id: string }>()
  const [thinking, setThinking] = useState<string>()
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setName("")
    api.harnesses().then(({ harnesses }) => {
      setHarnesses(harnesses)
      setHarness(harnesses.find((x) => x.id === defaults?.harness && x.ok)?.id ?? harnesses.find((x) => x.ok)?.id)
    })
  }, [open, defaults?.harness])

  useEffect(() => {
    if (!open || !harness) return
    let cancelled = false
    setLoadingModels(true)
    setModel(undefined)
    api
      .models(harness)
      .then(({ models }) => {
        if (cancelled) return
        setModels(models)
        const saved = defaults?.harness === harness ? defaults : undefined
        const pick = models.find((m) => m.provider === saved?.model.provider && m.id === saved?.model.id) ?? models[0]
        setModel(pick ? { provider: pick.provider, id: pick.id } : undefined)
        setThinking(saved?.thinkingLevel ?? "medium")
      })
      .catch((error) => { if (!cancelled) toast.error(`Could not list models: ${error.message}`) })
      .finally(() => { if (!cancelled) setLoadingModels(false) })
    return () => { cancelled = true }
  }, [open, harness, defaults])

  const create = async () => {
    if (!harness) return
    setCreating(true)
    try {
      const { session } = await api.createSession({ harness, path: folder, name: name.trim() || undefined, model, thinkingLevel: thinking })
      onCreated(session)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const selected = harnesses.find((h) => h.id === harness)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{defaultsOnly ? "Session defaults" : "New session"}</DialogTitle>
          <DialogDescription className="truncate">{defaultsOnly ? "Your default provider, model and thinking level, saved across devices." : `in /${folder}`}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Harness</Label>
            <Select value={harness} onValueChange={setHarness}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Harness" />
              </SelectTrigger>
              <SelectContent>
                {harnesses.map((h) => (
                  <SelectItem key={h.id} value={h.id} disabled={!h.ok}>
                    {h.label}
                    {h.durable ? " · durable" : ""}
                    {!h.ok ? " (unavailable)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && <p className="text-xs text-muted-foreground">{selected.ok ? selected.description : selected.reason}</p>}
          </div>
          <div className="grid gap-2">
            <Label>Model</Label>
            {loadingModels ? <Loader2 className="size-4 animate-spin" /> : <ModelPicker models={models} value={model} onChange={setModel} />}
          </div>
          <div className="grid gap-2">
            <Label>Thinking</Label>
            <ThinkingPicker value={thinking} onChange={setThinking} />
          </div>
          {!defaultsOnly && <div className="grid gap-2">
            <Label htmlFor="session-name">Name (optional)</Label>
            <Input id="session-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. refactor auth" />
          </div>}
          <Button variant="outline" disabled={!harness || !model || !thinking || loadingModels} onClick={async () => {
            try {
              await saveDefaults({ harness: harness!, model: model!, thinkingLevel: thinking! })
              toast.success("Default provider, model and thinking level saved")
              if (defaultsOnly) onOpenChange(false)
            } catch (error) { toast.error((error as Error).message) }
          }}>Save as my defaults</Button>
          <p className="text-xs text-muted-foreground">New sessions are private. Share them from the session menu.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!defaultsOnly && <Button onClick={create} disabled={!harness || creating || loadingModels}>
            {creating && <Loader2 className="animate-spin" />} Create
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
