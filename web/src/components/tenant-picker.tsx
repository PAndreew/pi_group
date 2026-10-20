import { useEffect, useState } from "react"
import { toast } from "sonner"
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
    <select aria-label="Tenant" className="h-9 max-w-32 rounded-md border bg-background px-2 text-sm" value={activeTenant()} disabled={busy || tenants.length < 2} onChange={e => void change(e.target.value)}>
      {tenants.length ? tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>) : <option value={activeTenant()}>…</option>}
    </select>
  )
}
