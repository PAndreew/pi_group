import { Share } from "lucide-react"
import { Markdown } from "@/components/markdown"
import { linkify, parseShared } from "@/lib/shared"
import { cn } from "@/lib/utils"

/** Plain text with web addresses made clickable. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((part, i) =>
        "url" in part ? (
          <a key={i} href={part.href} target="_blank" rel="noreferrer noopener" className="break-all underline underline-offset-2">
            {part.url}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/**
 * The text of a person's message: plain with clickable links, or, for a message shared from another
 * session or chat, a link to its source and the shared content as markdown. `tinted` is for
 * primary-colored bubbles, so code blocks and quotes take their color from the text.
 */
export function MessageBody({ text, folder, tinted }: { text: string; folder?: string; tinted?: boolean }) {
  const shared = parseShared(text)
  if (!shared) {
    return (
      <div className="whitespace-pre-wrap break-words">
        <Linkified text={text} />
      </div>
    )
  }
  return (
    <div className={cn("grid min-w-0 gap-1", tinted && "agent-bubble")}>
      <div className="flex min-w-0 items-center gap-1 text-xs opacity-80">
        <Share className="size-3 shrink-0" />
        <span className="truncate">
          Shared from{" "}
          {shared.href ? (
            <a href={shared.href} className="font-medium underline underline-offset-2">
              {shared.label}
            </a>
          ) : (
            shared.label
          )}
        </span>
      </div>
      <Markdown text={shared.body} base={folder} />
    </div>
  )
}
