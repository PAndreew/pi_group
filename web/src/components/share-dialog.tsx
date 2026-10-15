import { Globe, Lock } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { type Access, api, type SessionSummary } from "@/lib/api"

export function ShareDialog({
  session,
  open,
  onOpenChange,
  onSaved,
}: {
  session: SessionSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (session: SessionSummary) => void
}) {
  const { user } = useAuth()
  const [users, setUsers] = useState<{ id: string; username: string }[]>([])
  const [shared, setShared] = useState(session.visibility === "shared")
  const [access, setAccess] = useState<Record<string, Access | "none">>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setShared(session.visibility === "shared")
    setAccess(Object.fromEntries(session.shares.map((s) => [s.userId, s.access])))
    api.directory().then((r) => setUsers(r.users), () => {})
  }, [open, session])

  const others = users.filter((u) => u.username !== session.owner)

  const save = async () => {
    setSaving(true)
    try {
      const shares = Object.entries(access)
        .filter(([, a]) => a !== "none")
        .map(([userId, a]) => ({ userId, access: a as Access }))
      const { session: next } = await api.setAcl(session.key, shared ? "shared" : "private", shares)
      onSaved(next)
      onOpenChange(false)
      toast.success(shared ? "Sharing updated" : "Session is private")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const claim = async (userId: string) => {
    try {
      const { session: next } = await api.setOwner(session.key, userId)
      onSaved(next)
      toast.success("Owner changed")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session access</DialogTitle>
          <DialogDescription>Owner: {session.owner ?? "nobody (started outside the app; admins only)"}</DialogDescription>
        </DialogHeader>

        {user?.role === "admin" && (
          <div className="flex items-center justify-between gap-3">
            <Label>Owner</Label>
            <Select value={users.find((u) => u.username === session.owner)?.id} onValueChange={claim}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder="Assign owner" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <label className="flex items-center justify-between gap-3 rounded-md border p-3">
          <span className="flex items-center gap-2 text-sm">
            {shared ? <Globe className="size-4" /> : <Lock className="size-4" />}
            {shared ? "Shared with selected users" : "Private: only the owner (and admins)"}
          </span>
          <Switch checked={shared} onCheckedChange={setShared} />
        </label>

        {shared && (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {others.length === 0 && <p className="text-sm text-muted-foreground">No other users yet. Admins can add users.</p>}
            {others.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-md px-1 py-1">
                <span className="truncate text-sm">{u.username}</span>
                <Select value={access[u.id] ?? "none"} onValueChange={(v) => setAccess((a) => ({ ...a, [u.id]: v as Access | "none" }))}>
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No access</SelectItem>
                    <SelectItem value="read">Can view</SelectItem>
                    <SelectItem value="write">Can prompt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
