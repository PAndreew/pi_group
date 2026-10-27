import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ChevronDown, House } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"
import { clearStates } from "@/lib/state-cache"
import { activeTenant, setActiveTenant } from "@/lib/tenant"

export function TenantPicker() {
  const [tenants, setTenants] = useState<{ id: string; name: string; canShare: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [username, setUsername] = useState("")
  const share = async () => {
    setBusy(true)
    try {
      await api.shareTenant(activeTenant(), username.trim())
      toast.success("Tenant shared. Projects and conversations remain separately shared.")
      setSharing(false)
      setUsername("")
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  useEffect(() => { void api.tenants().then(r => setTenants(r.tenants), () => {}) }, [])
  const change = async (id: string) => {
    setBusy(true)
    try {
      await api.switchTenant(id)
      await clearStates()
      setActiveTenant(id)
      window.location.replace(window.location.pathname)
    } catch (error) {
      toast.error((error as Error).message)
      setBusy(false)
    }
  }
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Tenant" className="min-w-0 max-w-40 shrink-0 gap-1 px-1.5" disabled={busy || !tenants.length}>
          <House className="shrink-0" /><span className="hidden truncate sm:inline">{tenants.find(t => t.id === activeTenant())?.name ?? "…"}</span><ChevronDown className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {tenants.map(t => <DropdownMenuItem key={t.id} disabled={t.id === activeTenant()} onSelect={() => void change(t.id)}>{t.name}</DropdownMenuItem>)}
        {tenants.find(t => t.id === activeTenant())?.canShare && <DropdownMenuItem onSelect={() => setSharing(true)}>Share tenant with…</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={sharing} onOpenChange={setSharing}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share tenant with…</DialogTitle>
          <DialogDescription>Add an existing user to this tenant and its General space. Projects and conversations are not automatically shared. Tenant-wide tools and files are not yet isolated by project.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); void share() }} className="grid gap-4">
          <Input aria-label="Username" placeholder="Existing username" value={username} onChange={e => setUsername(e.target.value)} />
          <DialogFooter><Button disabled={busy || !username.trim()} type="submit">Share tenant</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
