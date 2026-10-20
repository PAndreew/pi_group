import { Loader2, Share } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type SessionSummary } from "@/lib/api"
import { timeAgo } from "@/lib/utils"

/**
 * Pick other sessions to add `text` to as a message at their end. Delivery waits on the server
 * while the source session (`from`) or a target's agent is running.
 */
export function ForwardDialog({ text, from, onOpenChange }: { text?: string; from?: string; onOpenChange: (open: boolean) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const open = text !== undefined

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSessions(undefined)
    api.shareTargets().then(
      ({ sessions }) => setSessions(sessions.filter((s) => s.key !== from)),
      (error: Error) => {
        toast.error(error.message)
        setSessions([])
      },
    )
  }, [open, from])

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
      const { shared, waiting } = await api.forward({ text, from, to: [...selected] })
      const where = shared === 1 ? "1 session" : `${shared} sessions`
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
          <DialogDescription>The message is added to the end of each chosen session. Where an agent is running, it waits until the agent has finished.</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 min-h-0 overflow-y-auto px-2">
          {!sessions && <Loader2 className="mx-auto my-4 animate-spin text-muted-foreground" />}
          {sessions?.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No other sessions you can write to.</p>}
          {sessions && sessions.length > 0 && (
            <ul className="grid gap-1">
              {sessions.map((s) => (
                <li key={s.key}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
                    <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm">{s.name || s.firstMessage || "Untitled session"}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        /{s.path} · {timeAgo(s.updatedAt)}
                      </span>
                    </span>
                    {s.running && <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><Loader2 className="size-3 animate-spin" /> running</span>}
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
