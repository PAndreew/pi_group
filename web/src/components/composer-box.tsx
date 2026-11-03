import { AudioLines, SendHorizontal, Pause } from "lucide-react"
import { Button } from "@/components/ui/button"

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
}: {
  children: React.ReactNode
  agent?: React.ReactNode
  controls?: React.ReactNode
  onSend: () => void
  onDictate?: () => void
  canSend: boolean
  sending?: boolean
  onStop?: () => void
  onFiles?: (files: File[]) => void
}) {
  const dictate = !canSend && !onStop && !sending && Boolean(onDictate)
  return (
    <>
    <div
      data-composer-box
      className="relative min-w-0 rounded-[12px] bg-muted"
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
        <Button className={`${dictate ? "bg-transparent text-blue-500 hover:bg-blue-500/10 hover:text-blue-500" : "composer-send"} size-10 shrink-0 disabled:opacity-35 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]`} size="icon" onClick={dictate ? onDictate : onStop ?? onSend} disabled={!dictate && !onStop && (sending || !canSend)} aria-label={dictate ? "Silent dictation" : onStop ? "Pause the agent" : "Send"}>
          {dictate ? <AudioLines /> : onStop ? <Pause className="pause-shimmer" /> : <SendHorizontal />}
        </Button>
      </div>
    </div>
    <div data-model-picker className="flex min-w-0 justify-center" />
    </>
  )
}
