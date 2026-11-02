import { Search, X } from "lucide-react"
import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useChatSearch } from "@/lib/chat-search"

/** Compact search on every screen: click the magnifier to open and focus the input. */
export function ChatSearchBox({ onSearch }: { onSearch?: () => void }) {
  const { query, setQuery } = useChatSearch()
  const [open, setOpen] = useState(false)
  const inputId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    setQuery("")
    requestAnimationFrame(() => trigger.current?.focus())
  }
  return (
    <>
      {!open && <Button ref={trigger} variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setOpen(true)} aria-label="Search chats" aria-expanded={open} aria-controls={inputId} data-active={Boolean(query)}>
        <Search />
      </Button>}
      {open && <div className="absolute inset-x-2 top-1/2 z-10 min-w-0 -translate-y-1/2 bg-background md:relative md:inset-auto md:translate-y-0 md:w-56 lg:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={inputId}
          aria-label="Search chats"
          value={query}
          autoFocus={open}
          onChange={(e) => {
            setQuery(e.target.value)
            onSearch?.()
          }}
          onKeyDown={(e) => e.key === "Escape" && close()}
          placeholder="Search chats"
          className="h-8 rounded-full border-0 bg-muted pr-8 pl-8 text-foreground dark:bg-muted"
        />
        {(open || query) && (
          <button type="button" onClick={close} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        )}
      </div>}
    </>
  )
}
