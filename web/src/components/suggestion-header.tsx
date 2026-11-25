import { X } from "lucide-react"

export function SuggestionHeader({ title, dismissLabel, onDismiss }: { title?: string; dismissLabel: string; onDismiss: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-1 pt-1">
      <span className="pl-2 text-xs text-muted-foreground">{title}</span>
      <button type="button" aria-label={dismissLabel} className="rounded p-1.5 hover:bg-accent" onPointerDown={(e) => e.preventDefault()} onClick={onDismiss}>
        <X className="size-4" />
      </button>
    </div>
  )
}
