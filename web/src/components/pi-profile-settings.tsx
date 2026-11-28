import { useLocale } from "@/lib/i18n"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { api, type ModelInfo, type SessionDefaults } from "@/lib/api"

export function PiProfileSettings({ onConnected, loginOnly }: { onConnected?: () => void; loginOnly?: boolean } = {}) {
  const { t: tr } = useLocale()
  const { user } = useAuth()
  const admin = user?.role === "admin"
  const [connected, setConnected] = useState(false)
  const [provider, setProvider] = useState("anthropic")
  const [key, setKey] = useState("")
  const [models, setModels] = useState<ModelInfo[]>([])
  const [fallback, setFallback] = useState<SessionDefaults["model"]>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api.piProfile().then(x => setConnected(x.connected)).catch(e => toast.error(e.message))
    if (loginOnly) return
    void api.sharedPiFallback().then(x => setFallback(x.model ?? undefined)).catch(e => toast.error(e.message))
    if (admin) void api.sharedPiModels().then(x => setModels(x.models)).catch(e => toast.error(e.message))
  }, [admin, loginOnly])
  async function perform(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void perform(async () => {
      await api.savePiProfile(provider, key.trim()); setKey(""); setConnected(true); onConnected?.(); toast.success("Connection saved. Choose a Pi model in Model settings.")
    }) }}>
      <h3 className="font-medium">{tr("ui.connect-a-provider-6967f2")}</h3>
      <p className="text-sm text-muted-foreground">{connected ? "A Pi profile is connected. Saving a key updates only the selected provider." : "Connect your own provider, then choose a Pi RPC model in Model settings."} {tr("ui.keys-use-pi-s-native-local-storage--2d50c0")}</p>
      <select className="w-full min-w-0 rounded border bg-background p-2" aria-label={tr("ui.provider-7ceee3")} value={provider} onChange={e => { setProvider(e.target.value); setKey("") }}>
        <option value="anthropic">Anthropic</option><option value="google">{tr("ui.google-gemini-2f9610")}</option><option value="openrouter">{tr("ui.openrouter-12ecf7")}</option><option value="openai">{tr("ui.openai-api-9a216c")}</option><option value="zai">{tr("ui.zhipu-ai-z-ai-1af895")}</option><option value="zai-coding-cn">{tr("ui.zhipu-ai-coding-china-c404cd")}</option>
      </select>
      <Input type="password" autoComplete="off" aria-label={tr("ui.provider-api-key-593b11")} placeholder={tr("ui.api-key-cf678c")} value={key} maxLength={4096} onChange={e => setKey(e.target.value)}/>
      <Button disabled={busy || key.trim().length < 8}>{tr("ui.save-connection-07796d")}</Button>
    </form>
    {!loginOnly && <section className="grid gap-2 border-t pt-3">
      <h3 className="font-medium">{tr("ui.workspace-fallback-b35991")}</h3>
      <p className="text-sm text-muted-foreground">{tr("ui.uses-the-server-s-existing-pi-login-91d8cf")}</p>
      {admin ? <><ModelPicker models={models} value={fallback} onChange={setFallback} showProvider />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !fallback} onClick={() => void perform(async () => { await api.saveSharedPiFallback(fallback!); toast.success("Workspace fallback saved") })}>{tr("ui.save-fallback-2dc3b5")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await api.saveSharedPiFallback(null); setFallback(undefined); toast.success("Workspace fallback disabled") })}>{tr("ui.disable-fallback-daf2fd")}</Button>
        </div></> : <p className="text-sm break-all">{fallback ? `${fallback.provider} / ${fallback.id}` : "Not configured"}</p>}
    </section>}
  </div>
}
