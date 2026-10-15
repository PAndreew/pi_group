import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelPicker, ThinkingPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type Harness, type ModelInfo, type SessionSummary } from "@/lib/api"

const LAST_KEY = "pi-group:last-model"

export function NewSessionDialog({
  folder,
  open,
  onOpenChange,
  onCreated,
}: {
  folder: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (session: SessionSummary) => void
}) {
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
      setHarness((h) => (h && harnesses.some((x) => x.id === h && x.ok) ? h : harnesses.find((x) => x.ok)?.id))
    })
  }, [open])

  useEffect(() => {
    if (!open || !harness) return
    setLoadingModels(true)
    api
      .models(harness)
      .then(({ models }) => {
        setModels(models)
        const last = JSON.parse(localStorage.getItem(`${LAST_KEY}:${harness}`) ?? "null")
        const pick = models.find((m) => m.provider === last?.provider && m.id === last?.id) ?? models[0]
        setModel(pick ? { provider: pick.provider, id: pick.id } : undefined)
      })
      .catch((error) => toast.error(`Could not list models: ${error.message}`))
      .finally(() => setLoadingModels(false))
  }, [open, harness])

  const create = async () => {
    if (!harness) return
    setCreating(true)
    try {
      if (model) localStorage.setItem(`${LAST_KEY}:${harness}`, JSON.stringify(model))
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
          <DialogTitle>New session</DialogTitle>
          <DialogDescription className="truncate">in /{folder}</DialogDescription>
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
          <div className="grid gap-2">
            <Label htmlFor="session-name">Name (optional)</Label>
            <Input id="session-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. refactor auth" />
          </div>
          <p className="text-xs text-muted-foreground">New sessions are private. Share them from the session menu.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!harness || creating}>
            {creating && <Loader2 className="animate-spin" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
