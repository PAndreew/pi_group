import { Brain, Folder, FolderInput, Loader2, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { DeleteSessionDialog } from "@/components/delete-session-dialog"
import { PiAvatar } from "@/components/mention-composer"
import { MoveDialog, MoveRequests, type MoveTarget } from "@/components/project-move"
import { SwipeActions, type SwipeAction } from "@/components/swipe-actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { useChatSearch } from "@/lib/chat-search"
import { api, type ChatListItem, type SessionSummary } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"
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

/**
 * The active project's chats and sessions, newest first; those with pi working are on top. Refreshes
 * on chat, run and project events. Swiping a row left uncovers Move (to another project) and Delete.
 */
export function ChatList({ selected, className, requests }: { selected?: string; className?: string; requests?: boolean }) {
  const { user } = useAuth()
  const nav = useNav()
  const { active } = useProjects()
  const project = active?.id
  const [moving, setMoving] = useState<MoveTarget>()
  const [deletingChat, setDeletingChat] = useState<Extract<ChatListItem, { kind: "chat" }>>()
  const [items, setItems] = useState<ChatListItem[]>()
  const { query } = useChatSearch()
  const [swiped, setSwiped] = useState<string>()
  const [deleting, setDeleting] = useState<SessionSummary>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!project) return
    const load = () => api.chats(project).then(({ chats }) => setItems(chats), () => setItems((current) => current ?? []))
    void load()
    const poll = setInterval(load, 20_000)
    const unsubscribe = subscribeUserEvents((event) => {
      if (!["chat_message", "chat_update", "run", "projects", "stream_open"].includes(event.type)) return
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
  }, [selected, project])

  const q = query.trim().toLowerCase()
  const visible = items?.filter((i) => !q || i.title.toLowerCase().includes(q) || i.folder.toLowerCase().includes(q))

  return (
    <div className={cn("flex min-h-0 min-w-0 max-w-full flex-col", className)}>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
        {!visible && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        {requests && <MoveRequests />}
        {visible?.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{q ? "No matching chats." : active && !active.general ? `Nothing in ${active.name} yet. Start a chat below, or move one here.` : "No chats yet. Mention @pi or someone below to start one."}</p>}
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
                {item.moving && <span className="shrink-0 rounded-full border border-amber-500/50 px-1.5 text-[10px] text-amber-600 dark:text-amber-400" title="Waiting for the people in it to approve">→ {item.moving}</span>}
                {item.kind === "chat" && item.unread > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">{item.unread}</span>}
              </span>
            </span>
          </button>
          )
          const actions: SwipeAction[] = []
          if (item.canMove) actions.push({ label: `Move ${item.title} to another project`, icon: <FolderInput />, className: "bg-sky-600 hover:bg-sky-700", onClick: () => setMoving({ kind: item.kind, id: item.id, title: item.title, projectId: item.projectId }) })
          if (item.kind === "session" && item.canDelete) actions.push({ label: `Delete ${item.title}`, icon: <Trash2 />, className: "bg-red-600 hover:bg-red-700", onClick: () => void api.session(item.id).then(({ session }) => setDeleting(session), (error) => toast.error(error.message)) })
          if (item.kind === "chat" && item.canDelete) actions.push({ label: `Delete ${item.title}`, icon: <Trash2 />, className: "bg-red-600 hover:bg-red-700", onClick: () => setDeletingChat(item) })
          if (!actions.length) return row
          return (
            <SwipeActions key={item.id} actions={actions} open={swiped === item.id} onOpenChange={(open) => setSwiped(open ? item.id : undefined)}>
              {row}
            </SwipeActions>
          )
        })}
      </div>
      <MoveDialog
        item={moving}
        onOpenChange={(open) => {
          if (open) return
          setMoving(undefined)
          setSwiped(undefined)
        }}
        onMoved={() => project && void api.chats(project).then(({ chats }) => setItems(chats), () => {})}
      />
      <Dialog
        open={Boolean(deletingChat)}
        onOpenChange={(open) => {
          if (open) return
          setDeletingChat(undefined)
          setSwiped(undefined)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete the chat with {deletingChat?.title}?</DialogTitle>
            <DialogDescription>It disappears for you, and you leave it. The others keep it until they delete it too.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                const chat = deletingChat!
                setDeletingChat(undefined)
                setSwiped(undefined)
                api.deleteChat(chat.id).then(() => setItems((current) => current?.filter((i) => i.id !== chat.id)), (error) => toast.error(error.message))
                if (selected === chat.id) nav.home()
              }}
            >
              <Trash2 /> Delete chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
