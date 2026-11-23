import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { api, type MemoryCacheSettings } from "@/lib/api"

/** Prompt-cache lifetime per provider: a quiet session updates memory 30 seconds before its cache expires. */
export function MemoryCacheSettingsPanel() {
  const { user } = useAuth()
  const admin = user?.role === "admin"
  const [settings, setSettings] = useState<MemoryCacheSettings>()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const load = () => api.memoryCache().then(s => { setSettings(s); setDraft(Object.fromEntries(s.providers.map(p => [p.provider, String(p.minutes)]))) }, e => toast.error(e.message))
  useEffect(() => { void load() }, [])
  const save = async () => {
    if (!settings) return
    const changes: Record<string, number | null> = {}
    for (const p of settings.providers) {
      const value = Number(draft[p.provider])
      if (!Number.isFinite(value) || value < 1) return void toast.error(`${p.provider}: at least 1 minute`)
      changes[p.provider] = value === p.defaultMinutes ? null : value
    }
    try { await api.saveMemoryCache(changes); toast.success("Cache timings saved"); await load() } catch (e) { toast.error((e as Error).message) }
  }
  return <div className="grid gap-2">
    <Label>Memory update timing per provider</Label>
    <p className="text-xs text-muted-foreground">A session updates project memory once it has been quiet until 30 seconds before its provider's prompt cache expires, so the update reads the conversation from cache. Defaults are the providers' cache lifetimes{settings?.longRetention ? " with long retention (PI_CACHE_RETENTION=long)" : ""}. Group chats without pi wait {settings?.chatIdleMinutes ?? 15} minutes after their last message.{admin ? "" : " Only admins can change these."}</p>
    <ul className="grid gap-1">{settings?.providers.map(p => <li key={p.provider} className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{p.provider}</span>
      <Input type="number" min={1} max={1440} className="h-8 w-24" disabled={!admin} value={draft[p.provider] ?? ""} onChange={e => setDraft({ ...draft, [p.provider]: e.target.value })} aria-label={`${p.provider} cache minutes`} />
      <span className="w-28 text-xs text-muted-foreground">min (default {p.defaultMinutes})</span>
    </li>)}</ul>
    {settings && !settings.providers.length && <p className="text-sm text-muted-foreground">No providers available.</p>}
    {admin && !!settings?.providers.length && <div><Button variant="outline" size="sm" onClick={() => void save()}>Save timings</Button></div>}
  </div>
}
