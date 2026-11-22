import { Check, Loader2, Trash2 } from "lucide-react"
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type SessionSummary } from "@/lib/api"

export const canDelete = (session: SessionSummary) => session.access === "owner" || session.access === "admin"

type Target = { key: string; title: string }

export function useSessionDeletion(initiallyActive = false) {
  const [selection, setSelection] = useState<Map<string, Target> | undefined>(() => initiallyActive ? new Map() : undefined)
  const [confirming, setConfirming] = useState<Target[]>()
  const exclude = useCallback((keys: string[]) => {
    setSelection((current) => {
      if (!current || !keys.some((key) => current.has(key))) return current
      const next = new Map(current)
      for (const key of keys) next.delete(key)
      return next
    })
  }, [])
  return {
    active: selection !== undefined,
    selection,
    confirming,
    exclude,
    start: () => setSelection(new Map()),
    cancel: () => setSelection(undefined),
    confirm: () => selection?.size && setConfirming([...selection.values()]),
    closeConfirmation: () => setConfirming(undefined),
    toggle: (target: Target) => setSelection((current) => {
      if (!current) return current
      const next = new Map(current)
      if (!next.delete(target.key)) next.set(target.key, target)
      return next
    }),
  }
}

export type SessionDeletion = ReturnType<typeof useSessionDeletion>

export function SessionDeleteCheckbox({ selection, target, blocked }: { selection: SessionDeletion; target: Target; blocked?: string }) {
  return (
    <label className="relative flex size-9 shrink-0 items-center justify-center" title={blocked}>
      <input
        type="checkbox"
        aria-label={`Select ${target.title} for deletion${blocked ? ` (${blocked})` : ""}`}
        checked={!blocked && Boolean(selection.selection?.has(target.key))}
        disabled={Boolean(blocked)}
        onChange={() => selection.toggle(target)}
        className="peer size-5 cursor-pointer appearance-none rounded-full border border-muted-foreground checked:border-destructive checked:bg-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-35"
      />
      <Check aria-hidden="true" className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100" />
    </label>
  )
}

export function SessionDeleteToolbar({ selection }: { selection: SessionDeletion }) {
  const count = selection.selection?.size ?? 0
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
      <span className="mr-auto text-xs text-muted-foreground" role="status">{count} selected</span>
      <Button size="sm" variant="ghost" onClick={selection.cancel}>Cancel</Button>
      <Button size="sm" variant="destructive" disabled={!count} onClick={selection.confirm}><Trash2 /> Delete selected</Button>
    </div>
  )
}

export function DeleteSessionDialog({ selection, onResult }: { selection: SessionDeletion; onResult: (deleted: string[]) => void }) {
  const [deleting, setDeleting] = useState(false)
  const targets = selection.confirming
  const count = targets?.length ?? 0

  const remove = async () => {
    if (!targets?.length) return
    setDeleting(true)
    try {
      const { deleted, skipped } = await api.deleteSessions(targets.map(({ key }) => key))
      if (deleted.length) toast.success(`${deleted.length} session${deleted.length === 1 ? "" : "s"} deleted`)
      if (skipped.length) {
        toast.error(`${skipped.length} session${skipped.length === 1 ? " was" : "s were"} not deleted`, {
          description: [...new Set(skipped.map(({ reason }) => reason))].join(". "),
        })
      }
      onResult(deleted)
      selection.closeConfirmation()
      selection.cancel()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={Boolean(count)} onOpenChange={(open) => !open && !deleting && selection.closeConfirmation()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{count === 1 ? "Delete session?" : `Delete ${count} sessions?`}</DialogTitle>
          <DialogDescription>Selected sessions will be removed for everyone they are shared with. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
          {targets?.map(({ key, title }) => <li key={key} className="break-words">{title}</li>)}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={selection.closeConfirmation}>Cancel</Button>
          <Button variant="destructive" disabled={deleting || !count} onClick={() => void remove()}>
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
