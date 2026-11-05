import { Brain } from "lucide-react"
import { useEffect, useState } from "react"
import type { SessionSummary } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"

/** "Memory 2/5" while project memory is being extracted from this session; opens the worker to watch it stream. */
export function MemoryRunChip({ sessionKey, initial }: { sessionKey: string; initial?: SessionSummary["memoryRun"] }) {
  const nav = useNav()
  const [run, setRun] = useState(initial)
  useEffect(() => setRun(initial), [initial])
  useEffect(() => subscribeUserEvents((event) => {
    if (event.type !== "memory_extraction" || event.session !== sessionKey) return
    setRun(event.status === "extracting" ? { worker: event.worker, part: event.part, parts: event.parts } : undefined)
  }), [sessionKey])
  if (!run) return null
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 px-1.5 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
      title="Extracting project memory from this session — open the worker to watch"
      onClick={() => run.worker && nav.openSession(run.worker)}
    >
      <Brain className="size-3 animate-pulse" /> memory {run.part}/{run.parts}
    </button>
  )
}
