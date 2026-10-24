import { X } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"
import { findReplySource, parseReply, type ReplyTarget } from "@/lib/reply"
import { cn } from "@/lib/utils"

export function focusComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-chat-composer] textarea")?.focus({ preventScroll: true }))
}

export function selectReply(setReply: (reply: ReplyTarget) => void, reply: ReplyTarget) {
  setReply(reply)
  focusComposer()
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

/** Where a message can be jumped to from replies quoting it: put on the element showing it, with its full text. */
export const replySource = (text: string) => ({ "data-reply-source": text })

/** Scroll to the message a reply (`from`) quotes and flash it; it is the nearest earlier one with that text. */
export function jumpToOriginal(from: HTMLElement, quote: string) {
  const earlier = [...document.querySelectorAll<HTMLElement>("[data-reply-source]")].filter((el) => !el.contains(from) && el.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING)
  const target = earlier[findReplySource(earlier.map((el) => el.dataset.replySource ?? ""), quote)]
  if (!target) return void toast("The original message is not shown here", { description: "It may be filtered out or deleted." })
  target.scrollIntoView({ block: "center", behavior: "smooth" })
  target.classList.remove("reply-flash")
  void target.offsetWidth // restart the animation when jumping to the same message again
  target.classList.add("reply-flash")
  target.addEventListener("animationend", () => target.classList.remove("reply-flash"), { once: true })
}

/**
 * A message bubble with, when it is a reply, the quoted message tucked behind it in a faint card.
 * `children` receives the text to show in the bubble (the reply without its quote). Tapping the
 * card jumps to the quoted message.
 */
export function ReplyStack({ text, align = "start", className, children }: { text: string; align?: "start" | "end"; className?: string; children: (body: string) => React.ReactNode }) {
  const reply = parseReply(text)
  const card = useRef<HTMLButtonElement>(null)
  return (
    <div className={cn("relative isolate flex min-w-0 flex-col",  align === "end" ? "items-end" : "items-start", className)}>
      {reply && (
        <button
          ref={card}
          type="button"
          onClick={() => card.current && jumpToOriginal(card.current, reply.quote)}
          aria-label={`Go to the original message from ${reply.author}`}
          title="Go to the original message"
          className={cn("relative z-0 -mb-5 max-w-[calc(100%-0.75rem)] cursor-pointer rounded-2xl border border-border/60 bg-muted px-3 pt-2 pb-7 text-left text-xs text-muted-foreground opacity-65 transition-opacity hover:opacity-90 focus-visible:opacity-90 focus-visible:outline-2 focus-visible:outline-ring", align === "end" ? "mr-3" : "ml-3")}
        >
          <span className="block font-medium">{reply.author}</span>
          <span className="line-clamp-3 whitespace-pre-wrap break-words">{reply.quote}</span>
        </button>
      )}
      <div className="relative z-10 max-w-full">{children(reply ? reply.body : text)}</div>
    </div>
  )
}
