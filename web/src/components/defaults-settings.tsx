import { useLocale } from "@/lib/i18n"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelPicker, ThinkingPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { api, type Harness, type ModelInfo } from "@/lib/api"

/** The user's agent settings: runtime, provider, model and reasoning for new sessions, saved across devices. */
export function DefaultsSettings({ onClose }: { onClose: () => void }) {
  const { t: tr } = useLocale()
  const { user, saveDefaults } = useAuth()
  const defaults = user?.sessionDefaults
  const [autoTitle, setAutoTitle] = useState(defaults?.autoTitle ?? false)
  const [useModelPerMessage, setUseModelPerMessage] = useState(defaults?.useModelPerMessage ?? false)
  const [fallbackModel, setFallbackModel] = useState(defaults?.fallbackModel)
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [harness, setHarness] = useState<string>()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [model, setModel] = useState<{ provider: string; id: string }>()
  const [thinking, setThinking] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.harnesses().then(({ harnesses }) => {
      setHarnesses(harnesses)
      setHarness(harnesses.find((x) => x.id === defaults?.harness && x.ok)?.id ?? harnesses.find((x) => x.ok)?.id)
    }, (error) => toast.error(`Cannot load runtimes: ${error.message}`))
  }, [defaults?.harness])

  useEffect(() => {
    if (!harness) return
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
        const levels = pick?.thinkingLevels ?? ["off"]
        setThinking(levels.includes(saved?.thinkingLevel ?? "") ? saved!.thinkingLevel : levels.includes("medium") ? "medium" : levels[0])
      })
      .catch((error) => { if (!cancelled) toast.error(`Could not list models: ${error.message}`) })
      .finally(() => { if (!cancelled) setLoadingModels(false) })
    return () => { cancelled = true }
  }, [harness, defaults])

  const selected = harnesses.find((h) => h.id === harness)
  const levels = models.find((m) => m.provider === model?.provider && m.id === model?.id)?.thinkingLevels ?? ["off"]
  const pickModel = (next: { provider: string; id: string }) => {
    setModel(next)
    const supported = models.find((m) => m.provider === next.provider && m.id === next.id)?.thinkingLevels ?? ["off"]
    if (!supported.includes(thinking ?? "")) setThinking(supported.includes("medium") ? "medium" : supported[0])
  }
  const save = async () => {
    setSaving(true)
    try {
      await saveDefaults({ ...defaults, harness: harness!, model: model!, thinkingLevel: thinking!, autoTitle, useModelPerMessage, fallbackModel: useModelPerMessage ? fallbackModel : undefined })
      toast.success("Settings saved")
      onClose()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-sm text-muted-foreground">{tr("ui.the-agent-runtime-provider-model-an-f8b9af")}</p>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <Label>{tr("ui.runtime-c4740e")}</Label>
        <Select value={harness} onValueChange={(value) => { setHarness(value); setFallbackModel(undefined) }}>
          <SelectTrigger className="w-full" aria-label={tr("ui.runtime-c4740e")}>
            <SelectValue placeholder={tr("ui.runtime-c4740e")} />
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
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <Label>{tr("ui.provider-and-model-cf097a")}</Label>
        {loadingModels ? <Loader2 className="size-4 animate-spin" /> : <ModelPicker models={models} value={model} onChange={pickModel} showProvider />}
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
        <Label className="flex items-center gap-2"><input type="checkbox" checked={autoTitle} onChange={e => setAutoTitle(e.target.checked)} /> {tr("ui.automatically-generate-session-titl-6e4390")}</Label>
        <Label>{tr("ui.reasoning-e272c5")}</Label>
        <ThinkingPicker value={thinking} onChange={setThinking} levels={levels} disabled={loadingModels || levels.length < 2} />
      </div>
      <div className="grid gap-2">
        <Label className="flex items-center gap-2"><input type="checkbox" checked={useModelPerMessage} onChange={e => setUseModelPerMessage(e.target.checked)} /> {tr("ui.prefer-my-model-when-i-send-a-messa-489857")}</Label>
        <p className="text-xs text-muted-foreground">{tr("ui.applies-to-matching-runtimes-pi-rpc-60b12d")}</p>
        {useModelPerMessage && <>
          <Label>{tr("ui.fallback-model-optional-a941ac")}</Label>
          <ModelPicker models={models} value={fallbackModel} onChange={setFallbackModel} showProvider />
          {fallbackModel && <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setFallbackModel(undefined)}>{tr("ui.clear-fallback-00118d")}</Button>}
        </>}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {tr("ui.cancel-77dfd2")}
        </Button>
        <Button onClick={save} disabled={!harness || !model || !thinking || loadingModels || saving}>
          {saving && <Loader2 className="animate-spin" />} {tr("ui.save-efc007")}
        </Button>
      </div>
    </div>
  )
}
