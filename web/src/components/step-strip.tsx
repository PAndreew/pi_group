import { AlertTriangle, Brain, FilePen, FilePlus, FileText, Layers, MessageSquareText, Search, Terminal, Wrench } from "lucide-react"
import { useEffect, useRef } from "react"
import type { Step, StepKind } from "@/lib/steps"
import { cn } from "@/lib/utils"

export const STEP_ICON: Record<StepKind, typeof Brain> = {
  thinking: Brain,
  text: MessageSquareText,
  bash: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePlus,
  search: Search,
  tool: Wrench,
  summary: Layers,
  error: AlertTriangle,
}

export const STEP_LABEL: Record<StepKind, string> = {
  thinking: "Reasoning",
  text: "Message",
  bash: "Shell",
  read: "Read",
  edit: "Edit",
  write: "Write",
  search: "Search",
  tool: "Tool",
  summary: "Summary",
  error: "Error",
}

const STEP_COLOR: Record<StepKind, string> = {
  thinking: "text-step-thinking",
  text: "text-step-text",
  bash: "text-step-tool",
  read: "text-step-tool",
  edit: "text-step-tool",
  write: "text-step-tool",
  search: "text-step-tool",
  tool: "text-step-tool",
  summary: "text-muted-foreground",
  error: "text-step-error",
}

/** One run's steps as small squares in a single horizontally scrolling row. */
export function StepStrip({ steps, running, onOpen }: { steps: Step[]; running: boolean; onOpen: (index: number) => void }) {
  const row = useRef<HTMLDivElement>(null)

  // Follow new steps while the run is live, unless the user scrolled back.
  useEffect(() => {
    const el = row.current
    if (!el || !running) return
    if (el.scrollWidth - el.scrollLeft - el.clientWidth < 120) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" })
  }, [steps.length, running])

  if (steps.length === 0) return null
  return (
    <div ref={row} className="scrollbar-thin -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 py-1.5">
      {steps.map((step, i) => {
        const Icon = STEP_ICON[step.kind]
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onOpen(i)}
            title={`${step.index}. ${STEP_LABEL[step.kind]}: ${step.title}`}
            className={cn(
              "relative flex size-11 shrink-0 snap-start items-center justify-center rounded-lg border bg-card transition-colors hover:bg-accent active:scale-95 sm:size-10",
              step.status === "running" && "animate-pulse border-primary/60 ring-2 ring-primary/20",
              step.status === "error" && "border-step-error/60 bg-step-error/5"
            )}
          >
            <Icon className={cn("size-5", step.status === "error" ? "text-step-error" : STEP_COLOR[step.kind])} />
            <span className="absolute right-0.5 bottom-0 font-mono text-[9px] leading-tight text-muted-foreground tabular-nums">{step.index}</span>
          </button>
        )
      })}
    </div>
  )
}
