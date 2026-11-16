import { useEffect, useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"

export type ExplorerState = { open: boolean; folder: string; query: string }

/**
 * The file explorer (folders, files, and each folder's sessions) in a modal. Its folder and search
 * live with the app, so it reopens where it was after a file opened from it is closed.
 */
export function ExplorerDialog({ state, onChange, onFile }: { state: ExplorerState; onChange: (state: ExplorerState) => void; onFile: (path: string) => void }) {
  const nav = useNav()
  const [rootName, setRootName] = useState("root")
  const [version, setVersion] = useState(0)
  const { open, folder, query } = state

  useEffect(() => {
    if (open) api.fsInfo().then(({ rootName }) => setRootName(rootName), () => {})
  }, [open])

  const close = <T extends unknown[]>(action: (...args: T) => void) => (...args: T) => {
    onChange({ ...state, open: false })
    action(...args)
  }

  return (
    <Dialog open={open} onOpenChange={(open) => onChange({ ...state, open })}>
      <DialogContent className="flex h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Folders</DialogTitle>
        <DialogDescription className="sr-only">Folders, files and the sessions in each folder</DialogDescription>
        <div className="min-h-0 flex-1 pt-6">
          <Sidebar
            rootName={rootName}
            folder={folder}
            onFolder={(folder) => onChange({ ...state, folder, query: "" })}
            query={query}
            onQuery={(query) => onChange({ ...state, query })}
            onSession={close((key: string) => nav.openSession(key))}
            onFile={onFile}
            onNewSession={close(() => nav.newSession(folder))}
            onSessionDeleted={() => setVersion((v) => v + 1)}
            version={version}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
