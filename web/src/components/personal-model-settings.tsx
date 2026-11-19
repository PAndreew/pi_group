import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { api, type PersonalModel } from "@/lib/api"

export function PersonalModelSettings() {
  const { user, saveDefaults } = useAuth()
  const defaults = user?.sessionDefaults
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.modelKeys>>>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState("openai")
  const [key, setKey] = useState("")
  const [primary, setPrimary] = useState(defaults?.personalModel)
  const [fallback, setFallback] = useState(defaults?.personalFallback)
  const load = () => api.modelKeys().then(setStatus, e => setError(e.message))
  useEffect(() => { void load() }, [])
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  if (error) return <p role="alert">{error}</p>
  if (!status) return <p>Loading personal models…</p>
  if (!status.enabled) return <p>The administrator hasn’t configured a model gateway.</p>
  const settings = (label: string, value: PersonalModel | undefined, set: (value: PersonalModel | undefined) => void) => <fieldset className="grid gap-2"><legend>{label}</legend>
    <select className="rounded border bg-background p-2" aria-label={`${label} provider`} value={value?.provider ?? ""} onChange={e => set(e.target.value ? { provider: e.target.value, model: "" } : undefined)}>
      <option value="">None</option>{status.providers.map(x => <option key={x.provider} value={x.provider}>{x.provider}{x.configured ? " · key saved" : ""}</option>)}
    </select>
    {value && <Input aria-label={`${label} model ID`} value={value.model} onChange={e => set({ ...value, model: e.target.value })} placeholder="Exact provider model ID" maxLength={200} />}
  </fieldset>
  return <div className="grid gap-3">
    <p className="text-sm text-muted-foreground">Personal models use your own key in Pi RPC sessions. Shared conversation context is sent to the provider you choose. Fallback applies only if the preferred key is missing.</p>
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void perform(async () => { await api.saveModelKey(provider, key); setKey(""); await load(); toast.success("Key saved") }) }}>
      <select className="rounded border bg-background p-2" aria-label="Key provider" value={provider} onChange={e => { setProvider(e.target.value); setKey("") }}>{status.providers.map(x => <option key={x.provider} value={x.provider}>{x.provider}{x.configured ? " · key saved" : ""}</option>)}</select>
      <Input aria-label="Provider API key" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="API key" maxLength={4096} />
      <div className="flex gap-2"><Button disabled={busy || key.length < 8}>Save key</Button><Button type="button" variant="outline" disabled={busy || !status.providers.some(x => x.provider === provider && x.configured)} onClick={() => void perform(async () => { await api.deleteModelKey(provider); setKey(""); await load(); toast.success("Key removed") })}>Remove key</Button></div>
    </form>
    {!defaults && <p className="text-sm">Save your session defaults first.</p>}
    {settings("Preferred personal model", primary, setPrimary)}
    {primary && settings("Fallback personal model", fallback, setFallback)}
    <Button disabled={busy || !defaults || !!primary && (!primary.model || !!fallback && !fallback.model)} onClick={() => void perform(async () => { await saveDefaults({ ...defaults!, personalModel: primary, personalFallback: primary ? fallback : undefined }); toast.success("Personal model settings saved") })}>Save personal model settings</Button>
  </div>
}
