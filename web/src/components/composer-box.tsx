import { ArrowUp, CircleStop, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * The one message box every screen uses: the text area (`children`) above a row of
 * Agent toggle … controls, send. While a run can be stopped the controls move next to the
 * toggle and stop takes their place beside send.
 */
export function ComposerBox({
  children,
  agent,
  controls,
  onSend,
  canSend,
  sending,
  onStop,
}: {
  children: React.ReactNode
  agent?: React.ReactNode
  controls?: React.ReactNode
  onSend: () => void
  canSend: boolean
  sending?: boolean
  onStop?: () => void
}) {
  return (
    <div data-composer-box className="relative mb-9 min-w-0 rounded-md border focus-within:ring-1 focus-within:ring-ring">
      {children}
      <div className="flex items-center gap-1 px-2 pb-2">
        {agent}
        {onStop ? controls : <span className="flex-1" />}
        {onStop ? <span className="flex-1" /> : controls}
        {onStop && (
          <Button className="composer-icon size-11 shrink-0 [&_svg]:size-6" variant="destructive" size="icon" onClick={onStop} aria-label="Stop the agent">
            <CircleStop className="size-6" />
          </Button>
        )}
        <Button className="composer-send size-11 shrink-0 [&_svg]:size-6" size="icon" onClick={onSend} disabled={sending || !canSend} aria-label="Send">
          {sending ? <Loader2 className="size-6 animate-spin" /> : <ArrowUp className="size-6" />}
        </Button>
      </div>
    </div>
  )
}
