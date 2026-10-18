import { Reply, X } from "lucide-react"
import type { ReplyTarget } from "@/lib/reply"

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
