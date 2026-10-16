import { Loader2, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type SessionSummary } from "@/lib/api"

export const canDelete = (session: SessionSummary) => session.access === "owner" || session.access === "admin"

export function DeleteSessionDialog({ session, onOpenChange, onDeleted }: { session?: SessionSummary; onOpenChange: (open: boolean) => void; onDeleted: (key: string) => void }) {
  const [deleting, setDeleting] = useState(false)
  const shared = session?.visibility === "shared" && session.shares.length > 0

  const remove = async () => {
    if (!session) return
    setDeleting(true)
    try {
      await api.deleteSession(session.key)
      toast.success("Session deleted")
      onDeleted(session.key)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={Boolean(session)} onOpenChange={(open) => !deleting && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete session?</DialogTitle>
          <DialogDescription>
            “{session?.name || session?.firstMessage || "Untitled session"}” will be stopped and removed{shared ? " for everyone it is shared with" : ""}. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
