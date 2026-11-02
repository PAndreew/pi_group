import { FileIcon } from "@react-symbols/icons/utils"
import type { Element, ElementContent } from "hast"
import { memo, useContext, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { ImageGallery } from "@/components/image-gallery"
import { WebLink } from "@/components/web-link"
import { Chart, LinkPreviewCard } from "@/components/rich-blocks"
import { api } from "@/lib/api"
import { fileLinkPath } from "@/lib/file-link"
import { NavContext } from "@/lib/nav"
import { parseChart, previewUrls } from "@/lib/rich-blocks"
import { cn } from "@/lib/utils"

let rootRequest: Promise<string | undefined> | undefined
/** The shared root's absolute path, so agent links written as absolute paths can open too. */
function useFsRoot(enabled: boolean) {
  const [root, setRoot] = useState<string>()
  useEffect(() => {
    if (!enabled) return
    rootRequest ??= api.fsInfo().then(({ root }) => root, () => undefined)
    let alive = true
    void rootRequest.then((r) => { if (alive) setRoot(r) })
    return () => { alive = false }
  }, [enabled])
  return root
}

const textOf = (node: ElementContent): string => node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : ""
const isImage = (node: ElementContent) => node.type === "element" && node.tagName === "img"
const blank = (node: ElementContent) => node.type === "text" && !node.value.trim()

/** A fenced block's language and source, when `pre` holds one. */
function fence(node?: Element) {
  const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code")
  const classes = code?.properties.className
  const language = (Array.isArray(classes) ? classes : []).map(String).find((c) => c.startsWith("language-"))?.slice("language-".length)
  return code && language ? { language, source: textOf(code) } : undefined
}

function ChartBlock({ source }: { source: string }) {
  const spec = parseChart(source)
  if (typeof spec === "string") return <pre title={spec}><code>{source}</code></pre>
  return <Chart spec={spec} />
}

/** With `base` (the folder the text was written in), links to files open them in the app's preview. */
export const Markdown = memo(function Markdown({ text, className, base }: { text: string; className?: string; base?: string }) {
  const nav = useContext(NavContext)
  const files = base !== undefined && nav !== null
  const root = useFsRoot(files)
  return (
    <div className={cn("prose-pi", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ node, children, ...props }) => {
            const block = fence(node)
            if (block?.language === "chart") return <ChartBlock source={block.source} />
            if (block?.language === "preview") {
              const urls = previewUrls(block.source)
              if (urls.length) return <div className="grid gap-2">{urls.map((url) => <LinkPreviewCard key={url} url={url} />)}</div>
            }
            return <pre {...props}>{children}</pre>
          },
          // A paragraph of only images becomes a gallery that opens full screen.
          p: ({ node, children, ...props }) => {
            const parts = node?.children.filter((child) => !blank(child)) ?? []
            if (!parts.length || !parts.every(isImage)) return <p {...props}>{children}</p>
            const images = (parts as Element[]).map((img) => {
              const src = String(img.properties.src ?? "")
              const file = files ? fileLinkPath(src, base, root) : undefined
              return { src: file ? api.rawUrl(file) : src, name: String(img.properties.alt || "") || (file ?? src).split("/").pop(), download: file ? api.downloadUrl(file) : undefined }
            }).filter((img) => img.src)
            return <ImageGallery images={images} className="my-2" />
          },
          img: ({ node: _node, src, alt, ...props }) => {
            const file = files && typeof src === "string" ? fileLinkPath(src, base, root) : undefined
            return <img {...props} src={file ? api.rawUrl(file) : src} alt={alt ?? ""} loading="lazy" className="inline-block max-h-60 rounded align-middle" />
          },
          a: ({ node: _node, href, children, ...props }) => {
            const file = files ? fileLinkPath(href, base, root) : undefined
            // "#…" links are routes in this app (a shared message's source); they open in place.
            if (href?.startsWith("#")) return <a {...props} href={href}>{children}</a>
            if (!file && /^https?:\/\//i.test(href ?? "")) return <WebLink {...props} href={href}>{children}</WebLink>
            if (!file) return <a {...props} href={href} target="_blank" rel="noreferrer noopener">{children}</a>
            return (
              <a
                {...props}
                href={`#${new URLSearchParams({ file })}`}
                title={`Open /${file}`}
                className="inline-flex items-baseline gap-1"
                onClick={(e) => {
                  e.preventDefault()
                  nav!.openFile(file)
                }}
              >
                <FileIcon fileName={file.split("/").pop() ?? file} autoAssign width={18} height={18} className="shrink-0 self-center" aria-hidden="true" />
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
