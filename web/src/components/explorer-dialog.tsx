import { useEffect, useState } from "react"
import { Sidebar } from "@/components/sidebar"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useNav } from "@/lib/nav"

/** The file explorer (folders, files, and each folder's sessions) in a modal, starting at `folder`. */
export function ExplorerDialog({ folder: start, open, onOpenChange }: { folder: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const nav = useNav()
  const [folder, setFolder] = useState(start)
  const [rootName, setRootName] = useState("root")
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (open) setFolder(start)
  }, [open, start])

  useEffect(() => {
    if (open) api.fsInfo().then(({ rootName }) => setRootName(rootName), () => {})
  }, [open])

  const close = <T extends unknown[]>(action: (...args: T) => void) => (...args: T) => {
    onOpenChange(false)
    action(...args)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Folders</DialogTitle>
        <DialogDescription className="sr-only">Folders, files and the sessions in each folder</DialogDescription>
        <div className="min-h-0 flex-1 pt-6">
          <Sidebar
            rootName={rootName}
            folder={folder}
            onFolder={setFolder}
            onSession={close((key: string) => nav.openSession(key))}
            onFile={close(nav.openFile)}
            onNewSession={close(() => nav.newSession(folder))}
            onSessionDeleted={() => setVersion((v) => v + 1)}
            version={version}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
