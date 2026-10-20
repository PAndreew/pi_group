import { useEffect, useState } from "react"
import { toast } from "sonner"
import { House } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"
import { clearStates } from "@/lib/state-cache"
import { activeTenant, setActiveTenant } from "@/lib/tenant"

export function TenantPicker() {
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="Tenant" className="min-w-0 max-w-40" disabled={busy || tenants.length < 2}>
          <House className="shrink-0" /><span className="truncate">{tenants.find(t => t.id === activeTenant())?.name ?? "…"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {tenants.map(t => <DropdownMenuItem key={t.id} disabled={t.id === activeTenant()} onSelect={() => void change(t.id)}>{t.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
