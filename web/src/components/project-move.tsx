import { Check, FolderInput, Loader2, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { useProjects } from "@/lib/projects"
import { cn } from "@/lib/utils"

export interface MoveTarget {
  kind: "session" | "chat"
  id: string
  title: string
  projectId?: string
}

/** Pick the project to move a session or chat to; with other people in it, they are asked first. */
export function MoveDialog({ item, onOpenChange, onMoved }: { item?: MoveTarget; onOpenChange: (open: boolean) => void; onMoved?: () => void }) {
  const { projects, reload } = useProjects()
  const [busy, setBusy] = useState<string>()

  const move = async (to: string) => {
    if (!item) return
    setBusy(to)
    try {
      const result = await api.moveToProject(item.kind, item.id, to)
      const name = projects.find((p) => p.id === to)?.name
      if (result.moved) toast.success(`Moved to ${name}`)
      else toast.info(`Asked ${result.request!.waitingFor.join(", ")} to approve moving it to ${name}`)
      reload()
      onMoved?.()
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to project</DialogTitle>
          <DialogDescription className="break-words">“{item?.title}” keeps working in its folder. If others are in it, it moves once they all approve.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 grid min-h-0 gap-0.5 overflow-y-auto px-2">
          {projects.map((p) => {
            const current = p.id === item?.projectId
            return (
              <li key={p.id}>
                <button type="button" disabled={current || Boolean(busy)} onClick={() => void move(p.id)} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent disabled:hover:bg-transparent", current && "text-muted-foreground")}>
                  {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {current && <span className="text-xs">current</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** Moves waiting for the user's approval, and their own moves waiting for others, above the home list. */
export function MoveRequests() {
  const { user } = useAuth()
  const { moves, reload } = useProjects()
  const [busy, setBusy] = useState<string>()
  if (!moves.length) return null

  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await action()
      reload()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <ul className="grid gap-1.5 px-3 pt-2">
      {moves.map((m) => {
        const mine = m.requestedById === user?.id
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <FolderInput className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1">
              {mine ? (
                <>
                  Moving <b>{m.title}</b> to <b>{m.to}</b> waits for {m.waitingFor.join(", ")}.
                </>
              ) : (
                <>
                  <b>{m.requestedBy}</b> wants to move <b>{m.title}</b> from {m.from} to <b>{m.to}</b>.
                </>
              )}
            </span>
            {mine ? (
              <Button size="sm" variant="ghost" className="h-7" disabled={busy === m.id} onClick={() => void act(m.id, () => api.cancelMove(m.id))}>
                Cancel
              </Button>
            ) : (
              <span className="flex gap-1">
                <Button size="sm" className="h-7" disabled={busy === m.id} onClick={() => void act(m.id, () => api.answerMove(m.id, true))}>
                  <Check /> Approve
                </Button>
                <Button size="sm" variant="outline" className="h-7" disabled={busy === m.id} onClick={() => void act(m.id, () => api.answerMove(m.id, false))}>
                  <X /> Decline
                </Button>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
