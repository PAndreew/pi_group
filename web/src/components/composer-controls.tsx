import { Brain, Camera } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { useSessionStream } from "@/hooks/use-session-stream"
import { api, type ModelInfo } from "@/lib/api"

const short: Record<string, string> = { off: "0", minimal: "MIN", low: "L", medium: "M", high: "H", xhigh: "XH", max: "MAX" }

export interface ComposerConfig { model?: { provider: string; id: string }; thinkingLevel?: string }

/** Quick switches affect only the linked session, never creation defaults. */
export function ComposerControls({ sessionKey, onCamera, disabled, agentEnabled = true, draft, onDraftChange }: { agentEnabled?: boolean; sessionKey?: string; draft?: ComposerConfig; onDraftChange?: (config: ComposerConfig) => void; onCamera: (files: File[]) => void; disabled?: boolean }) {
  const { user } = useAuth()
  const { state: liveState } = useSessionStream(sessionKey)
  const state = sessionKey ? liveState : draft
  const [harness, setHarness] = useState<string>()
  useEffect(() => {
    if (sessionKey) return
    void api.harnesses().then(({ harnesses }) => {
      setHarness(harnesses.find((h) => h.ok && h.id === user?.sessionDefaults?.harness)?.id ?? harnesses.find((h) => h.ok)?.id)
    }, (error) => toast.error(`Cannot load providers: ${error.message}`))
  }, [sessionKey, user?.sessionDefaults?.harness])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const reasoning = useRef<HTMLButtonElement>(null)
  const [popupPosition, setPopupPosition] = useState({ left: 0, bottom: 0, width: 320 })
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const box = reasoning.current?.closest("[data-composer-box]")?.getBoundingClientRect()
      if (!box) return
      const width = Math.min(320, box.width - 16, window.innerWidth - 16)
      setPopupPosition({ width, left: Math.max(8, Math.min(window.innerWidth - width - 8, box.left + (box.width - width) / 2)), bottom: window.innerHeight - box.top + 8 })
    }
    position()
    window.addEventListener("resize", position)
    window.addEventListener("scroll", position, true)
    window.visualViewport?.addEventListener("resize", position)
    return () => {
      window.removeEventListener("resize", position)
      window.removeEventListener("scroll", position, true)
      window.visualViewport?.removeEventListener("resize", position)
    }
  }, [open])
  useEffect(() => {
    setModels([])
    if (!sessionKey && !harness) return
    let alive = true
    void (sessionKey ? api.session(sessionKey).then(({ session }) => api.models(session.harness)) : api.models(harness!)).then(({ models }) => { if (alive) setModels(models) }, (error) => { if (alive) toast.error(`Cannot load models: ${error.message}`) })
    return () => { alive = false }
  }, [sessionKey, harness])
  useEffect(() => {
    if (sessionKey || !models.length || draft?.model || !onDraftChange) return
    const saved = user?.sessionDefaults?.harness === harness ? user?.sessionDefaults : undefined
    const selected = models.find((m) => m.id === saved?.model.id && m.provider === saved?.model.provider) ?? models[0]
    const levels = selected.thinkingLevels ?? ["off"]
    onDraftChange({ model: { provider: selected.provider, id: selected.id }, thinkingLevel: levels.includes(saved?.thinkingLevel ?? "") ? saved!.thinkingLevel : levels[0] })
  }, [models, sessionKey, draft, onDraftChange, harness, user])
  const model = models.find((m) => m.id === state?.model?.id && m.provider === state?.model?.provider)
  const levels = model?.thinkingLevels ?? ["off"]
  const level = state?.thinkingLevel ?? "off"
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action() } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) }
  }
  return <>
    <div className="absolute top-full left-0 flex h-9 w-full min-w-0 justify-center">
    <select aria-label="Current session model" title="Current session model" className="h-9 min-w-0 max-w-full rounded bg-transparent text-xs text-center [text-align-last:center]" disabled={disabled || !agentEnabled || busy || !models.length} value={state?.model ? JSON.stringify([state.model.provider, state.model.id]) : ""} onChange={(e) => {
      const [provider, id] = JSON.parse(e.target.value)
      if (sessionKey) void change(() => api.setModel(sessionKey, provider, id))
      else {
        const supported = models.find((m) => m.provider === provider && m.id === id)?.thinkingLevels ?? ["off"]
        onDraftChange?.({ model: { provider, id }, thinkingLevel: supported.includes(level) ? level : supported[0] })
      }
    }}>
      {!model && <option value={state?.model ? JSON.stringify([state.model.provider, state.model.id]) : ""}>{state?.model?.id ?? "Model"}</option>}
      {models.map((m) => <option key={`${m.provider}/${m.id}`} value={JSON.stringify([m.provider, m.id])}>{m.name}</option>)}
    </select>
    </div>
    <div className="shrink-0">
      <button ref={reasoning} type="button" className="composer-icon flex h-11 items-center gap-1 rounded px-1 hover:bg-accent" aria-label={`Reasoning: ${level}`} aria-expanded={open} data-active={open} disabled={disabled || !agentEnabled || busy || levels.length < 2} onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen((current) => !current)}><Brain className="size-6" /><span className="text-xs">{short[level] ?? level}</span></button>
      {open && createPortal(<div role="dialog" aria-label="Reasoning settings" style={popupPosition} className="fixed z-50 rounded border bg-popover p-3 text-popover-foreground shadow" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}>
        <div className="mb-2 flex justify-between text-xs"><span>Reasoning: {level}</span><button type="button" aria-label="Close reasoning" onClick={() => setOpen(false)}>×</button></div>
        <input aria-label="Reasoning level" aria-valuetext={level} type="range" min={0} max={levels.length - 1} step={1} value={Math.max(0, levels.indexOf(level))} disabled={busy} className="w-full" onChange={(e) => { const thinkingLevel = levels[Number(e.target.value)]; if (sessionKey) void change(() => api.setThinking(sessionKey, thinkingLevel)); else onDraftChange?.({ ...draft, thinkingLevel }) }} />
        <div className="flex justify-between text-[10px]">{levels.map((l) => <span key={l}>{short[l] ?? l}</span>)}</div>
      </div>, document.body)}
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onCamera(Array.from(e.target.files ?? [])); e.target.value = "" }} />
    <button type="button" disabled={disabled} className="composer-icon grid size-11 shrink-0 place-items-center rounded hover:bg-accent" aria-label="Take photo" onClick={() => camera.current?.click()}><Camera className="size-6" /></button>
  </>
}

/** `push` keeps the controls after it at the far end, beside send; a session in flight turns it off so they sit by the toggle and the stop button takes that end. */
export function AgentToggle({ checked, onChange, disabled, push = true }: { checked: boolean; onChange?: (value: boolean) => void; disabled?: boolean; push?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label="Send to agent too" disabled={disabled} onClick={() => onChange?.(!checked)} data-active={checked} className={`composer-icon ${push ? "mr-auto" : ""} flex min-h-11 shrink-0 items-center gap-2 text-base font-medium`}><span className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 ${checked ? "bg-blue-700 dark:bg-blue-300" : "bg-white"}`}><span className={`size-5 rounded-full bg-background transition-transform ${checked ? "translate-x-5" : ""}`} /></span>Agent</button>
}
