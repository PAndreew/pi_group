import { Copy, Pencil, Reply, Share, SmilePlus, X } from "lucide-react"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "🔥", "👀", "✅"]

/** Clipboard API where allowed (HTTPS, localhost), else the old selection trick for plain-HTTP LAN use. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true })
    area.style.cssText = "position:fixed;opacity:0"
    document.body.append(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    if (!ok) throw new Error("Copy is not available here")
  }
}

const round = "grid size-8 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4"

/**
 * Round actions under a message card: reply, copy, edit and, on people's messages in chats, react;
 * agent messages get a share button instead, sending them on to other sessions.
 * An action without a handler is left out; `editBlocked` shows edit disabled with the reason as its tooltip.
 */
export function MessageActions({
  align = "start",
  copy,
  onReply,
  onEdit,
  editBlocked,
  onReact,
  onShare,
  className,
}: {
  align?: "start" | "end"
  /** Text the copy button puts on the clipboard. */
  copy: string
  onReply?: () => void
  onEdit?: () => void
  editBlocked?: string
  onReact?: (emoji: string) => void
  onShare?: () => void
  className?: string
}) {
  return (
    <div className={cn("flex gap-1.5 pt-1", align === "end" ? "justify-end" : "justify-start", className)}>
      {onReply && (
        <button type="button" className={cn(round, "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:text-sky-300")} onClick={onReply} aria-label="Reply to message" title="Reply">
          <Reply />
        </button>
      )}
      <button
        type="button"
        className={cn(round, "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300")}
        onClick={() => copyText(copy).then(() => toast.success("Copied"), (error) => toast.error((error as Error).message))}
        aria-label="Copy message"
        title="Copy"
      >
        <Copy />
      </button>
      {(onEdit || editBlocked) && (
        <button type="button" className={cn(round, "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300")} onClick={onEdit} disabled={Boolean(editBlocked)} aria-label="Edit message" title={editBlocked ?? "Edit"}>
          <Pencil />
        </button>
      )}
      {onShare && (
        <button type="button" className={cn(round, "bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-300")} onClick={onShare} aria-label="Send to other sessions" title="Send to other sessions">
          <Share />
        </button>
      )}
      {onReact && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(round, "bg-pink-500/15 text-pink-700 hover:bg-pink-500/25 dark:text-pink-300")} aria-label="React with an emoji" title="React">
              <SmilePlus />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} className="grid min-w-0 grid-cols-5 gap-0.5">
            {REACTIONS.map((emoji) => (
              <DropdownMenuItem key={emoji} className="justify-center px-1.5 text-xl" onSelect={() => onReact(emoji)} aria-label={`React with ${emoji}`}>
                {emoji}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/** Reaction chips under a message; tapping one adds or removes your own. */
export function Reactions({ reactions, selfId, names, align = "start", onReact }: { reactions?: Record<string, string[]>; selfId?: string; names: (id: string) => string; align?: "start" | "end"; onReact: (emoji: string) => void }) {
  const entries = Object.entries(reactions ?? {}).filter(([, users]) => users.length)
  if (!entries.length) return null
  return (
    <div className={cn("flex flex-wrap gap-1 pt-1", align === "end" && "justify-end")}>
      {entries.map(([emoji, users]) => {
        const mine = Boolean(selfId && users.includes(selfId))
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-pressed={mine}
            title={users.map(names).join(", ")}
            className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2 text-sm", mine ? "border-primary/50 bg-primary/10" : "bg-background hover:bg-muted")}
          >
            <span>{emoji}</span>
            <span className="text-xs text-muted-foreground">{users.length}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Shown above the composer while it holds a message being edited. */
export function EditPreview({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border-l-2 border-amber-500 bg-muted p-2 text-xs" role="region" aria-label="Edit preview">
      <Pencil className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Editing message</span>
        <span className="block truncate text-muted-foreground">{text}</span>
      </span>
      <button type="button" className="grid size-9 shrink-0 place-items-center" aria-label="Cancel editing" onClick={onCancel}>
        <X className="size-4" />
      </button>
    </div>
  )
}
