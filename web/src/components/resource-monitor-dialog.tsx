import { useLocale } from "@/lib/i18n"
import { Loader2, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UsagePanel } from "@/components/usage-panel"
import { api, type MonitorReport, type MonitorSession } from "@/lib/api"
import { cn, formatBytes, timeAgo } from "@/lib/utils"

const REFRESH_MS = 3000

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)
const percent = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`

function duration(seconds: number) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

/** Stat tile: label, value, one muted line of context. */
function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
      {detail && <span className="truncate text-[11px] text-muted-foreground">{detail}</span>}
    </div>
  )
}

/** Meter: the fill carries severity, the track is a lighter step of the same hue, and the state is also written out. */
function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const { t: tr } = useLocale()
  const ratio = total > 0 ? used / total : 0
  const level = ratio >= 0.9 ? "critical" : ratio >= 0.75 ? "high" : "ok"
  const hue = level === "critical" ? "#d03b3b" : level === "high" ? "#fab219" : "var(--color-sky-500)"
  return (
    <div className="grid gap-1.5" title={`${formatBytes(used)} of ${formatBytes(total)} used`}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          {level !== "ok" && <TriangleAlert className="size-3" style={{ color: hue }} />}
          {level !== "ok" && <span className="text-muted-foreground">{level === "critical" ? "Critical" : "High"} ·</span>}
          <span className="font-medium">{formatBytes(used)}</span>
          <span className="text-muted-foreground">{tr("ui.of-de04fa")} {formatBytes(total)}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${hue} 22%, transparent)` }}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(ratio * 100, 100)}%`, background: hue }} />
      </div>
    </div>
  )
}

const dash = <span className="text-muted-foreground/60">–</span>

function memoryOf(s: MonitorSession) {
  if (s.rssBytes !== undefined) return formatBytes(s.rssBytes)
  return s.pid ? dash : <span className="text-muted-foreground">in server</span>
}

function tokensOf(s: MonitorSession) {
  const total = s.tokens?.total ?? (s.tokens ? (s.tokens.input ?? 0) + (s.tokens.output ?? 0) + (s.tokens.cacheRead ?? 0) + (s.tokens.cacheWrite ?? 0) : undefined)
  if (total === undefined && s.cost === undefined) return dash
  return (
    <>
      {total !== undefined && compact(total)}
      {s.cost !== undefined && <span className="text-muted-foreground"> · ${s.cost.toFixed(2)}</span>}
    </>
  )
}

function SessionName({ s, onOpen }: { s: MonitorSession; onOpen: (s: MonitorSession) => void }) {
  return (
    <button type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:underline" onClick={() => onOpen(s)}>
      <span className={cn("size-2 shrink-0 rounded-full", s.running ? "animate-pulse bg-green-500" : "bg-sky-500")} />
      <span className="truncate">{s.name}</span>
      <span className="sr-only">{s.running ? "running" : "idle"}</span>
    </button>
  )
}

/**
 * Machine health (CPU, memory left, disk) and live sessions, refreshed while open, plus a tab with
 * token usage over time.
 */
export function ResourceMonitorDialog({ open, onOpenChange, onOpenSession }: { open: boolean; onOpenChange: (open: boolean) => void; onOpenSession: (s: { key: string; path: string }) => void }) {
  const { t: tr, language } = useLocale()
  const [report, setReport] = useState<MonitorReport>()
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState("resources")

  useEffect(() => {
    if (!open || tab !== "resources") return
    let alive = true
    const load = () =>
      api.monitor().then(
        (r) => alive && (setReport(r), setError(undefined)),
        (e: Error) => alive && setError(e.message),
      )
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [open, tab])

  const sessions = report?.sessions ?? []
  const running = sessions.filter((s) => s.running).length
  const sessionMemory = sessions.reduce((sum, s) => sum + (s.rssBytes ?? 0), 0)
  const processes = sessions.reduce((sum, s) => sum + (s.processes ?? 0), 0)
  const sys = report?.system
  const openSession = (s: { key: string; path: string }) => {
    onOpenChange(false)
    onOpenSession(s)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tr("ui.resource-monitor-c09973")}</DialogTitle>
          <DialogDescription>{sys ? `${sys.hostname} · ${sys.platform} · up ${duration(sys.uptimeSec)}` : "Machine health, live sessions and token usage."}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className="min-h-0 min-w-0">
          <TabsList>
            <TabsTrigger value="resources">{tr("ui.resources-87df60")}</TabsTrigger>
            <TabsTrigger value="usage">{tr("ui.token-usage-545c3d")}</TabsTrigger>
          </TabsList>
          <TabsContent value="usage" className="-mx-2 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-2 pb-1">
            <UsagePanel onOpenSession={(key, path) => openSession({ key, path })} />
          </TabsContent>
          <TabsContent value="resources" className="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 pb-1">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!report && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
            {report && sys && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile
                    label="CPU"
                    value={sys.cpuPercent === undefined ? "n/a" : percent(sys.cpuPercent)}
                    detail={sys.loadAvg ? `${sys.cpus} cores · load ${sys.loadAvg.map((l) => l.toFixed(2)).join(" / ")}` : `${sys.cpus} cores`}
                  />
                  <Tile label={tr("ui.memory-left-1fac7f")} value={formatBytes(sys.memAvailable)} detail={`${percent((100 * sys.memAvailable) / sys.memTotal)} of ${formatBytes(sys.memTotal)} free`} />
                  <Tile
                    label={tr("ui.live-sessions-5c4b8c")}
                    value={String(sessions.length)}
                    detail={`${running} running${sys.processInfo ? ` · ${formatBytes(sessionMemory)} in ${processes} processes` : ""}`}
                  />
                  <Tile label={tr("ui.server-cb0cb1")} value={formatBytes(report.server.rssBytes)} detail={`heap ${formatBytes(report.server.heapUsedBytes)} · CPU ${percent(report.server.cpuPercent)}`} />
                </div>

                <div className="grid gap-3 rounded-lg border p-3">
                  <Meter label={tr("ui.system-memory-a294e2")} used={sys.memTotal - sys.memAvailable} total={sys.memTotal} />
                  {sys.disk && <Meter label={tr("ui.disk-data-dir-ebf513")} used={sys.disk.total - sys.disk.free} total={sys.disk.total} />}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      {tr("ui.pi-session-files-977d0f")} <span className="text-foreground">{formatBytes(report.storage.piSessions.bytes)}</span> in {report.storage.piSessions.files}
                    </span>
                    <span>
                      {tr("ui.pi-durable-storage-74dbb4")} <span className="text-foreground">{formatBytes(report.storage.durable.bytes)}</span>
                    </span>
                    <span>
                      {tr("ui.event-loop-lag-p99-d594b7")} <span className={cn("text-foreground", report.server.eventLoopLagMs > 100 && "font-medium")}>{report.server.eventLoopLagMs.toFixed(0)} {tr("ui.ms-26cc32")}</span>
                    </span>
                    <span>{tr("ui.server-up-a1a3fd")} {duration(report.server.uptimeSec)} {tr("ui.node-503ddc")} {report.server.node}</span>
                  </div>
                </div>

                {sessions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">{tr("ui.no-live-sessions-idle-sessions-with-ed80f9")}</p>
                ) : (
                  <>
                    {/* Wide screens: one aligned table. */}
                    <table className="hidden w-full text-sm sm:table">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-1.5 font-normal">{tr("ui.session-f7f199")}</th>
                          <th className="py-1.5 text-right font-normal">{tr("ui.memory-89c8a2")}</th>
                          <th className="py-1.5 text-right font-normal">CPU</th>
                          <th className="py-1.5 text-right font-normal">{tr("ui.storage-9e092d")}</th>
                          <th className="py-1.5 text-right font-normal">{tr("ui.tokens-cost-ba19a4")}</th>
                          <th className="py-1.5 text-right font-normal">{tr("ui.active-a733b8")}</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {sessions.map((s) => (
                          <tr key={s.key} className="border-b last:border-0">
                            <td className="max-w-56 py-2 pr-2">
                              <SessionName s={s} onOpen={openSession} />
                              <div className="flex items-center gap-1 pl-3.5 text-[11px] text-muted-foreground">
                                <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
                                  {s.harness}
                                </Badge>
                                <span className="truncate">/{s.path}</span>
                                <span>· {s.messages} {tr("ui.msgs-b3d150")}</span>
                              </div>
                            </td>
                            <td className="py-2 text-right" title={s.processes ? `${s.processes} processes (pid ${s.pid})` : undefined}>
                              {memoryOf(s)}
                            </td>
                            <td className="py-2 text-right">{s.cpuPercent === undefined ? dash : percent(s.cpuPercent)}</td>
                            <td className="py-2 text-right" title={s.sharedStorage ? "Shared by all pi durable sessions of this folder" : undefined}>
                              {s.storageBytes === undefined ? dash : formatBytes(s.storageBytes)}
                              {s.sharedStorage && <span className="text-muted-foreground">*</span>}
                            </td>
                            <td className="py-2 text-right">{tokensOf(s)}</td>
                            <td className="py-2 text-right text-xs text-muted-foreground">
                              {timeAgo(s.lastActivity, language)}
                              {s.viewers > 0 && <div>{s.viewers} {tr("ui.viewing-47a652")}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Phones: one card per session. */}
                    <ul className="grid gap-2 sm:hidden">
                      {sessions.map((s) => (
                        <li key={s.key} className="grid gap-1.5 rounded-lg border p-3 text-sm">
                          <SessionName s={s} onOpen={openSession} />
                          <div className="text-[11px] text-muted-foreground">
                            {s.harness} · /{s.path} · {s.messages} {tr("ui.msgs-8cbb4c")} {timeAgo(s.lastActivity, language)}
                            {s.viewers > 0 && ` · ${s.viewers} viewing`}
                          </div>
                          <dl className="grid grid-cols-4 gap-1 text-xs">
                            {(
                              [
                                ["Memory", memoryOf(s)],
                                ["CPU", s.cpuPercent === undefined ? dash : percent(s.cpuPercent)],
                                ["Storage", s.storageBytes === undefined ? dash : formatBytes(s.storageBytes)],
                                ["Tokens", tokensOf(s)],
                              ] as const
                            ).map(([label, value]) => (
                              <div key={label} className="grid">
                                <dt className="text-[10px] text-muted-foreground">{label}</dt>
                                <dd className="truncate">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </li>
                      ))}
                    </ul>
                    {sessions.some((s) => s.sharedStorage) && <p className="text-[11px] text-muted-foreground">{tr("ui.pi-durable-keeps-one-database-per-f-6e4692")}</p>}
                  </>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
