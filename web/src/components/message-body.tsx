import { FileIcon } from "@react-symbols/icons/utils"
import { Share } from "lucide-react"
import { useContext } from "react"
import { ImageGallery } from "@/components/image-gallery"
import { Markdown } from "@/components/markdown"
import { WebLink } from "@/components/web-link"
import { api } from "@/lib/api"
import { fileParts, isVideo, mediaRefs, withoutAttachmentList } from "@/lib/attachments"
import { withoutRefDetails } from "@/lib/element-refs"
import { useMissingFiles } from "@/lib/missing-files"
import { NavContext } from "@/lib/nav"
import { linkify, parseShared } from "@/lib/shared"
import { cn } from "@/lib/utils"

/** Plain text with web addresses made clickable. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((part, i) =>
        "url" in part ? (
          <WebLink key={i} href={part.href} className="break-all underline underline-offset-2">
            {part.url}
          </WebLink>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/** Plain text with web addresses and referenced files (uploads) made clickable; files open in the preview. */
function TextWithLinks({ text, folder }: { text: string; folder?: string }) {
  const nav = useContext(NavContext)
  const parts = fileParts(text, folder)
  const missing = useMissingFiles(nav ? parts.flatMap((part) => ("path" in part ? [part.path] : [])) : [])
  if (!nav) return <Linkified text={text} />
  return (
    <>
      {parts.map((part, i) =>
        "path" in part ? (
          <a
            key={i}
            href={`#${new URLSearchParams({ file: part.path })}`}
            title={missing.has(part.path) ? `/${part.path} was moved or deleted` : `Open /${part.path}`}
            className={cn("break-all underline underline-offset-2", missing.has(part.path) && "line-through opacity-60")}
            onClick={(e) => {
              e.preventDefault()
              nav.openFile(part.path)
            }}
          >
            <FileIcon fileName={part.path.split("/").pop() ?? part.path} autoAssign width={16} height={16} className="mr-1 inline-block align-text-bottom" aria-hidden="true" />
            <span>{part.path.split("/").pop()}</span>
          </a>
        ) : (
          <Linkified key={i} text={part.text} />
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
          <TextWithLinks text={withoutRefDetails(withoutAttachmentList(text))} folder={folder} />
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
