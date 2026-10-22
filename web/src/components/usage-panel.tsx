import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { api, type UsageReport, type UsageTotals } from "@/lib/api"
import { cn, timeAgo } from "@/lib/utils"

const RANGES = [7, 30, 90] as const
/** Bar fill: sky-600, validated for 3:1 contrast and the lightness band on both the light and dark surfaces. */
const BAR = "#0284c7"

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)
const money = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`)
/** Everything the model read or wrote: uncached input, cache reads and writes, output. */
const volume = (t: UsageTotals) => t.input + t.cacheRead + t.cacheWrite + t.output
const prompt = (t: UsageTotals) => t.input + t.cacheRead + t.cacheWrite
const hitRate = (t: UsageTotals) => (prompt(t) ? t.cacheRead / prompt(t) : undefined)
const pct = (r?: number) => (r === undefined ? "–" : `${Math.round(r * 100)}%`)
const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="truncate text-[11px] text-muted-foreground">{detail}</span>}
    </div>
  )
}

/** Tokens per day: one series, so one hue and no legend; each column is a hover/focus target with the day's breakdown. */
function DailyChart({ days }: { days: UsageReport["days"] }) {
  const [active, setActive] = useState<number>()
  const max = Math.max(...days.map(volume), 1)
  const day = active === undefined ? undefined : days[active]
  const labelEvery = Math.ceil(days.length / 6)
  return (
    <figure className="grid gap-1.5 rounded-lg border p-3">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-medium">Tokens per day</span>
        <span className="text-muted-foreground">max {compact(max)}</span>
      </figcaption>
      <div className="relative" onMouseLeave={() => setActive(undefined)}>
        <div className="flex h-36 items-end gap-[2px] border-b border-border/70" role="list" aria-label="Tokens per day">
          {days.map((d, i) => {
            const v = volume(d)
            return (
              <button
                key={d.date}
                type="button"
                role="listitem"
                className="flex h-full min-w-0 flex-1 items-end rounded-sm outline-none focus-visible:bg-muted"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(undefined)}
                aria-label={`${shortDate(d.date)}: ${compact(v)} tokens, ${d.calls} calls`}
              >
                <span
                  className={cn("w-full rounded-t-[4px] transition-opacity", active !== undefined && active !== i && "opacity-50")}
                  style={{ height: v ? `max(2px, ${(100 * v) / max}%)` : 0, background: BAR }}
                />
              </button>
            )
          })}
        </div>
        {day && active !== undefined && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-48 rounded-md border bg-popover p-2 text-xs shadow-md"
            style={active < days.length / 2 ? { left: `${((active + 1) / days.length) * 100}%` } : { right: `${((days.length - active) / days.length) * 100}%` }}
            role="status"
          >
            <div className="mb-1 font-medium">{shortDate(day.date)}</div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-right font-medium">{compact(volume(day))}</dd>
              <dt className="text-muted-foreground">Cached input</dt>
              <dd className="text-right">{compact(day.cacheRead)}</dd>
              <dt className="text-muted-foreground">Uncached input</dt>
              <dd className="text-right">{compact(day.input + day.cacheWrite)}</dd>
              <dt className="text-muted-foreground">Output</dt>
              <dd className="text-right">{compact(day.output)}</dd>
              <dt className="text-muted-foreground">Calls · cache hit</dt>
              <dd className="text-right">
                {day.calls} · {pct(hitRate(day))}
              </dd>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="text-right">{money(day.cost)}</dd>
            </dl>
          </div>
        )}
      </div>
      <div className="flex text-[10px] text-muted-foreground">
        {days.map((d, i) => (
          <span key={d.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 ? shortDate(d.date) : ""}
          </span>
        ))}
      </div>
    </figure>
  )
}

/**
 * Token use from the per-call records of pi sessions: how much was read from the cache, how big each
 * call's context is, and what it would cost at API prices. The data behind decisions on models and context.
 */
export function UsagePanel({ onOpenSession }: { onOpenSession: (key: string, path: string) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [scope, setScope] = useState<"visible" | "mine">("visible")
  const [report, setReport] = useState<UsageReport>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    setError(undefined)
    api.usage(days, scope).then(
      (r) => alive && setReport(r),
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [days, scope])

  const t = report?.totals
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <Button key={r} size="sm" variant={days === r ? "secondary" : "ghost"} className="h-7" aria-pressed={days === r} onClick={() => setDays(r)}>
              {r} days
            </Button>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Sessions">
          {(
            [
              ["visible", "All I can see"],
              ["mine", "Only mine"],
            ] as const
          ).map(([value, label]) => (
            <Button key={value} size="sm" variant={scope === value ? "secondary" : "ghost"} className="h-7" aria-pressed={scope === value} onClick={() => setScope(value)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!report && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
      {report && t && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Tokens" value={compact(volume(t))} detail={`${t.calls.toLocaleString()} model calls`} />
            <Tile label="Cache hit rate" value={pct(hitRate(t))} detail={`${compact(t.cacheRead)} of ${compact(prompt(t))} cached`} />
            <Tile label="Context per call" value={t.calls ? compact(prompt(t) / t.calls) : "–"} detail={t.calls ? `output ${compact(t.output / t.calls)} per call` : undefined} />
            <Tile label="Cost at API prices" value={money(t.cost)} detail={t.reasoning ? `${compact(t.reasoning)} reasoning tokens` : `output ${compact(t.output)}`} />
          </div>

          {t.calls === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No model calls in this period.</p>
          ) : (
            <>
              <DailyChart days={report.days} />

              <section className="grid gap-1.5">
                <h3 className="text-xs font-medium">By model</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-1.5 font-normal">Model</th>
                        <th className="py-1.5 text-right font-normal">Calls</th>
                        <th className="py-1.5 text-right font-normal">Cached in</th>
                        <th className="py-1.5 text-right font-normal">Uncached in</th>
                        <th className="py-1.5 text-right font-normal">Output</th>
                        <th className="py-1.5 text-right font-normal">Hit</th>
                        <th className="py-1.5 text-right font-normal">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.models.map((m) => (
                        <tr key={`${m.provider}/${m.model}`} className="border-b last:border-0">
                          <td className="max-w-48 py-1.5 pr-2">
                            <div className="truncate">{m.model ?? "unknown"}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{m.provider}</div>
                          </td>
                          <td className="py-1.5 text-right">{m.calls.toLocaleString()}</td>
                          <td className="py-1.5 text-right">{compact(m.cacheRead)}</td>
                          <td className="py-1.5 text-right">{compact(m.input + m.cacheWrite)}</td>
                          <td className="py-1.5 text-right">{compact(m.output)}</td>
                          <td className="py-1.5 text-right">{pct(hitRate(m))}</td>
                          <td className="py-1.5 text-right">{money(m.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid gap-1.5">
                <h3 className="text-xs font-medium">Top sessions</h3>
                <ul className="grid gap-1">
                  {report.sessions.slice(0, 10).map((s) => (
                    <li key={s.key} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpenSession(s.key, s.path)}>
                        {s.name}
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          /{s.path} · {timeAgo(new Date(s.lastAt).toISOString())}
                        </span>
                      </button>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {compact(volume(s))} · {s.calls} calls · {pct(hitRate(s))} hit · {money(s.cost)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <p className="text-[11px] text-muted-foreground">
            Counts every model call recorded in pi session files, including abandoned branches. Costs use the provider’s API list prices; on a subscription (such as ChatGPT for Codex) you are not billed per token.
            {report.untracked.length > 0 && ` Sessions of ${report.untracked.join(", ")} keep no per-call usage and are not included.`}
          </p>
        </>
      )}
    </div>
  )
}
