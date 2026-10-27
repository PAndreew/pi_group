import { FileText } from "lucide-react"
import { useEffect, useState } from "react"
import { ComposerTools } from "@/components/composer-tools"
import { Sidebar } from "@/components/sidebar"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { cn } from "@/lib/utils"

/**
 * The large-screen left sidebar: the file explorer, starting at `folder` (the open session's or
 * the project's), with the tool icons at its bottom. Without room for the preview sidebar, the
 * last edited file is a button here that opens it in a modal.
 */
export function WorkspaceSidebar({
  folder: start,
  sessionKey,
  selectedFile,
  lastEdit,
  onLastEdit,
  className,
}: {
  folder: string
  sessionKey?: string
  selectedFile?: string
  lastEdit?: string
  onLastEdit?: () => void
  className?: string
}) {
  const nav = useNav()
  const [folder, setFolder] = useState(start)
  const [rootName, setRootName] = useState("root")
  const [version, setVersion] = useState(0)

  useEffect(() => setFolder(start), [start])
  useEffect(() => {
    api.fsInfo().then(({ rootName }) => setRootName(rootName), () => {})
  }, [])

  return (
    <aside className={cn("flex min-h-0 flex-col border-r", className)} aria-label="Files">
      {lastEdit && (
        <button type="button" onClick={onLastEdit} title={`/${lastEdit}`} className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          <FileText className="size-3.5 shrink-0" />
          <span className="shrink-0">Last edited:</span>
          <span className="min-w-0 truncate font-medium text-foreground">{lastEdit.split("/").pop()}</span>
        </button>
      )}
      <div className="min-h-0 flex-1">
        <Sidebar
          rootName={rootName}
          folder={folder}
          selectedSession={sessionKey}
          selectedFile={selectedFile}
          onFolder={setFolder}
          onSession={(key) => nav.openSession(key)}
          onFile={nav.openFile}
          onNewSession={() => nav.newSession(folder)}
          onSessionDeleted={() => setVersion((v) => v + 1)}
          version={version}
        />
      </div>
      <div className="shrink-0 border-t p-1">
        <ComposerTools sessionKey={sessionKey} folder={folder} placement="sidebar" />
      </div>
    </aside>
  )
}
