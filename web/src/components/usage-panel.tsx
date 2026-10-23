import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { api, type UsageReport, type UsageTotals } from "@/lib/api"

const RANGES = [7, 30, 90] as const
const STEP = 10_000_000
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)
const money = (n: number) => n > 0 && n < .01 ? "<$0.01" : `$${n.toFixed(2)}`
const volume = (t: UsageTotals) => t.input + t.output + t.cacheRead + t.cacheWrite
const prompt = (t: UsageTotals) => t.input + t.cacheRead + t.cacheWrite
const hit = (t: UsageTotals) => prompt(t) ? `${Math.round(t.cacheRead / prompt(t) * 100)}%` : "–"
const metrics = {
  tokens: { label: "Total tokens", format: (t: UsageTotals) => compact(volume(t)) },
  input: { label: "Input tokens", format: (t: UsageTotals) => compact(t.input) },
  output: { label: "Output tokens", format: (t: UsageTotals) => compact(t.output) },
  cacheRead: { label: "Cache read", format: (t: UsageTotals) => compact(t.cacheRead) },
  cacheWrite: { label: "Cache write", format: (t: UsageTotals) => compact(t.cacheWrite) },
  calls: { label: "Calls", format: (t: UsageTotals) => compact(t.calls) },
  hit: { label: "Cache hit", format: hit },
  cost: { label: "Cost", format: (t: UsageTotals) => money(t.cost) },
}
type Metric = keyof typeof metrics
const desktopMetrics: Metric[] = ["tokens", "calls", "hit", "cost"]
const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function DailyChart({ days }: { days: UsageReport["days"] }) {
  const [active, setActive] = useState<number>()
  const max = Math.max(STEP, Math.ceil(Math.max(0, ...days.map(volume)) / STEP) * STEP)
  const ticks = Array.from({ length: max / STEP + 1 }, (_, i) => i * STEP)
  const height = Math.max(144, (ticks.length - 1) * 24)
  const day = active === undefined ? undefined : days[active]
  return <figure className="grid min-w-0 gap-3 rounded-lg border p-3">
    <figcaption className="text-xs font-medium">Tokens per day</figcaption>
    <div className="flex min-w-0 gap-2 pt-2">
      <div className="relative w-12 shrink-0 text-right text-[10px] text-muted-foreground" style={{ height }} aria-label="Tokens in increments of 10 million">
        {ticks.map(tick => <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - tick / max * 100}%` }}>{tick / 1_000_000}M</span>)}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Scrollable daily token graph">
        <div style={{ minWidth: Math.max(240, days.length * 36) }}>
          <div className="relative" style={{ height }}>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">{ticks.map(tick => <div key={tick} className="border-t border-border/70" />)}</div>
            <div className="relative flex h-full items-end gap-1">
              {days.map((d, i) => <button key={d.date} type="button" className="flex h-full min-w-0 flex-1 items-end outline-none focus-visible:bg-muted" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(undefined)} onFocus={() => setActive(i)} onBlur={() => setActive(undefined)} onClick={() => setActive(i)} aria-label={`${shortDate(d.date)}: ${compact(volume(d))} tokens, ${d.calls} calls`}>
                <span className="w-full rounded-t-sm" style={{ height: volume(d) ? `max(2px, ${volume(d) / max * 100}%)` : 0, background: "#0284c7" }} />
              </button>)}
            </div>
          </div>
          <div className="mt-1 flex gap-1 text-center text-[10px] text-muted-foreground">{days.map((d, i) => <span key={d.date} className="min-w-0 flex-1 whitespace-nowrap">{i % 2 === 0 ? shortDate(d.date) : ""}</span>)}</div>
        </div>
      </div>
    </div>
    <div className="min-h-8 text-xs text-muted-foreground" role="status">{day ? `${shortDate(day.date)}: ${compact(volume(day))} tokens · ${compact(day.cacheRead)} cached · ${compact(day.input)} input · ${compact(day.cacheWrite)} cache write · ${compact(day.output)} output · ${day.calls} calls · ${hit(day)} hit · ${money(day.cost)}` : "Select a day for details."}</div>
  </figure>
}

function UsageTable({ title, rows, metric, onOpen }: { title: string; rows: { key: string; name: string; detail?: string; totals: UsageTotals; path?: string }[]; metric: Metric; onOpen?: (key: string, path: string) => void }) {
  return <section className="min-w-0">
    <h3 className="mb-2 text-xs font-medium">{title}</h3>
    <table className="w-full table-fixed text-xs tabular-nums">
      <thead><tr className="border-b text-muted-foreground">
        <th className="w-3/5 py-2 text-left font-normal sm:w-2/5">Name</th>
        <th className="text-right font-normal sm:hidden">{metrics[metric].label}</th>
        {desktopMetrics.map(key => <th key={key} className="hidden text-right font-normal sm:table-cell">{metrics[key].label}</th>)}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.key} className="border-b last:border-0">
        <td className="py-2 pr-2">
          {onOpen ? <button type="button" title={row.name} className="block w-full truncate text-left text-sm hover:underline" onClick={() => onOpen(row.key, row.path ?? "")}>{row.name}</button> : <div className="truncate text-sm" title={row.name}>{row.name}</div>}
          {row.detail && <div className="hidden truncate text-[11px] text-muted-foreground sm:block">{row.detail}</div>}
        </td>
        <td className="text-right sm:hidden">{metrics[metric].format(row.totals)}</td>
        {desktopMetrics.map(key => <td key={key} className="hidden text-right sm:table-cell">{metrics[key].format(row.totals)}</td>)}
      </tr>)}</tbody>
    </table>
  </section>
}

export function UsagePanel({ onOpenSession }: { onOpenSession: (key: string, path: string) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [scope, setScope] = useState<"visible" | "mine">("visible")
  const [report, setReport] = useState<UsageReport>()
  const [error, setError] = useState<string>()
  const [metric, setMetric] = useState<Metric>("tokens")
  useEffect(() => {
    let alive = true
    setError(undefined)
    api.usage(days, scope).then(r => alive && setReport(r), (e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [days, scope])
  const t = report?.totals
  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Time range">{RANGES.map(r => <Button key={r} size="sm" variant={days === r ? "secondary" : "ghost"} className="h-7" aria-pressed={days === r} onClick={() => setDays(r)}>{r} days</Button>)}</div>
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Sessions">{([["visible", "All I can see"], ["mine", "Only mine"]] as const).map(([value, label]) => <Button key={value} size="sm" variant={scope === value ? "secondary" : "ghost"} className="h-7" aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</Button>)}</div>
    </div>
    {error && <p className="break-words text-sm text-destructive">{error}</p>}
    {!report && !error && <Loader2 className="mx-auto animate-spin" />}
    {report && t && <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[
        ["Tokens", compact(volume(t)), `${t.calls.toLocaleString()} model calls`],
        ["Cache hit rate", hit(t), `${compact(t.cacheRead)} of ${compact(prompt(t))} cached`],
        ["Context per call", t.calls ? compact(prompt(t) / t.calls) : "–", `output ${compact(t.calls ? t.output / t.calls : 0)} per call`],
        ["Cost at API prices", money(t.cost), t.reasoning ? `${compact(t.reasoning)} reasoning tokens` : `output ${compact(t.output)}`],
      ].map(([label, value, detail]) => <div key={label} className="grid min-w-0 gap-0.5 rounded-lg border p-3"><span className="text-xs text-muted-foreground">{label}</span><span className="break-all text-xl font-semibold tabular-nums">{value}</span><span className="truncate text-[11px] text-muted-foreground">{detail}</span></div>)}</div>
      {t.calls === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No model calls in this period.</p> : <>
        <DailyChart days={report.days} />
        <label className="flex min-w-0 items-center justify-between gap-2 text-xs sm:hidden">Table attribute<select aria-label="Table attribute" className="min-w-0 rounded-md border bg-background p-2" value={metric} onChange={e => setMetric(e.target.value as Metric)}>{Object.entries(metrics).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <UsageTable title="By model" metric={metric} rows={report.models.map(m => ({ key: `${m.provider}/${m.model}`, name: m.model ?? "unknown", detail: m.provider, totals: m }))} />
        <UsageTable title="Top sessions" metric={metric} onOpen={onOpenSession} rows={report.sessions.slice(0, 10).map(s => ({ key: s.key, name: s.name, detail: `/${s.path}`, path: s.path, totals: s }))} />
      </>}
      <p className="break-words text-[11px] text-muted-foreground">Counts every model call recorded in pi session files, including abandoned branches. Costs use the provider’s API list prices; on a subscription (such as ChatGPT for Codex) you are not billed per token.{report.untracked.length > 0 && ` Sessions of ${report.untracked.join(", ")} keep no per-call usage and are not included.`}</p>
    </>}
  </div>
}
