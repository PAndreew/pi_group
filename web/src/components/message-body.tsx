import { Share } from "lucide-react"
import { ImageGallery } from "@/components/image-gallery"
import { Markdown } from "@/components/markdown"
import { api } from "@/lib/api"
import { isVideo, mediaRefs, withoutAttachmentList } from "@/lib/attachments"
import { withoutRefDetails } from "@/lib/element-refs"
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
 * Images and videos the message refers to (uploads) are shown under it: images open full screen,
 * videos play in place.
 */
export function MessageBody({ text, folder, tinted }: { text: string; folder?: string; tinted?: boolean }) {
  const shared = parseShared(text)
  if (!shared) {
    const images = mediaRefs(text, folder).map((path) => ({ src: api.rawUrl(path), name: path.split("/").pop(), download: api.downloadUrl(path), video: isVideo(path) }))
    return (
      <>
        <div className="whitespace-pre-wrap break-words">
          <Linkified text={withoutRefDetails(withoutAttachmentList(text))} />
        </div>
        <ImageGallery images={images} />
      </>
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
