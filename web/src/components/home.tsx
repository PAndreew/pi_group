import { ArrowUp, Bot, Folder, Loader2, MessageSquare } from "lucide-react"
import { useEffect, useState } from "react"
import { AuthorAvatar } from "@/components/author-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/use-auth"
import { api, type SessionSummary } from "@/lib/api"
import { cn, timeAgo } from "@/lib/utils"

function RecentCard({ session, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:bg-accent"
    >
      <div className="flex items-start gap-1.5">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", session.running ? "animate-pulse bg-green-500" : session.live ? "bg-sky-500" : "bg-muted-foreground/30")} />
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium break-words">{session.name || session.firstMessage || "Untitled session"}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <Folder className="size-3 shrink-0" />
        <span className="truncate">/{session.path}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="px-1 py-0 text-[10px]">
          {session.harness}
        </Badge>
        <span>{session.running ? "running" : timeAgo(session.updatedAt)}</span>
        {session.messageCount > 0 && (
          <span className="flex items-center gap-0.5">
            <MessageSquare className="size-3" />
            {session.messageCount}
          </span>
        )}
        {session.owner && session.access !== "owner" && <span className="truncate">· {session.owner}</span>}
      </div>
    </button>
  )
}

/** Landing page: jump back into recent sessions, or start a new one in the current folder. */
export function Home({
  folder,
  version,
  onOpen,
  onStart,
  onDefaults,
}: {
  folder: string
  version: number
  onOpen: (session: SessionSummary) => void
  /** Creates a session in the folder and sends the prompt; resolves false when it did not (yet). */
  onStart: (prompt: string) => Promise<boolean>
  onDefaults: () => void
}) {
  const { user } = useAuth()
  const [recent, setRecent] = useState<SessionSummary[]>()
  const [text, setText] = useState("")
  const [starting, setStarting] = useState(false)
  const defaults = user?.sessionDefaults

  useEffect(() => {
    const load = () => api.recentSessions(3).then(({ sessions }) => setRecent(sessions), () => setRecent([]))
    void load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [version])

  const start = async () => {
    const prompt = text.trim()
    if (!prompt || starting) return
    setStarting(true)
    try {
      if (await onStart(prompt)) setText("")
    } finally {
      setStarting(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const coarse = window.matchMedia("(pointer: coarse)").matches
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void start()
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-6 px-3 py-6 sm:px-4">
        <div className="flex items-center gap-3">
          {user && <AuthorAvatar id={user.id} name={user.username} />}
          <div>
            <h1 className="text-lg font-semibold">Hi {user?.username}</h1>
            <p className="text-sm text-muted-foreground">Pick up where you left off, or ask something new.</p>
          </div>
        </div>

        <section aria-label="Recent sessions" className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent</h2>
          {!recent && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {recent?.length === 0 && <p className="text-sm text-muted-foreground">No sessions yet. Your latest three will show up here.</p>}
          {recent && recent.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {recent.map((s) => (
                <RecentCard key={s.key} session={s} onOpen={() => onOpen(s)} />
              ))}
            </div>
          )}
        </section>

        <div className="space-y-2 rounded-xl border bg-background p-2 shadow-sm">
          <div className="flex items-end gap-1.5">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Start a new session…"
              className="max-h-48 min-h-16 resize-none border-0 py-2 shadow-none focus-visible:ring-0"
              rows={2}
              autoFocus={!window.matchMedia("(pointer: coarse)").matches}
            />
            <Button size="icon" onClick={() => void start()} disabled={starting || !text.trim()} aria-label="Start session">
              {starting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">/{folder}</span>
            <span className="px-1">·</span>
            <button type="button" className="flex min-w-0 items-center gap-1 hover:text-foreground" onClick={onDefaults} title="Session defaults">
              <Bot className="size-3.5 shrink-0" />
              <span className="truncate">{defaults ? `${defaults.harness} · ${defaults.model.id} · ${defaults.thinkingLevel}` : "Choose harness & model"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
