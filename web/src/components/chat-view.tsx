import { ArrowLeft, ExternalLink, Folder, Loader2, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { ComposerTools } from "@/components/composer-tools"
import { Markdown } from "@/components/markdown"
import { MentionComposer, PiAvatar } from "@/components/mention-composer"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { api, type Chat, type ChatMessage } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { messageText } from "@/lib/steps"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn } from "@/lib/utils"

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

function PiMessage({ m, onWatch }: { m: ChatMessage; onWatch?: () => void }) {
  const text = messageText(m.message.content)
  return (
    <div className="flex items-start gap-2">
      <PiAvatar />
      <div className="grid min-w-0 max-w-[85%] gap-1 rounded-2xl rounded-tl-sm border bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">pi</span>
          <span>{time(m.createdAt)}</span>
          {onWatch && (
            <button type="button" className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={onWatch}>
              {m.status === "working" ? "watch" : "session"} <ExternalLink className="size-3" />
            </button>
          )}
        </div>
        {m.status === "working" ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> pi is working…
          </span>
        ) : m.status === "error" ? (
          <span className="flex items-start gap-1.5 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {text || "The run failed."}
          </span>
        ) : m.status === "aborted" ? (
          <span className="text-sm text-muted-foreground">Stopped.</span>
        ) : (
          <Markdown text={text} className="text-sm" />
        )}
      </div>
    </div>
  )
}

function HumanMessage({ m, own, showName }: { m: ChatMessage; own: boolean; showName: boolean }) {
  const author = m.message.author as { id: string; username: string } | undefined
  const text = messageText(m.message.content)
  if (own)
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
          <div className="mt-0.5 text-right text-[10px] opacity-70">{time(m.createdAt)}</div>
        </div>
      </div>
    )
  return (
    <div className="flex items-start gap-2">
      {author ? <AuthorAvatar id={author.id} name={author.username} /> : <span className="size-8" />}
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {showName && <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{author?.username}</div>}
        {text}
        <div className="mt-0.5 text-[10px] text-muted-foreground">{time(m.createdAt)}</div>
      </div>
    </div>
  )
}

/** A chat between people, with pi when someone mentions @pi. */
export function ChatView({ chatId }: { chatId: string }) {
  const { user } = useAuth()
  const nav = useNav()
  const [chat, setChat] = useState<Chat>()
  const [messages, setMessages] = useState<ChatMessage[]>()
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setChat(undefined)
    setMessages(undefined)
    const load = () =>
      api.chat(chatId).then(
        (r) => {
          setChat(r.chat)
          setMessages(r.messages)
        },
        (error) => toast.error(error.message),
      )
    void load()
    const unsubscribe = subscribeUserEvents((event) => {
      if (event.chatId !== chatId) return
      if (event.type === "chat_message") {
        setMessages((current) => (current && !current.some((m) => m.id === event.message.id) ? [...current, event.message] : current))
        // The first @pi links a session, and mentions can add people: refresh the header.
        if (event.message.status === "working" || event.message.message.role === "user") api.chat(chatId).then((r) => setChat(r.chat), () => {})
      } else if (event.type === "chat_update") {
        setMessages((current) => current?.map((m) => (m.id === event.message.id ? event.message : m)))
      }
    })
    return unsubscribe
  }, [chatId])

  // Keep the newest message in view and mark it read while the chat is on screen.
  const lastId = messages?.at(-1)?.id
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
    if (lastId && document.visibilityState === "visible") void api.readChat(chatId, lastId).catch(() => {})
  }, [chatId, lastId, messages])

  const send = async (raw: string) => {
    setSending(true)
    try {
      const { message } = await api.sendChat(chatId, raw)
      setMessages((current) => (current && !current.some((m) => m.id === message.id) ? [...current, message] : current))
      setText("")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  /** Files go to the chat's folder; the message gets their paths so pi (and people) can find them. */
  const attach = async (files: File[]) => {
    if (!files.length || !chat) return
    setUploading(true)
    try {
      const { files: done } = await api.upload(chat.folder, files)
      setText((t) => `${t}${t ? " " : ""}${done.map((f) => `\`${f.path}\``).join(" ")} `)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const watch = chat?.sessionKey ? () => nav.openSession(chat.sessionKey!, chat.folder) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={nav.home} aria-label="Back to chats">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{chat?.title ?? "…"}</div>
          {chat && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{chat.members.map((m) => (m.id === user?.id ? "you" : m.username)).join(", ")}{chat.pi ? ", pi" : ""}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                · <Folder className="size-3" />/{chat.folder}
              </span>
            </div>
          )}
        </div>
        {watch && (
          <Button variant="outline" size="sm" onClick={watch} title="Open pi's session for this chat">
            <PiAvatar small /> Session
          </Button>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!messages && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        <div className="mx-auto grid max-w-3xl gap-2">
          {messages?.map((m, i) => {
            if (m.message.role === "assistant") return <PiMessage key={m.id} m={m} onWatch={watch} />
            const author = (m.message.author as { id?: string } | undefined)?.id
            const previous = (messages[i - 1]?.message.author as { id?: string } | undefined)?.id
            return <HumanMessage key={m.id} m={m} own={author === user?.id} showName={author !== previous} />
          })}
        </div>
      </div>

      <div className={cn("mx-auto grid w-full max-w-3xl gap-1 border-t p-2 sm:p-3", !chat && "pointer-events-none opacity-60")}>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void attach(Array.from(e.target.files ?? []))
            e.target.value = ""
          }}
        />
        <MentionComposer
          value={text}
          onChange={setText}
          busy={sending || uploading}
          selfId={user?.id}
          folders={false}
          placeholder={chat?.pi ? "Message… (@pi to ask pi)" : "Message… (@pi to bring in pi)"}
          onSubmit={(message) => send(message.raw)}
        />
        {chat && (
          <ComposerTools
            sessionKey={chat.sessionKey}
            folder={chat.folder}
            onAttach={() => fileInput.current?.click()}
            onModel={watch}
            onInsert={(command) => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@pi ${command}`)}
          />
        )}
      </div>
    </div>
  )
}
