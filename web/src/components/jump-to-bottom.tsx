import { ArrowDown } from "lucide-react"
import { useCallback, useRef, useState } from "react"

/** How far from the bottom (px) still counts as following the newest messages. */
const NEAR_BOTTOM = 80

/**
 * Follows a message list's scroll position: `stuck` while at the bottom (new messages scroll into
 * view), `away` once the reader scrolled up, which shows the jump button.
 */
export function useJumpToBottom(scroller: React.RefObject<HTMLElement | null>, stick: React.RefObject<boolean>) {
  const [away, setAway] = useState(false)
  // A smooth jump passes through "away" positions; keep the button hidden until it lands.
  const jumping = useRef<number | undefined>(undefined)
  const onScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const el = event.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    if (stick.current) jumping.current = undefined
    if (jumping.current === undefined || Date.now() > jumping.current) setAway(!stick.current)
  }, [stick])
  const jump = useCallback(() => {
    const el = scroller.current
    if (!el) return
    stick.current = true
    jumping.current = Date.now() + 1500
    setAway(false)
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [scroller, stick])
  return { away, onScroll, jump }
}

/** Round button floating above the message box (render it inside the box's relative container), back to the newest message. */
export function JumpToBottom({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to the newest message"
      title="Jump to the newest message"
      className="absolute bottom-full left-1/2 z-20 mb-3 grid size-11 -translate-x-1/2 place-items-center rounded-full border bg-background text-foreground shadow-md animate-in fade-in zoom-in-90 hover:bg-accent"
    >
      <ArrowDown className="size-5" />
    </button>
  )
}
