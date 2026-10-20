import { Loader2, Share, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type ShareRef, type ShareTarget } from "@/lib/api"
import { timeAgo } from "@/lib/utils"

const refKey = (ref: ShareRef) => `${ref.kind}:${ref.id}`

/**
 * Pick other sessions and chats to add `text` to as a message at their end. Delivery waits on the
 * server while the source (`from`) or a target's agent is running.
 */
export function ForwardDialog({ text, from, onOpenChange }: { text?: string; from?: ShareRef; onOpenChange: (open: boolean) => void }) {
  const [targets, setTargets] = useState<ShareTarget[]>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const open = text !== undefined

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setTargets(undefined)
    api.shareTargets().then(
      ({ targets }) => setTargets(targets.filter((t) => !(t.kind === from?.kind && t.id === from.id))),
      (error: Error) => {
        toast.error(error.message)
        setTargets([])
      },
    )
  }, [open, from?.kind, from?.id])

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const share = async () => {
    if (!text || !selected.size) return
    setSending(true)
    try {
      const { shared, waiting } = await api.forward({ text, from, to: targets!.filter((t) => selected.has(refKey(t))).map(({ kind, id }) => ({ kind, id })) })
      const where = shared === 1 ? "1 conversation" : `${shared} conversations`
      toast.success(`Shared to ${where}${waiting ? ` · ${waiting} waiting for a running agent` : ""}`)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to other sessions</DialogTitle>
          <DialogDescription>The message is added to the end of each chosen session or chat. Where an agent is running, it waits until the agent has finished.</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 min-h-0 overflow-y-auto px-2">
          {!targets && <Loader2 className="mx-auto my-4 animate-spin text-muted-foreground" />}
          {targets?.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No other sessions or chats you can write to.</p>}
          {targets && targets.length > 0 && (
            <ul className="grid gap-1">
              {targets.map((t) => (
                <li key={refKey(t)}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
                    <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.has(refKey(t))} onChange={() => toggle(refKey(t))} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm">
                        {t.kind === "chat" && <Users className="size-3.5 shrink-0 text-muted-foreground" aria-label="Chat" />}
                        <span className="truncate">{t.title}</span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        /{t.folder} · {timeAgo(t.updatedAt)}
                      </span>
                    </span>
                    {t.running && <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><Loader2 className="size-3 animate-spin" /> running</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={sending || !selected.size} onClick={() => void share()}>
            {sending ? <Loader2 className="animate-spin" /> : <Share />} Share{selected.size > 1 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
