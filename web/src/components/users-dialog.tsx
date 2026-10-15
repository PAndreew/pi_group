import { KeyRound, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type Role, type User } from "@/lib/api"

export function UsersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>("member")

  const load = () => api.users().then(({ users }) => setUsers(users), (error) => toast.error(error.message))
  useEffect(() => {
    if (open) void load()
  }, [open])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Users</DialogTitle>
          <DialogDescription>Everyone here can browse files and start sessions; sessions stay private unless shared.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm">{u.username}</span>
              <Select value={u.role} onValueChange={(r) => act(() => api.updateUser(u.id, { role: r as Role }), "Role updated")}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">member</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Reset password of ${u.username}`}
                onClick={() => {
                  const next = window.prompt(`New password for ${u.username} (min. 8 characters)`)
                  if (next) void act(() => api.updateUser(u.id, { password: next }), "Password reset")
                }}
              >
                <KeyRound />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={u.id === me?.id}
                aria-label={`Delete ${u.username}`}
                onClick={() => window.confirm(`Delete ${u.username}?`) && act(() => api.deleteUser(u.id), "User deleted")}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <form
          className="grid gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void act(async () => {
              await api.createUser(username.trim(), password, role)
              setUsername("")
              setPassword("")
            }, "User created")
          }}
        >
          <div className="flex items-center justify-between text-sm font-medium">
            Add user <Badge variant="outline">min. 8 char password</Badge>
          </div>
          <Input placeholder="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <Input placeholder="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <div className="flex gap-2">
            <Select value={role} onValueChange={(r) => setRole(r as Role)}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">Add</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.changePassword(current, next)
              toast.success("Password changed")
              setCurrent("")
              setNext("")
              onOpenChange(false)
            } catch (error) {
              toast.error((error as Error).message)
            }
          }}
        >
          <Input type="password" placeholder="current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <Input type="password" placeholder="new password (min. 8)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          <Button type="submit">Change</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
