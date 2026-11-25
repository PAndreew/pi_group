import { useLocale } from "@/lib/i18n"
import { Search, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { useChatSearch } from "@/lib/chat-search"

/**
 * The chat search, opened from the project menu: an input floating centred at the top of the
 * screen. It stays while a query is typed (so results can be clicked); Escape or × closes it and
 * clears the query, and leaving it empty closes it too.
 */
export function ChatSearchOverlay({ open, onOpenChange, onSearch }: { open: boolean; onOpenChange: (open: boolean) => void; onSearch?: () => void }) {
  const { t: tr } = useLocale()
  const { query, setQuery } = useChatSearch()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus())
  }, [open])
  if (!open) return null
  const close = () => {
    setQuery("")
    onOpenChange(false)
  }
  return (
    <div className="fixed top-2 left-1/2 z-50 w-[min(36rem,calc(100vw-1rem))] -translate-x-1/2 rounded-full shadow-lg" role="search">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        aria-label={tr("ui.search-chats-9ad51d")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onSearch?.()
        }}
        onKeyDown={(e) => e.key === "Escape" && close()}
        onBlur={() => !query && onOpenChange(false)}
        placeholder={tr("ui.search-chats-9ad51d")}
        className="h-11 rounded-full border bg-background pr-10 pl-10 text-base text-foreground md:text-base dark:bg-popover"
      />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={close} aria-label={tr("ui.close-search-0906f9")} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent">
        <X className="size-4" />
      </button>
    </div>
  )
}
