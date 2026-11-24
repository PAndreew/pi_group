import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** A collapsible settings section (accordion item) with a title, an optional summary and an icon. */
export function Section({ title, hint, icon, defaultOpen, className, children }: { title: string; hint?: React.ReactNode; icon?: React.ReactNode; defaultOpen?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className={cn("group min-w-0 rounded-lg border", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 select-none hover:bg-accent/50 [&::-webkit-details-marker]:hidden [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronRight className="text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t px-3 pt-3 pb-3">{children}</div>
    </details>
  )
}
