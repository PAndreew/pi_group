import { Camera, Globe, Paperclip } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { useSessionStream } from "@/hooks/use-session-stream"
import { api, type ModelInfo } from "@/lib/api"

export interface ComposerConfig { model?: { provider: string; id: string }; thinkingLevel?: string }

/** The session's shared browser: whether it runs, whether its panel shows, and showing or hiding it. */
export interface BrowserToggle { live: boolean; shown: boolean; toggle: () => void }

const iconButton = "composer-icon grid size-10 shrink-0 place-items-center rounded hover:bg-accent disabled:opacity-50 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]"

/**
 * The message box's buttons after the Agent toggle: attach, shared browser, camera, and the model
 * below the box. A model switch affects only the linked session, never creation defaults; the
 * reasoning level is set in Settings.
 */
export function ComposerControls({ sessionKey, onCamera, onAttach, browser, disabled, agentEnabled = true, draft, onDraftChange }: { agentEnabled?: boolean; sessionKey?: string; draft?: ComposerConfig; onDraftChange?: (config: ComposerConfig) => void; onCamera: (files: File[]) => void; onAttach?: () => void; browser?: BrowserToggle; disabled?: boolean }) {
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
  // New settings start the draft over, so it picks up the saved runtime, model and reasoning.
  const savedDefaults = JSON.stringify(user?.sessionDefaults ?? null)
  const lastDefaults = useRef(savedDefaults)
  useEffect(() => {
    if (lastDefaults.current === savedDefaults) return
    lastDefaults.current = savedDefaults
    if (!sessionKey) onDraftChange?.({})
  }, [savedDefaults, sessionKey, onDraftChange])
  const [busy, setBusy] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const [modelTarget, setModelTarget] = useState<Element | null>(null)
  useEffect(() => {
    setModelTarget(anchor.current?.closest('[data-composer-box]')?.parentElement?.querySelector('[data-model-picker]') ?? null)
  }, [])
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
  const level = state?.thinkingLevel ?? "off"
  const modelLabel = model?.name ?? state?.model?.id
  // The toggle only decides whether a message goes to the agent; an existing session can always be reconfigured.
  const locked = !agentEnabled && !sessionKey
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action() } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) }
  }
  return <>
    <span ref={anchor} className="hidden" />
    {modelTarget && createPortal(<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Current session model" className="max-w-full truncate px-2 py-1 text-xs text-foreground hover:text-foreground disabled:opacity-75" disabled={disabled || locked || busy || !models.length}>{modelLabel ?? "Model"}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="max-h-72 max-w-[90vw] overflow-y-auto">
        {models.map((m) => <DropdownMenuItem key={`${m.provider}/${m.id}`} className="whitespace-normal [overflow-wrap:anywhere]" onSelect={() => {
          if (sessionKey) void change(() => api.setModel(sessionKey, m.provider, m.id))
          else {
            const supported = m.thinkingLevels ?? ["off"]
            onDraftChange?.({ model: { provider: m.provider, id: m.id }, thinkingLevel: supported.includes(level) ? level : supported[0] })
          }
        }}>{m.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>, modelTarget)}
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onCamera(Array.from(e.target.files ?? [])); e.target.value = "" }} />
    <button type="button" disabled={disabled || !onAttach} className={iconButton} aria-label="Attach files" title="Attach files (or paste them)" onClick={onAttach}><Paperclip /></button>
    <button type="button" disabled={!browser} className={iconButton} data-active={browser?.shown} aria-label="Shared browser" title={browser ? "Shared browser: open your app or any page, pick elements to reference" : "The shared browser opens in agent sessions"} onClick={browser?.toggle}>
      <span className="relative">
        <Globe />
        {browser?.live && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-green-500" />}
      </span>
    </button>
    <button type="button" disabled={disabled} className={iconButton} aria-label="Take photo" title="Take photo" onClick={() => camera.current?.click()}><Camera /></button>
  </>
}

export function AgentToggle({ checked, onChange, disabled }: { checked: boolean; onChange?: (value: boolean) => void; disabled?: boolean }) {
  return <div className="flex shrink-0 items-center gap-2"><button type="button" role="switch" aria-checked={checked} aria-label="Send to agent too" disabled={disabled} onClick={() => onChange?.(!checked)} data-active={checked} className="composer-icon flex min-h-10 shrink-0 items-center gap-2 text-base font-medium lg:min-h-8 lg:gap-1.5 lg:text-sm"><span className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 lg:h-5 lg:w-9 ${checked ? "bg-blue-700 dark:bg-blue-300" : "bg-zinc-300 dark:bg-white"}`}><span className={`size-5 rounded-full bg-background transition-transform lg:size-4 ${checked ? "translate-x-5 lg:translate-x-4" : ""}`} /></span></button></div>
}
