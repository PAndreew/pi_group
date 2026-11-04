import { AudioLines, LoaderCircle, Square, SendHorizontal, Pause } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DictationPhase } from "@/hooks/use-silent-dictation"

/**
 * The one message box every screen uses: the text area (`children`) above a row with the Agent
 * toggle at the left, send at the right (stop beside it while a run can be stopped), and the
 * controls spread evenly between them. Files or images pasted anywhere in it go to `onFiles`.
 */
export function ComposerBox({
  children,
  agent,
  controls,
  onSend,
  canSend,
  sending,
  onStop,
  onFiles,
  onDictate,
  dictationPhase = 'ready',
  dictationHint,
}: {
  children: React.ReactNode
  agent?: React.ReactNode
  controls?: React.ReactNode
  onSend: () => void
  onDictate?: () => void
  dictationPhase?: DictationPhase
  dictationHint?: string
  canSend: boolean
  sending?: boolean
  onStop?: () => void
  onFiles?: (files: File[]) => void
}) {
  const dictate = !canSend && !onStop && !sending && Boolean(onDictate)
  const preparing = dictate && ['loading', 'opening', 'decoding'].includes(dictationPhase)
  const recording = dictate && dictationPhase === 'recording'
  const label = dictate ? dictationPhase === 'loading' ? 'Preparing silent dictation' : dictationPhase === 'opening' ? 'Opening camera' : dictationPhase === 'decoding' ? 'Transcribing silent dictation' : recording ? 'Stop silent dictation' : dictationPhase === 'unavailable' ? 'Retry silent dictation' : 'Silent dictation' : onStop ? 'Pause the agent' : 'Send'
  return (
    <>
    <div
      data-composer-box
      className="relative min-w-0 rounded-[12px] bg-muted shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files)
        if (!files.length || !onFiles) return
        e.preventDefault()
        onFiles(files.map((file, i) => (file.name && file.name !== "image.png" ? file : new File([file], `pasted-${Date.now()}${i ? `-${i}` : ""}.${file.type.split("/")[1]?.replace("jpeg", "jpg") || "bin"}`, { type: file.type }))))
      }}
    >
      {children}
      <div className="flex items-center gap-1 p-2">
        {agent}
        <div className="flex min-w-0 flex-1 items-center justify-evenly">{controls}</div>
        <Button className={`${dictate ? recording ? "bg-transparent text-red-500 hover:bg-red-500/10 hover:text-red-500" : "bg-transparent text-blue-500 hover:bg-blue-500/10 hover:text-blue-500" : "composer-send"} size-10 shrink-0 disabled:opacity-35 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]`} size="icon" onClick={dictate ? onDictate : onStop ?? onSend} disabled={preparing || (!dictate && !onStop && (sending || !canSend))} aria-label={label} title={dictationHint || label} data-dictation-state={dictate ? dictationPhase : undefined}>
          {dictate ? preparing ? <LoaderCircle className="animate-spin" /> : recording ? <Square className="animate-pulse" /> : <AudioLines /> : onStop ? <Pause className="pause-shimmer" /> : <SendHorizontal />}
        </Button>
      </div>
      {dictationHint && <p role="status" aria-live="polite" className="px-3 pb-2 text-xs text-muted-foreground">{dictationHint}</p>}
    </div>
    <div data-model-picker className="flex min-w-0 justify-center" />
    </>
  )
}
