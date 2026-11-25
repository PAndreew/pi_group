import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { api, type MemoryModelSettings } from "@/lib/api"

const CHEAPEST = "__cheapest__"
const price = (cost?: { input: number; output: number }) => cost ? ` · $${cost.input}/$${cost.output} per M` : ""

/** The model hourly memory syncs use, per provider: the cheapest unless an admin picks one. */
export function MemoryModelSettingsPanel() {
  const { user } = useAuth()
  const admin = user?.role === "admin"
  const [settings, setSettings] = useState<MemoryModelSettings>()
  const load = () => api.memoryModel().then(setSettings, e => toast.error(e.message))
  useEffect(() => { void load() }, [])
  const choose = async (provider: string, value: string) => {
    try { await api.saveMemoryModel({ [provider]: value === CHEAPEST ? null : value }); await load() } catch (e) { toast.error((e as Error).message) }
  }
  return <div className="grid min-w-0 gap-2">
    <p className="text-xs text-muted-foreground">
      Every {settings?.syncMinutes ?? 60} minutes, a short-lived session reads what was said in the project's sessions and group chats since the last sync (messages only: no thinking, no tool output), updates the topics and the overview, and is deleted. It runs on your default provider{settings?.current ? <> (now <strong>{settings.current.provider}/{settings.current.id}</strong>)</> : null}.{admin ? "" : " Only admins can change the model."}
    </p>
    <ul className="grid gap-1">{settings?.providers.map(p => <li key={p.provider} className="flex min-w-0 items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{p.provider}</span>
      <Select value={p.configured && p.models.some(m => m.id === p.configured) ? p.configured : CHEAPEST} disabled={!admin} onValueChange={v => void choose(p.provider, v)}>
        <SelectTrigger size="sm" className="w-56 max-w-[60%] text-xs" aria-label={`${p.provider} memory model`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={CHEAPEST}>Cheapest{p.cheapest ? ` (${p.cheapest})` : ""}</SelectItem>
          {p.models.map(m => <SelectItem key={m.id} value={m.id}>{m.name}{price(m.cost)}</SelectItem>)}
        </SelectContent>
      </Select>
    </li>)}</ul>
    {settings && !settings.providers.length && <p className="text-sm text-muted-foreground">No providers available.</p>}
  </div>
}
