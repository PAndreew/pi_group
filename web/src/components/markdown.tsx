import { FileText } from "lucide-react"
import { memo, useContext, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { api } from "@/lib/api"
import { fileLinkPath } from "@/lib/file-link"
import { NavContext } from "@/lib/nav"
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
          a: ({ node: _node, href, children, ...props }) => {
            const file = files ? fileLinkPath(href, base, root) : undefined
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
                <FileText className="size-3.5 shrink-0 self-center" />
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
