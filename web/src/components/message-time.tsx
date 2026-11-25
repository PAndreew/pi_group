import { cn } from "@/lib/utils"

/** Send time for a message header (next to the author), with the date for messages sent before today. */
export function MessageTime({ at, edited, className }: { at?: string | number; edited?: boolean; className?: string }) {
  if (at === undefined) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  const today = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const label = today ? time : `${date.toLocaleDateString([], { day: "numeric", month: "short", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) })} ${time}`
  return (
    <time dateTime={date.toISOString()} className={cn("text-[11px] font-normal leading-none tabular-nums text-muted-foreground", className)} title={date.toLocaleString()}>
      {label}{edited && " · edited"}
    </time>
  )
}
