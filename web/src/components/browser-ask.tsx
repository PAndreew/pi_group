import { Crosshair, Loader2, MessageCircle, Send, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Markdown } from "@/components/markdown"
import { MessageTime } from "@/components/message-time"
import { Button } from "@/components/ui/button"
import { type ElementRef, refLabel } from "@/lib/element-refs"
import { cn } from "@/lib/utils"

/** The agent's answer to the last question asked from the browser. */
export type BrowserAnswer = { id: string; question: string; text?: string; running: boolean; at?: number }

/**
 * A round button floating over the browser page that opens a small ask box: the question, the
 * elements picked while it is open, and send. The answer shows in a bubble above it. Both go into
 * the session like any message.
 */
export function BrowserAsk({
  open,
  onOpenChange,
  picks,
  quote,
  onRemoveQuote,
  onRemovePick,
  onSend,
  disabled,
  replies,
  folder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  picks: ElementRef[]
  quote?: string
  onRemoveQuote: () => void
  onRemovePick: (id: string) => void
  /** Resolves once the question is sent; rejects (and keeps the text) when it was not. */
  onSend: (text: string) => Promise<void>
  disabled?: string
  replies: BrowserAnswer[]
  folder?: string
}) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [expanded, setExpanded] = useState<string | null>("latest")
  const latest = replies.at(-1)
  const answer = expanded === "latest" ? latest : replies.find((reply) => reply.id === expanded)
  const input = useRef<HTMLTextAreaElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  // Follow the answer as it streams in.
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [answer?.text])

  const send = async () => {
    if ((!text.trim() && !picks.length && !quote) || disabled || sending) return
    setSending(true)
    try {
      await onSend(text.trim())
      setText("")
      setExpanded("latest")
    } catch {
      // The caller reports the error; the question stays for another try.
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex flex-col items-center gap-2 px-3">
      {answer && (
        <div className="pointer-events-auto flex max-h-[40vh] min-h-0 w-full max-w-xl flex-col rounded-2xl border bg-background shadow-lg">
          <div className="flex items-center gap-2 px-3.5 pt-2 text-xs">
            <span className="font-semibold text-gray-500 dark:text-gray-300">Beezy</span>
            {answer.running && <span className="running-shimmer">Running…</span>}
            <button type="button" onClick={() => setExpanded(null)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Collapse answer" title="Collapse answer">
              <X className="size-4" />
            </button>
          </div>
          <div ref={body} className="min-h-0 overflow-y-auto px-3.5 pb-2 text-sm">
            <p className="mb-2 whitespace-pre-wrap break-words text-muted-foreground">{answer.question}</p>
            {answer.text ? <Markdown text={answer.text} base={folder} /> : answer.running ? <Loader2 className="my-1 size-4 animate-spin text-muted-foreground" /> : <p>No text reply.</p>}
            {!answer.running && <MessageTime at={answer.at} />}
          </div>
        </div>
      )}
      {replies.length > 0 && (
        <div aria-label="Browser conversation history" role="group" className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto rounded-full bg-background/95 p-1 shadow">
          {replies.map((reply, index) => (
            <Button key={reply.id} type="button" size="icon-sm" variant={answer?.id === reply.id ? "default" : "outline"} className="shrink-0 rounded-full" aria-expanded={answer?.id === reply.id} aria-label={`Question ${index + 1}: ${reply.question.slice(0, 100)}`} title={reply.question.slice(0, 100)} onClick={() => setExpanded(answer?.id === reply.id ? null : reply.id)}>
              {index + 1}
            </Button>
          ))}
        </div>
      )}
      {open && quote && <div className="pointer-events-auto flex w-full max-w-lg items-start gap-2 rounded-lg bg-background p-2 text-sm shadow"><blockquote className="line-clamp-3 min-w-0 flex-1 break-words">{quote}</blockquote><Button type="button" size="icon-sm" variant="ghost" onClick={onRemoveQuote} aria-label="Remove selected text"><X /></Button></div>}
      {open ? (
        <form
          className="pointer-events-auto w-full max-w-xl rounded-2xl border bg-background p-2 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onOpenChange(false)
          }}
        >
          {picks.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {picks.map((ref) => (
                <span key={ref.id} className="flex max-w-full items-center gap-1 rounded-full bg-sky-500/10 py-0.5 pr-1 pl-2 text-xs text-sky-700 dark:text-sky-300">
                  <Crosshair className="size-3 shrink-0" />
                  <span className="truncate">{refLabel(ref)}</span>
                  <button type="button" onClick={() => onRemovePick(ref.id)} className="rounded-full p-0.5 hover:bg-sky-500/20" aria-label="Remove pick">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia("(pointer: coarse)").matches) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder={picks.length ? "Ask about the picked elements" : latest ? "Ask a follow-up…" : "Ask about this page (pick elements with ⌖)"}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none [field-sizing:content]"
              aria-label="Ask about this page"
            />
            <Button type="submit" size="icon" className="size-9 shrink-0 rounded-full" disabled={Boolean(disabled) || sending || (!text.trim() && !picks.length && !quote)} title={disabled ?? "Send"} aria-label="Send">
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="icon"
          className={cn("pointer-events-auto size-11 rounded-full shadow-lg", picks.length > 0 && "ring-2 ring-sky-500")}
          onClick={() => onOpenChange(true)}
          aria-label="Ask about this page"
          title="Ask about this page"
        >
          <MessageCircle className="size-5" />
        </Button>
      )}
    </div>
  )
}
