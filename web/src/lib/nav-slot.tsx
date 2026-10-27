import { createContext, useContext } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/** A place in the top bar for the open conversation's title and actions; null when there is no room. */
export const NavSlotContext = createContext<HTMLElement | null>(null)

/**
 * A conversation's header: in the top bar on large screens (saving a row), otherwise its own row
 * with `className`.
 */
export function ConversationHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  const slot = useContext(NavSlotContext)
  if (slot) return createPortal(<div className="flex min-w-0 flex-1 items-center gap-1.5 border-l pl-3">{children}</div>, slot)
  return <div className={cn("flex shrink-0 items-center", className)}>{children}</div>
}
