import { useLocale } from "@/lib/i18n"
import { Brain, Trash2 } from "lucide-react"
import { useId, useState } from "react"

export function ProjectMemoryPill({ memory, onRemove }: { memory: string; onRemove?: () => void }) {
  const { t: tr } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  return (
    <div className="mb-1.5">
      <span className="inline-flex max-w-full items-center rounded-full border border-slate-400 bg-[linear-gradient(165deg,#cbd5e1_0%,#f8fafc_38%,#b6c1cf_64%,#e2e8f0_100%)] text-xs text-slate-900 shadow-xs">
        <button type="button" className="inline-flex items-center gap-1.5 rounded-l-full py-1 pl-2.5 pr-1 font-medium hover:bg-white/40" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)}>
          <Brain className="size-3.5 shrink-0" /> {tr("ui.project-memory-b75fca")}
        </button>
        <button type="button" className="rounded-r-full px-1.5 py-1 hover:enabled:bg-white/50 hover:enabled:text-red-800 disabled:opacity-50" aria-label={tr("ui.remove-project-memory-from-this-mes-a66b34")} title={onRemove ? "Remove project memory from this message" : "Only the author can remove memory while the agent is idle"} disabled={!onRemove} onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </button>
      </span>
      <pre id={detailsId} hidden={!expanded} className="mt-1 max-h-48 max-w-full overflow-auto rounded-lg border border-slate-300 bg-white/70 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 text-xs whitespace-pre-wrap wrap-anywhere">{expanded ? memory : null}</pre>
    </div>
  )
}
