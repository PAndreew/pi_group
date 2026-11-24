import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { api, type ModelInfo, type SessionDefaults } from "@/lib/api"

export function PiProfileSettings({ onConnected }: { onConnected?: () => void } = {}) {
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
    void api.sharedPiFallback().then(x => setFallback(x.model ?? undefined)).catch(e => toast.error(e.message))
    if (admin) void api.sharedPiModels().then(x => setModels(x.models)).catch(e => toast.error(e.message))
  }, [admin])
  async function perform(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void perform(async () => {
      await api.savePiProfile(provider, key.trim()); setKey(""); setConnected(true); onConnected?.(); toast.success("Connection saved. Choose your model above.")
    }) }}>
      <h3 className="font-medium">Connect a provider</h3>
      <p className="text-sm text-muted-foreground">{connected ? "A Pi profile is connected. Saving a key replaces the previous provider in a Beezy-managed profile." : "Connect your own provider, then choose a Pi RPC model above."} Keys use Pi’s native local storage. Use only on a trusted server.</p>
      <select className="w-full min-w-0 rounded border bg-background p-2" aria-label="Provider" value={provider} onChange={e => { setProvider(e.target.value); setKey("") }}>
        <option value="anthropic">Anthropic</option><option value="google">Google Gemini</option><option value="openrouter">OpenRouter</option><option value="openai">OpenAI API</option><option value="zai">Zhipu AI (Z.AI)</option><option value="zai-coding-cn">Zhipu AI Coding (China)</option>
      </select>
      <Input type="password" autoComplete="off" aria-label="Provider API key" placeholder="API key" value={key} maxLength={4096} onChange={e => setKey(e.target.value)}/>
      <Button disabled={busy || key.trim().length < 8}>Save connection</Button>
    </form>
    <section className="grid gap-2 border-t pt-3">
      <h3 className="font-medium">Workspace fallback</h3>
      <p className="text-sm text-muted-foreground">Uses the server’s existing Pi login only when a personal model is unavailable before a turn. It never retries a failed or partially completed turn.</p>
      {admin ? <><ModelPicker models={models} value={fallback} onChange={setFallback} showProvider />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !fallback} onClick={() => void perform(async () => { await api.saveSharedPiFallback(fallback!); toast.success("Workspace fallback saved") })}>Save fallback</Button>
          <Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await api.saveSharedPiFallback(null); setFallback(undefined); toast.success("Workspace fallback disabled") })}>Disable fallback</Button>
        </div></> : <p className="text-sm break-all">{fallback ? `${fallback.provider} / ${fallback.id}` : "Not configured"}</p>}
    </section>
  </div>
}
