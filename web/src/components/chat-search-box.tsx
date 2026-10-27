import { Search, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useChatSearch } from "@/lib/chat-search"
import { cn } from "@/lib/utils"

/** The top bar's chat search. On phones it is an icon that opens the box over the bar. */
export function ChatSearchBox({ onSearch }: { onSearch?: () => void }) {
  const { query, setQuery } = useChatSearch()
  const [open, setOpen] = useState(false)
  const close = () => {
    setOpen(false)
    setQuery("")
  }
  return (
    <>
      <Button variant="ghost" size="icon-sm" className="shrink-0 md:hidden" onClick={() => setOpen(true)} aria-label="Search chats" data-active={Boolean(query)}>
        <Search />
      </Button>
      <div className={cn("relative min-w-0 md:block md:w-56 lg:w-64", open ? "absolute inset-x-2 top-1/2 z-10 -translate-y-1/2 bg-background md:static md:translate-y-0" : "hidden")}>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          autoFocus={open}
          onChange={(e) => {
            setQuery(e.target.value)
            onSearch?.()
          }}
          onKeyDown={(e) => e.key === "Escape" && close()}
          placeholder="Search chats"
          className="h-8 pr-8 pl-8"
        />
        {(open || query) && (
          <button type="button" onClick={close} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        )}
      </div>
    </>
  )
}
