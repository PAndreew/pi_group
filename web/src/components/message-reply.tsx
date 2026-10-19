import { Reply, X } from "lucide-react"
import { parseReply, type ReplyTarget } from "@/lib/reply"
import { cn } from "@/lib/utils"

export function ReplyButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Reply to message" className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-xs opacity-80 hover:opacity-100 focus-visible:outline-2"><Reply className="size-3.5" /> Reply</button>
}

export function selectReply(setReply: (reply: ReplyTarget) => void, reply: ReplyTarget) {
  setReply(reply)
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-chat-composer] textarea")?.focus({ preventScroll: true }))
}

export function ReplyPreview({ reply, onCancel }: { reply: ReplyTarget; onCancel: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border-l-2 border-primary bg-muted p-2 text-xs" role="region" aria-label="Reply preview">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => document.getElementById(reply.sourceId)?.scrollIntoView({ block: "center", behavior: "smooth" })} title="Jump to original message">
        <span className="block font-medium">Replying to {reply.author}</span>
        <span className="block truncate text-muted-foreground">{reply.text}</span>
      </button>
      <button type="button" className="grid size-9 shrink-0 place-items-center" aria-label="Cancel reply" onClick={onCancel}><X className="size-4" /></button>
    </div>
  )
}

/**
 * A message bubble with, when it is a reply, the quoted message tucked behind it in a faint card.
 * `children` receives the text to show in the bubble (the reply without its quote).
 */
export function ReplyStack({ text, align = "start", className, children }: { text: string; align?: "start" | "end"; className?: string; children: (body: string) => React.ReactNode }) {
  const reply = parseReply(text)
  return (
    <div className={cn("flex min-w-0 flex-col", align === "end" ? "items-end" : "items-start", className)}>
      {reply && (
        <div className="mx-2 -mb-3 max-w-full rounded-xl border border-border/50 bg-muted/40 px-3 pt-1.5 pb-4 text-xs text-muted-foreground">
          <span className="block font-medium">{reply.author}</span>
          <span className="line-clamp-3 whitespace-pre-wrap break-words">{reply.quote}</span>
        </div>
      )}
      <div className="relative max-w-full">{children(reply ? reply.body : text)}</div>
    </div>
  )
}
