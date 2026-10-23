import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/hooks/use-auth"
import { api, type AssistanceSettings, type AssistanceStatus } from "@/lib/api"

const features = [
  { key: "injectionChecks", title: "Prompt injection checks — Clef", description: "Check prompts and tool text. Suspicious or unchecked prompts are rejected; suspicious or unchecked tool content is withheld. Not a security guarantee. Image prompts require turning this off." },
  { key: "contextExtraction", title: "Relevant tool context — Clairic", description: "Extract source passages from large tool results before the agent reads them. Original results stay in the transcript and can be retrieved. Exact file reads and errors are preserved." },
  { key: "toolSelection", title: "Tool selection — Clairic", description: "Keep the full registered tool list outside the agent context. The agent discovers and activates selected tools as needed. Selected schemas still enter context." },
] as const

export function AssistanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { saveAssistance } = useAuth()
  const [status, setStatus] = useState<AssistanceStatus>()
  const [settings, setSettings] = useState<AssistanceSettings>()
  const [saving, setSaving] = useState(false)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const load = () => api.assistanceStatus().then(s => { setStatus(s); setSettings(s.settings) }, error => toast.error(error.message))
  useEffect(() => { if (open) void load() }, [open])
  const save = async () => {
    if (!settings) return
    setSaving(true)
    try { await saveAssistance(settings); toast.success("Cloudflare settings saved"); await load() }
    catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cloudflare assistance</DialogTitle>
          <DialogDescription>Optional, paid features for the pi harness. All off by default. Enabled features send relevant prompts, tool descriptions or tool results to Cloudflare. Do not enable for sensitive work unless this is acceptable.</DialogDescription>
        </DialogHeader>
        {status && !status.configured && <p className="rounded border border-amber-500/40 p-3 text-sm">Not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the server. One Workers AI token serves both models. No API calls have been made to check connectivity.</p>}
        {settings && <>
          <div className="space-y-5">
            {features.map(feature => <div key={feature.key} className="flex items-start gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor={feature.key}>{feature.title}</Label>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </div>
              <Switch id={feature.key} checked={settings[feature.key]} disabled={saving || (!status?.configured && !settings[feature.key])} onCheckedChange={checked => setSettings({ ...settings, [feature.key]: checked })} />
            </div>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="assistance-budget">Daily budget (USD)</Label><Input id="assistance-budget" type="number" min={0} max={10} step={0.1} value={settings.dailyBudgetUsd} onChange={e => setSettings({ ...settings, dailyBudgetUsd: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="assistance-calls">Calls per run</Label><Input id="assistance-calls" type="number" min={1} max={100} value={settings.maxCallsPerRun} onChange={e => setSettings({ ...settings, maxCallsPerRun: Number(e.target.value) })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Clef: $0.24 / million input tokens. Clairic: $0.10 / million input tokens. Usage uses provider-reported tokens; failed calls retain a conservative reservation. Limits are spending guards, not a billing guarantee. Enabling takes effect on your next idle run; disabling stops new calls at the next runtime check. Wait for a run to finish before changing its initiating user/settings.</p>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSettings({ ...settings, injectionChecks: false, contextExtraction: false, toolSelection: false })}>Turn all off</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button></div>
        </>}
        {status && <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Auxiliary usage</h3><Button variant="ghost" size="sm" onClick={load}>Refresh</Button></div>
          <p className="text-xs text-muted-foreground">{status.meter?.day === today ? `${status.meter.calls} calls · $${status.meter.cost.toFixed(5)} today (UTC)` : "No calls today"}. Separate from main-agent usage.</p>
          <div className="max-h-48 space-y-2 overflow-y-auto text-xs">{status.records.slice(-20).reverse().map((r, i) => <div key={`${r.timestamp}-${i}`} className="rounded border p-2"><div>{r.model} · {r.purpose} · ${r.cost.toFixed(6)} · {r.latencyMs} ms</div><div className="text-muted-foreground">{r.status} · {r.inputTokens ?? "unknown"} input tokens · {new Date(r.timestamp).toLocaleString()}</div><div className="truncate text-muted-foreground" title={r.runId}>Run {r.runId}</div></div>)}</div>
        </div>}
      </DialogContent>
    </Dialog>
  )
}
