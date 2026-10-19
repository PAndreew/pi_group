import { Brain, Folder, Loader2, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { DeleteSessionDialog } from "@/components/delete-session-dialog"
import { PiAvatar } from "@/components/mention-composer"
import { SwipeDelete } from "@/components/swipe-delete"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { api, type ChatListItem, type SessionSummary } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn, timeAgo } from "@/lib/utils"

function Avatars({ item, selfId }: { item: ChatListItem; selfId?: string }) {
  if (item.kind === "session") return <PiAvatar />
  const others = item.members.filter((m) => m.id !== selfId).slice(0, item.pi ? 1 : 2)
  return (
    <span className="flex shrink-0 -space-x-3">
      {others.map((m) => (
        <AuthorAvatar key={m.id} id={m.id} name={m.username} />
      ))}
      {item.pi && <PiAvatar />}
    </span>
  )
}

/** Earlier chats, newest first; chats with pi working are on top. Refreshes on chat and run events. */
export function ChatList({ selected, className }: { selected?: string; className?: string }) {
  const { user } = useAuth()
  const nav = useNav()
  const [items, setItems] = useState<ChatListItem[]>()
  const [query, setQuery] = useState("")
  const [swiped, setSwiped] = useState<string>()
  const [deleting, setDeleting] = useState<SessionSummary>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const load = () => api.chats().then(({ chats }) => setItems(chats), () => setItems((current) => current ?? []))
    void load()
    const poll = setInterval(load, 20_000)
    const unsubscribe = subscribeUserEvents((event) => {
      if (!["chat_message", "chat_update", "run", "stream_open"].includes(event.type)) return
      clearTimeout(timer.current)
      timer.current = setTimeout(load, 300)
    })
    const onVisible = () => document.visibilityState === "visible" && void load()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(poll)
      clearTimeout(timer.current)
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [selected])

  const q = query.trim().toLowerCase()
  const visible = items?.filter((i) => !q || i.title.toLowerCase().includes(q) || i.folder.toLowerCase().includes(q))

  return (
    <div className={cn("flex min-h-0 min-w-0 max-w-full flex-col", className)}>
      <div className="relative px-3 py-2">
        <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" className="h-9 pl-8" />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {!visible && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        {visible?.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{q ? "No matching chats." : "No chats yet. Mention @pi or someone below to start one."}</p>}
        {visible?.map((item) => {
          const row = (
          <button
            key={item.id}
            type="button"
            onClick={() => (item.kind === "chat" ? nav.openChat(item.id) : nav.openSession(item.id, item.folder))}
            className={cn("flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-lg px-2 py-2 text-left hover:bg-accent", selected === item.id && "bg-accent")}
          >
            <Avatars item={item} selfId={user?.id} />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {item.kind === "session" && item.memory && <Brain className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className={cn("min-w-0 flex-1 truncate text-sm", item.kind === "chat" && item.unread > 0 && "font-semibold")}>{item.title}</span>
                {item.running && <span className="size-2 shrink-0 animate-pulse rounded-full bg-green-500" title="Beezy is working" />}
                <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.updatedAt)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {item.kind === "chat" ? (item.last ? `${item.last.author === user?.username ? "You" : item.last.author === "pi" ? "Beezy" : item.last.author}: ${item.last.text || "…"}` : "") : item.running ? "Beezy is working…" : `Beezy · ${item.harness}`}
                </span>
                {(item.kind === "session" || item.pi) && item.folder && (
                  <span title={`/${item.folder}`} className="flex min-w-0 max-w-[50%] items-center gap-0.5">
                    <Folder className="size-3 shrink-0" />
                    <span className="truncate">/{item.folder}</span>
                  </span>
                )}
                {item.kind === "chat" && item.unread > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">{item.unread}</span>}
              </span>
            </span>
          </button>
          )
          if (item.kind !== "session" || !item.canDelete) return row
          return (
            <SwipeDelete
              key={item.id}
              label={`Delete ${item.title}`}
              open={swiped === item.id}
              onOpenChange={(open) => setSwiped(open ? item.id : undefined)}
              onDelete={() => api.session(item.id).then(({ session }) => setDeleting(session), (error) => toast.error(error.message))}
            >
              {row}
            </SwipeDelete>
          )
        })}
      </div>
      <DeleteSessionDialog
        session={deleting}
        onOpenChange={(open) => {
          if (open) return
          setDeleting(undefined)
          setSwiped(undefined)
        }}
        onDeleted={(key) => setItems((current) => current?.filter((i) => i.id !== key))}
      />
    </div>
  )
}
