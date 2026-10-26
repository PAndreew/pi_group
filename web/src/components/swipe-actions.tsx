import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** Width each uncovered button takes. */
const SLOT = 56

export interface SwipeAction {
  label: string
  icon: React.ReactNode
  /** Colours of the round button, e.g. "bg-red-600 hover:bg-red-700". */
  className: string
  onClick: () => void
}

/**
 * A row that slides left under a finger to uncover round action buttons (move, delete). `open` and
 * `onOpenChange` let a list keep only one row uncovered at a time; tapping an uncovered row
 * covers it again instead of activating it.
 */
export function SwipeActions({ children, actions, open, onOpenChange }: { children: React.ReactNode; actions: SwipeAction[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const start = useRef<{ x: number; y: number; horizontal?: boolean }>(undefined)
  const [drag, setDrag] = useState<number>()
  const reveal = SLOT * actions.length + 8
  const offset = drag ?? (open ? -reveal : 0)

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="absolute inset-y-0 right-0 flex items-center pr-2">
        {actions.map((action) => (
          <span key={action.label} className="grid place-items-center" style={{ width: SLOT }}>
            <button type="button" tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={action.label} title={action.label} onClick={action.onClick} className={cn("grid size-11 place-items-center rounded-full text-white shadow [&_svg]:size-5", action.className)}>
              {action.icon}
            </button>
          </span>
        ))}
      </div>
      <div
        className={cn("relative bg-background touch-pan-y", drag === undefined && "transition-transform duration-200")}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={(e) => {
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        }}
        onTouchMove={(e) => {
          const s = start.current
          if (!s) return
          const dx = e.touches[0].clientX - s.x
          const dy = e.touches[0].clientY - s.y
          // Decide once per gesture, so vertical scrolling never drags the row.
          if (s.horizontal === undefined && Math.abs(dx) + Math.abs(dy) > 8) s.horizontal = Math.abs(dx) > Math.abs(dy)
          if (s.horizontal) setDrag(Math.max(-reveal - 16, Math.min(0, dx + (open ? -reveal : 0))))
        }}
        onTouchEnd={() => {
          if (drag !== undefined) onOpenChange(drag < -reveal / 2)
          start.current = undefined
          setDrag(undefined)
        }}
        onClickCapture={(e) => {
          if (!open) return
          e.preventDefault()
          e.stopPropagation()
          onOpenChange(false)
        }}
      >
        {children}
      </div>
    </div>
  )
}
