import { useLocale } from "@/lib/i18n"
import { Timer, TriangleAlert, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { api, type ProcessWatch } from "@/lib/api"
import { subscribeUserEvents } from "@/lib/user-stream"

const since = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const what = (w: ProcessWatch) =>
  w.kind === "run" ? `Runs: ${w.target}${w.targetPid ? ` (pid ${w.targetPid})` : ""}` : w.kind === "pid" ? `Process ${w.target}` : w.kind === "log" ? `${w.target} matching /${w.pattern}/${w.failPattern ? `, failing on /${w.failPattern}/` : ""}` : `File ${w.target}`

/** "Waiting on…" above the composer: what the agent armed a watch on, how long it has run, and a way to stop watching. Key it by session. */
export function WatchPills({ sessionKey, canWrite }: { sessionKey: string; canWrite: boolean }) {
  const { t: tr } = useLocale()
  const [watches, setWatches] = useState<ProcessWatch[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    const load = () => api.watches(sessionKey).then(({ watches }) => alive && setWatches(watches), () => {})
    void load()
    const unsubscribe = subscribeUserEvents((event) => ((event.type === "watches" && event.key === sessionKey) || event.type === "stream_open") && void load())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => { alive = false; unsubscribe(); clearInterval(timer) }
  }, [sessionKey])

  const armed = watches.filter((w) => w.status === "armed")
  if (!armed.length) return null
  const cancel = async (w: ProcessWatch) => {
    try {
      await api.cancelWatch(sessionKey, w.id)
      setWatches((ws) => ws.filter((x) => x.id !== w.id))
      toast.success(`Stopped watching ${w.label}`, { description: "The process itself keeps running." })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={tr("ui.waiting-on-257da8")}>
      <span className="text-xs text-muted-foreground">{tr("ui.waiting-on-257da8")}</span>
      {armed.map((w) => (
        <Badge
          key={w.id}
          variant="outline"
          className="max-w-full gap-1 pr-0.5"
          title={[what(w), `On ${w.host === "local" ? "this machine" : w.host}`, w.log && `Log: ${w.log}`, w.quietMinutes && `Also fires if the log is quiet for ${w.quietMinutes} min`, `Deadline: ${new Date(w.deadlineAt).toLocaleString()}`, w.lastError && `Cannot reach it: ${w.lastError}`].filter(Boolean).join("\n")}
        >
          {w.lastError ? <TriangleAlert className="size-3 text-amber-600" /> : <Timer className="size-3" />}
          <span className="truncate">{w.label}</span>
          <span className="text-muted-foreground">· {w.host === "local" ? "here" : w.host} · {since(w.createdAt, now)}</span>
          {canWrite && (
            <button type="button" className="rounded-sm p-0.5 hover:bg-accent" onClick={() => void cancel(w)} aria-label={`Stop watching ${w.label}`}>
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
    </div>
  )
}
