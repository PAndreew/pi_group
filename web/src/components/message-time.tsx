import { cn } from "@/lib/utils"

/** When a message was sent, small and narrow in its card's bottom-right corner; the date too unless it is today. */
export function MessageTime({ at, edited, className }: { at?: string | number; edited?: boolean; className?: string }) {
  if (at === undefined) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  const today = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const label = today ? time : `${date.toLocaleDateString([], { day: "numeric", month: "short", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) })} ${time}`
  return (
    <div className={cn("mt-1 text-right text-[10px] leading-none tracking-tight tabular-nums opacity-60 [font-stretch:condensed]", className)} title={date.toLocaleString()}>
      {label}{edited && " · edited"}
    </div>
  )
}
