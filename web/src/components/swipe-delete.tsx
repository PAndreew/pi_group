import { Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

const REVEAL = 64

/**
 * A row that slides left under a finger to uncover a round delete button. `open` and
 * `onOpenChange` let a list keep only one row uncovered at a time; tapping an uncovered row
 * covers it again instead of activating it.
 */
export function SwipeDelete({ children, label, open, onOpenChange, onDelete }: { children: React.ReactNode; label: string; open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => void }) {
  const start = useRef<{ x: number; y: number; horizontal?: boolean }>(undefined)
  const [drag, setDrag] = useState<number>()
  const offset = drag ?? (open ? -REVEAL : 0)

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="absolute inset-y-0 right-0 flex w-16 items-center justify-center">
        <button type="button" tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={label} title={label} onClick={onDelete} className="grid size-11 place-items-center rounded-full bg-red-600 text-white shadow hover:bg-red-700">
          <Trash2 className="size-5" />
        </button>
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
          if (s.horizontal) setDrag(Math.max(-REVEAL - 16, Math.min(0, dx + (open ? -REVEAL : 0))))
        }}
        onTouchEnd={() => {
          if (drag !== undefined) onOpenChange(drag < -REVEAL / 2)
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
