import { ArrowUp, CircleStop, Loader2 } from "lucide-react"
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
}: {
  children: React.ReactNode
  agent?: React.ReactNode
  controls?: React.ReactNode
  onSend: () => void
  canSend: boolean
  sending?: boolean
  onStop?: () => void
  onFiles?: (files: File[]) => void
}) {
  return (
    <div
      data-composer-box
      className="relative mb-9 min-w-0 rounded-md border focus-within:ring-1 focus-within:ring-ring"
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
        {onStop && (
          <Button className="composer-icon size-10 shrink-0 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]" variant="destructive" size="icon" onClick={onStop} aria-label="Stop the agent">
            <CircleStop />
          </Button>
        )}
        <Button className="composer-send size-10 shrink-0 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]" size="icon" onClick={onSend} disabled={sending || !canSend} aria-label="Send">
          {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </div>
  )
}
