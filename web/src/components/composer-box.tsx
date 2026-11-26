import { AtSign, AudioLines, LoaderCircle, Square, SendHorizontal, Pause } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { DictationPhase } from "@/hooks/use-silent-dictation"
import { useLocale } from "@/lib/i18n"

const ICON = "size-[22px] lg:size-[18px]"
const dictationLabels = {
  ready: "composer.dictation",
  loading: "composer.dictationLoading",
  opening: "composer.dictationOpening",
  decoding: "composer.dictationDecoding",
  recording: "composer.dictationStop",
  unavailable: "composer.dictationRetry",
} as const satisfies Record<DictationPhase, string>

/** The edge glow only shows after the box has gone this long without typing. */
const GLOW_IDLE_MS = 15_000

function useIdle(ms: number) {
  const [idle, setIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const poke = useCallback(() => {
    setIdle(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setIdle(true), ms)
  }, [ms])
  useEffect(() => {
    poke()
    return () => clearTimeout(timer.current)
  }, [poke])
  return { idle, poke }
}

/**
 * The one message box every screen uses: the text area (`children`) above a row with mentions
 * at the left, send or pause at the right, and the
 * controls spread evenly between them. Files or images pasted anywhere in it go to `onFiles`.
 */
export function ComposerBox({
  children,
  onMention,
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
  onMention: () => void
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
  const { t } = useLocale()
  const { idle, poke } = useIdle(GLOW_IDLE_MS)
  const dictate = !canSend && !onStop && !sending && Boolean(onDictate)
  const preparing = dictate && ['loading', 'opening', 'decoding'].includes(dictationPhase)
  const recording = dictate && dictationPhase === 'recording'
  const label = t(dictate ? dictationLabels[dictationPhase] : onStop ? "composer.pause" : "composer.send")
  return (
    <>
    <div
      data-composer-box
      data-idle={idle || undefined}
      onInputCapture={poke}
      onKeyDownCapture={poke}
      onCompositionUpdateCapture={poke}
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
        <button type="button" className="composer-icon grid size-10 shrink-0 place-items-center rounded hover:bg-accent disabled:opacity-50 lg:size-8" aria-label={t("composer.mention")} title={t("composer.mention")} disabled={sending} onPointerDown={(e) => e.preventDefault()} onClick={onMention}>
          <AtSign className={ICON} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-evenly">{controls}</div>
        <Button className={`${dictate ? recording ? "bg-transparent text-red-500 hover:bg-red-500/10 hover:text-red-500" : "bg-transparent text-blue-500 hover:bg-blue-500/10 hover:text-blue-500" : "composer-send"} size-10 shrink-0 disabled:opacity-35 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]`} size="icon" onClick={dictate ? onDictate : onStop ?? onSend} disabled={preparing || (!dictate && !onStop && (sending || !canSend))} aria-label={label} title={dictationHint || label} data-dictation-state={dictate ? dictationPhase : undefined}>
          {/* An explicit size: Button otherwise shrinks unsized icons below the other composer icons. */}
          {dictate ? preparing ? <LoaderCircle className={`${ICON} animate-spin`} /> : recording ? <Square className={`${ICON} animate-pulse`} /> : <AudioLines className={ICON} /> : onStop ? <Pause className={`${ICON} pause-shimmer`} /> : <SendHorizontal className={ICON} />}
        </Button>
      </div>
      {dictationHint && <p role="status" aria-live="polite" className="px-3 pb-2 text-xs text-muted-foreground">{dictationHint}</p>}
    </div>
    <div data-model-picker className="flex min-w-0 justify-center" />
    </>
  )
}
