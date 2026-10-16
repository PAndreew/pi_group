import { AlertTriangle, Brain, Ellipsis, FilePen, FilePlus, FileText, Layers, MessageSquareText, Search, Terminal, Wrench } from "lucide-react"
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

const SQUARE = "relative flex size-11 shrink-0 items-center justify-center rounded-lg border bg-card text-card-foreground transition-colors hover:bg-accent active:scale-95 sm:size-10"

/** A step as a small square: kind icon, number in the corner. */
export function StepSquare({ step, selected, onClick }: { step: Step; selected?: boolean; onClick: () => void }) {
  const Icon = STEP_ICON[step.kind]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={`${step.index}. ${STEP_LABEL[step.kind]}: ${step.title}`}
      className={cn(
        SQUARE,
        step.status === "running" && "animate-pulse border-primary/60 ring-2 ring-primary/20",
        step.status === "error" && "border-step-error/60 bg-step-error/5",
        selected && "border-primary ring-2 ring-primary/40"
      )}
    >
      <Icon className={cn("size-5", step.status === "error" ? "text-step-error" : STEP_COLOR[step.kind])} />
      <span className="absolute right-0.5 bottom-0 font-mono text-[9px] leading-tight text-muted-foreground tabular-nums">{step.index}</span>
    </button>
  )
}

/** The last few steps of a run; earlier ones collapse into an ellipsis that opens the full grid. */
export function StepStrip({ steps, onOpen, onAll, visible = 3 }: { steps: Step[]; onOpen: (index: number) => void; onAll: () => void; visible?: number }) {
  if (steps.length === 0) return null
  const hidden = Math.max(0, steps.length - visible)
  return (
    <div className="flex flex-wrap gap-1.5 py-1.5">
      {hidden > 0 && (
        <button type="button" onClick={onAll} title={`Show all ${steps.length} steps`} aria-label={`Show all ${steps.length} steps`} className={SQUARE}>
          <Ellipsis className="size-5 text-muted-foreground" />
          <span className="absolute right-0.5 bottom-0 font-mono text-[9px] leading-tight text-muted-foreground tabular-nums">+{hidden}</span>
        </button>
      )}
      {steps.slice(hidden).map((step, i) => (
        <StepSquare key={step.key} step={step} onClick={() => onOpen(hidden + i)} />
      ))}
    </div>
  )
}
