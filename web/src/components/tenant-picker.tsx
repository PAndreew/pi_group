import { useLocale } from "@/lib/i18n"
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
  const { t: tr } = useLocale()
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
        <Button variant="ghost" size="sm" aria-label={tr("ui.tenant-3ca93c")} className="min-w-0 max-w-40 shrink-0 gap-1 px-1.5" disabled={busy || !tenants.length}>
          <House className="shrink-0" /><span className="truncate">{tenants.find(t => t.id === activeTenant())?.name ?? "…"}</span><ChevronDown className="shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {tenants.map(t => <DropdownMenuItem key={t.id} disabled={t.id === activeTenant()} onSelect={() => void change(t.id)}>{t.name}</DropdownMenuItem>)}
        {tenants.find(t => t.id === activeTenant())?.canShare && <DropdownMenuItem onSelect={() => setSharing(true)}>{tr("ui.share-tenant-with-ee2e37")}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={sharing} onOpenChange={setSharing}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("ui.share-tenant-with-ee2e37")}</DialogTitle>
          <DialogDescription>{tr("ui.add-an-existing-user-to-this-tenant-8d57b4")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); void share() }} className="grid gap-4">
          <Input aria-label={tr("ui.username-84c290")} placeholder={tr("ui.existing-username-c1f4e6")} value={username} onChange={e => setUsername(e.target.value)} />
          <DialogFooter><Button disabled={busy || !username.trim()} type="submit">{tr("ui.share-tenant-8c31e4")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
