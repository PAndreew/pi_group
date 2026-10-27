import { ExternalLink, FileText } from "lucide-react"
import { useEffect, useState } from "react"
import { FileViewer } from "@/components/file-viewer"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn } from "@/lib/utils"

/**
 * The large-screen right sidebar: the file pi last wrote or edited in the open session, or, with no
 * session open, across the active project's sessions. Refreshes when a run ends.
 */
export function FilePreviewPanel({ sessionKey, projectId, className }: { sessionKey?: string; projectId?: string; className?: string }) {
  const nav = useNav()
  const [file, setFile] = useState<string | null>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!sessionKey && !projectId) return
    let alive = true
    const load = () =>
      api.lastEdit(sessionKey ? { session: sessionKey } : { project: projectId! }).then(
        (r) => {
          if (!alive) return
          setFile(r.file)
          setVersion((v) => v + 1)
        },
        () => alive && setFile(null),
      )
    void load()
    const unsubscribe = subscribeUserEvents((event) => {
      if (event.type === "run" && (!sessionKey || (event as { key?: string }).key === sessionKey)) void load()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [sessionKey, projectId])

  const name = file?.split("/").pop()
  return (
    <aside className={cn("flex min-h-0 flex-col border-l", className)} aria-label="Last edited file">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-3 text-xs text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={file ? `/${file}` : undefined}>
          {file ? name : "Last edited file"}
        </span>
        {file && (
          <Button variant="ghost" size="icon-sm" className="size-6 [&_svg]:size-3.5" onClick={() => nav.openFile(file)} aria-label="Open file" title="Open file">
            <ExternalLink />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {file ? (
          <FileViewer key={`${file}:${version}`} path={file} />
        ) : (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">{file === null ? "Files pi writes or edits show here." : ""}</p>
        )}
      </div>
    </aside>
  )
}
