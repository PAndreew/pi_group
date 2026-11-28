import { useLocale } from "@/lib/i18n"
import { Share } from "lucide-react"
import { BrowserReferenceCards } from "@/components/browser-reference-cards"
import { FileReference } from "@/components/file-reference"
import { ImageGallery } from "@/components/image-gallery"
import { Markdown } from "@/components/markdown"
import { WebLink } from "@/components/web-link"
import { api } from "@/lib/api"
import { fileParts, isVideo, mediaRefs, withoutAttachmentList } from "@/lib/attachments"
import { splitBrowserRefs } from "@/lib/element-refs"
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
  const parts = fileParts(text, folder)
  return (
    <>
      {parts.map((part, i) =>
        "path" in part ? (
          <FileReference key={i} path={part.path} />
        ) : (
          <Linkified key={i} text={part.text} />
        ),
      )}
    </>
  )
}

/**
 * The text of a person's message: Markdown with clickable file links, or, for a message shared from another
 * session or chat, a link to its source and the shared content as markdown. `tinted` is for
 * primary-colored bubbles, so code blocks and quotes take their color from the text.
 * Images and videos the message refers to (uploads) are shown under it: images open full screen,
 * videos play in place.
 */
export function MessageBody({ text, folder, tinted }: { text: string; folder?: string; tinted?: boolean }) {
  const { t: tr } = useLocale()
  const shared = parseShared(text)
  if (!shared) {
    const { text: message, pages } = splitBrowserRefs(text)
    const body = withoutAttachmentList(message)
    const list = body.indexOf("\n\nAttached files:\n")
    const markdown = list < 0 ? body : body.slice(0, list)
    const attachments = list < 0 ? "" : body.slice(list).trimStart()
    const names = new Set(pages.flatMap((page) => page.picks.map((pick) => pick.screenshot)))
    const screenshots = new Map<string, string>()
    const images = mediaRefs(message, folder).flatMap((path) => {
      const name = path.split("/").pop()!
      if (names.has(name)) {
        screenshots.set(name, path)
        return []
      }
      return [{ src: api.rawUrl(path), name, download: api.downloadUrl(path), video: isVideo(path) }]
    })
    return (
      <>
        {markdown && <Markdown text={markdown} base={folder} mode="message" className={tinted ? "agent-bubble" : undefined} />}
        {attachments && <div className="mt-2 whitespace-pre-wrap wrap-anywhere"><TextWithLinks text={attachments} folder={folder} /></div>}
        <BrowserReferenceCards pages={pages} screenshots={screenshots} />
        <ImageGallery images={images} />
      </>
    )
  }
  return (
    <div className={cn("grid min-w-0 grid-cols-1 gap-1", tinted && "agent-bubble")}>
      <div className="flex min-w-0 items-center gap-1 text-xs opacity-80">
        <Share className="size-3 shrink-0" />
        <span className="truncate">
          {tr("ui.shared-from-5bdd86")}{" "}
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
