import { ExternalLink, FileText } from "lucide-react"
import { useEffect, useState } from "react"
import { FileViewer } from "@/components/file-viewer"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn } from "@/lib/utils"

export interface LastEdit {
  /** Root-relative path; null once loaded with nothing edited yet. */
  file?: string | null
  /** Bumps on every reload, so the preview shows the file's new content. */
  version: number
}

/**
 * The file pi last wrote or edited in the open session, or, with no session open, across the
 * active project's sessions. Reloads when a run ends.
 */
export function useLastEdit(sessionKey?: string, projectId?: string): LastEdit {
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
      if (event.type === "run" && (!sessionKey || event.key === sessionKey)) void load()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [sessionKey, projectId])
  return { file, version }
}

function Preview({ lastEdit, onOpen }: { lastEdit: LastEdit; onOpen?: () => void }) {
  const nav = useNav()
  const { file, version } = lastEdit
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-3 text-xs text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={file ? `/${file}` : undefined}>
          {file ? file.split("/").pop() : "Last edited file"}
        </span>
        {file && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 [&_svg]:size-3.5"
            onClick={() => {
              onOpen?.()
              nav.openFile(file)
            }}
            aria-label="Open file"
            title="Open file"
          >
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
    </>
  )
}

/** The very-large-screen right sidebar showing the last edited file. */
export function FilePreviewPanel({ lastEdit, className }: { lastEdit: LastEdit; className?: string }) {
  return (
    <aside className={cn("flex min-h-0 flex-col border-l", className)} aria-label="Last edited file">
      <Preview lastEdit={lastEdit} />
    </aside>
  )
}

/** The same preview in a modal, for screens without room for the sidebar. */
export function FilePreviewDialog({ lastEdit, open, onOpenChange }: { lastEdit: LastEdit; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85dvh] flex-col gap-0 p-0 pt-8 sm:max-w-3xl">
        <DialogTitle className="sr-only">Last edited file</DialogTitle>
        <DialogDescription className="sr-only">The file pi last wrote or edited</DialogDescription>
        <Preview lastEdit={lastEdit} onOpen={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
