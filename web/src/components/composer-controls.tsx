import { Brain, Camera } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSessionStream } from "@/hooks/use-session-stream"
import { api, type ModelInfo } from "@/lib/api"

const short: Record<string, string> = { off: "0", minimal: "MIN", low: "L", medium: "M", high: "H", xhigh: "XH", max: "MAX" }

/** Quick switches affect only the linked session, never creation defaults. */
export function ComposerControls({ sessionKey, onCamera, disabled }: { sessionKey?: string; onCamera: (files: File[]) => void; disabled?: boolean }) {
  const { state } = useSessionStream(sessionKey)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setModels([])
    if (!sessionKey) return
    let alive = true
    void api.session(sessionKey).then(({ session }) => api.models(session.harness)).then(({ models }) => { if (alive) setModels(models) }, () => {})
    return () => { alive = false }
  }, [sessionKey])
  const model = models.find((m) => m.id === state?.model?.id && m.provider === state?.model?.provider)
  const levels = model?.thinkingLevels ?? ["off"]
  const level = state?.thinkingLevel ?? "off"
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action() } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) }
  }
  return <>
    <select aria-label="Current session model" title="Current session model" className="h-8 min-w-0 max-w-40 rounded bg-transparent text-xs" disabled={disabled || busy || !sessionKey || !models.length} value={state?.model ? JSON.stringify([state.model.provider, state.model.id]) : ""} onChange={(e) => {
      const [provider, id] = JSON.parse(e.target.value)
      void change(() => api.setModel(sessionKey!, provider, id))
    }}>
      {!model && <option value={state?.model ? JSON.stringify([state.model.provider, state.model.id]) : ""}>{state?.model?.id ?? "Model"}</option>}
      {models.map((m) => <option key={`${m.provider}/${m.id}`} value={JSON.stringify([m.provider, m.id])}>{m.name}</option>)}
    </select>
    <div className="relative">
      <button type="button" className="flex h-8 items-center gap-1 rounded px-1 hover:bg-accent" aria-label={`Reasoning: ${level}`} aria-expanded={open} disabled={disabled || busy || !sessionKey || levels.length < 2} onClick={() => setOpen(!open)}><Brain className="size-4" /><span className="text-[10px]">{short[level] ?? level}</span></button>
      {open && <div className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded border bg-popover p-3 text-popover-foreground shadow" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}>
        <div className="mb-2 flex justify-between text-xs"><span>Reasoning: {level}</span><button type="button" aria-label="Close reasoning" onClick={() => setOpen(false)}>×</button></div>
        <input aria-label="Reasoning level" aria-valuetext={level} type="range" min={0} max={levels.length - 1} step={1} value={Math.max(0, levels.indexOf(level))} disabled={busy} className="w-full" onChange={(e) => void change(() => api.setThinking(sessionKey!, levels[Number(e.target.value)]))} />
        <div className="flex justify-between text-[10px]">{levels.map((l) => <span key={l}>{short[l] ?? l}</span>)}</div>
      </div>}
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onCamera(Array.from(e.target.files ?? [])); e.target.value = "" }} />
    <button type="button" disabled={disabled} className="grid size-8 shrink-0 place-items-center rounded hover:bg-accent" aria-label="Take photo" onClick={() => camera.current?.click()}><Camera className="size-4" /></button>
  </>
}

export function AgentToggle({ checked, onChange, disabled }: { checked: boolean; onChange?: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label="Send to agent too" disabled={disabled} onClick={() => onChange?.(!checked)} className="mr-auto flex shrink-0 items-center gap-1.5 text-xs"><span className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 ${checked ? "bg-primary" : "bg-muted-foreground"}`}><span className={`size-3 rounded-full bg-background transition-transform ${checked ? "translate-x-3" : ""}`} /></span>Agent</button>
}
