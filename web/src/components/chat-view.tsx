import { ArrowLeft, ExternalLink, Folder, Loader2, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { AgentToggle, ComposerControls, type ComposerConfig } from "@/components/composer-controls"
import { ComposerTools } from "@/components/composer-tools"
import { InteractionCards, useInteractions } from "@/components/interaction-cards"
import { Markdown } from "@/components/markdown"
import { ForwardDialog } from "@/components/forward-dialog"
import { EditPreview, MessageActions, Reactions } from "@/components/message-actions"
import { focusComposer, ReplyPreview, ReplyStack, selectReply } from "@/components/message-reply"
import { parseReply, replaceReplyBody, replyPrompt, type ReplyTarget } from "@/lib/reply"
import { MentionComposer, PiAvatar } from "@/components/mention-composer"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { api, type Chat, type ChatMessage } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { messageText } from "@/lib/steps"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn } from "@/lib/utils"

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

function PiMessage({ m, folder, onWatch, children, actions }: { m: ChatMessage; folder?: string; onWatch?: () => void; children?: React.ReactNode; actions?: React.ReactNode }) {
  const text = messageText(m.message.content)
  return (
    <div className="flex items-start gap-2">
      <PiAvatar />
      <div className="min-w-0 max-w-[85%]">
      <div className="grid min-w-0 gap-1 rounded-2xl rounded-tl-sm border bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Beezy</span>
          <span>{time(m.createdAt)}{m.editedAt && " · edited"}</span>
          {onWatch && (
            <button type="button" className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={onWatch}>
              {m.status === "working" ? "watch" : "session"} <ExternalLink className="size-3" />
            </button>
          )}
        </div>
        {m.status === "working" ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Beezy is working…
          </span>
        ) : m.status === "error" ? (
          <span className="flex items-start gap-1.5 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {text || "The run failed."}
          </span>
        ) : m.status === "aborted" ? (
          <span className="text-sm text-muted-foreground">Stopped.</span>
        ) : (
          <Markdown text={text} className="text-sm" base={folder} />
        )}
        {children}
      </div>
      {actions}
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
        <ReplyStack text={text} align="end" className="max-w-[85%]">
          {(body) => (
            <div className="rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
              {body}
              <div className="mt-0.5 text-right text-[10px] opacity-70">{time(m.createdAt)}{m.editedAt && " · edited"}</div>
            </div>
          )}
        </ReplyStack>
      </div>
    )
  return (
    <div className="flex items-start gap-2">
      {author ? <AuthorAvatar id={author.id} name={author.username} /> : <span className="size-8" />}
      <ReplyStack text={text} className="max-w-[85%]">
        {(body) => (
          <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
            {showName && <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{author?.username}</div>}
            {body}
            <div className="mt-0.5 text-[10px] text-muted-foreground">{time(m.createdAt)}{m.editedAt && " · edited"}</div>
          </div>
        )}
      </ReplyStack>
    </div>
  )
}

/** Add or replace messages by id, keeping them in order. */
function mergeMessages(current: ChatMessage[] | undefined, incoming: ChatMessage[]) {
  const byId = new Map((current ?? []).map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** A chat between people, with pi when someone mentions @pi. */
export function ChatView({ chatId }: { chatId: string }) {
  const { user } = useAuth()
  const nav = useNav()
  const [chat, setChat] = useState<Chat>()
  const interactions = useInteractions(chat?.sessionKey)
  const [messages, setMessages] = useState<ChatMessage[]>()
  const stick = useRef(true)
  const [text, setText] = useState("")
  const [reply, setReply] = useState<ReplyTarget>()
  /** The message whose text the composer holds for editing; `text` is its full text, reply quote included. */
  const [editing, setEditing] = useState<{ id: number; text: string; assistant: boolean }>()
  /** A Beezy reply being sent on to other sessions. */
  const [forwarding, setForwarding] = useState<string>()
  const [agent, setAgent] = useState(false)
  const [composerConfig, setComposerConfig] = useState<ComposerConfig>({})
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const latest = useRef<ChatMessage[]>(undefined)
  latest.current = messages

  useEffect(() => {
    stick.current = true
    setChat(undefined)
    setMessages(undefined)
    setEditing(undefined)
    let alive = true
    const merge = (incoming: ChatMessage[]) => setMessages((current) => mergeMessages(current, incoming))
    const refreshHeader = () => api.chat(chatId).then((r) => alive && setChat(r.chat), () => {})
    const load = () =>
      api.chat(chatId).then(
        (r) => {
          if (!alive) return
          setChat(r.chat)
          // Merge rather than replace: events may have arrived while this was loading.
          merge(r.messages)
        },
        (error) => toast.error(error.message),
      )
    /** Fetch what was missed: everything after the newest message we have, and the state of replies still working. */
    const sync = () => {
      const current = latest.current
      if (!current) return void load()
      const after = current.reduce((max, m) => Math.max(max, m.id), 0)
      const check = current.filter((m) => m.status === "working").map((m) => m.id)
      api.chatSince(chatId, after, check).then(
        (r) => {
          if (!alive || !r.messages.length) return
          merge(r.messages)
          if (r.messages.some((m) => m.id > after)) void refreshHeader()
        },
        () => {},
      )
    }
    void load().then(sync)
    const unsubscribe = subscribeUserEvents((event) => {
      if (event.type === "stream_open") return sync()
      if (event.chatId !== chatId) return
      if (event.type === "chat_message" || event.type === "chat_update") merge([event.message])
      // The first @pi links a session, and mentions can add people: refresh the header.
      if (event.type === "chat_message" && (event.message.status === "working" || event.message.message.role === "user")) void refreshHeader()
    })
    const onVisible = () => document.visibilityState === "visible" && sync()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", sync)
    // Safety net while the chat is on screen, in case an event is lost anyway.
    const poll = setInterval(() => document.visibilityState === "visible" && sync(), 12_000)
    return () => {
      alive = false
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", sync)
      clearInterval(poll)
    }
  }, [chatId])

  // Keep the newest message in view and mark it read while the chat is on screen.
  const lastId = messages?.at(-1)?.id
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
    if (lastId && document.visibilityState === "visible") void api.readChat(chatId, lastId).catch(() => {})
  }, [chatId, lastId, messages])

  const send = async (raw: string) => {
    setSending(true)
    try {
      const { message } = await api.sendChat(chatId, replyPrompt(raw, reply, true), agent ? composerConfig : undefined)
      setMessages((current) => mergeMessages(current, [message]))
      setText("")
      setReply(undefined)
      stick.current = true
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  const startEdit = (m: ChatMessage, content: string) => {
    const assistant = m.message.role === "assistant"
    setReply(undefined)
    setEditing({ id: m.id, text: content, assistant })
    setText(assistant ? content : (parseReply(content)?.body ?? content))
    focusComposer()
  }
  const cancelEdit = () => {
    setEditing(undefined)
    setText("")
  }
  const saveEdit = async (raw: string) => {
    if (!editing) return
    setSending(true)
    try {
      const { message } = await api.editChat(chatId, editing.id, editing.assistant ? raw : replaceReplyBody(editing.text, raw))
      setMessages((current) => mergeMessages(current, [message]))
      cancelEdit()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }
  const react = (m: ChatMessage, emoji: string) =>
    api.reactChat(chatId, m.id, emoji).then(({ message }) => setMessages((current) => mergeMessages(current, [message])), (error) => toast.error(error.message))
  const piWorking = Boolean(messages?.some((m) => m.status === "working"))
  const nameOf = (id: string) => (id === user?.id ? "you" : (chat?.members.find((member) => member.id === id)?.username ?? "someone"))

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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={nav.home} aria-label="Back to chats">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{chat?.title ?? "…"}</div>
          {chat && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{chat.members.map((m) => (m.id === user?.id ? "you" : m.username)).join(", ")}{chat.pi ? ", Beezy" : ""}</span>
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

      <div ref={scroller} onScroll={(event) => {
        const el = event.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {!messages && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        <div className="mx-auto grid max-w-3xl gap-2">
          {messages?.map((m, i) => {
            const sourceId = `chat-${chatId}-${m.id}`
            const author = (m.message.author as { username?: string } | undefined)?.username ?? "Unknown author"
            const content = messageText(m.message.content)
            const assistant = m.message.role === "assistant"
            const onReply = () => selectReply(setReply, { author: assistant ? "Beezy" : author, text: content, sourceId, assistant })
            if (assistant) {
              const nextReply = messages.slice(i + 1).find((next) => next.message.role === "assistant")
              const cards = interactions.cards.filter((card) => card.createdAt >= m.createdAt && (!nextReply || card.createdAt < nextReply.createdAt))
              const actions = content && m.status !== "working" ? (
                <MessageActions copy={content} onReply={onReply} onShare={() => setForwarding(content)} onEdit={() => startEdit(m, content)} editBlocked={piWorking ? "Wait until Beezy has finished" : m.status !== "done" ? "Only finished replies can be edited" : undefined} />
              ) : null
              return <div key={m.id} id={sourceId}><PiMessage m={m} folder={chat?.folder} onWatch={watch} actions={actions}><InteractionCards cards={cards} canWrite={Boolean(chat?.members.some((member) => member.id === user?.id))} onResolved={interactions.onResolved} /></PiMessage></div>
            }
            const authorId = (m.message.author as { id?: string } | undefined)?.id
            const previous = (messages[i - 1]?.message.author as { id?: string } | undefined)?.id
            const own = authorId === user?.id
            const align = own ? "end" : "start"
            return (
              <div key={m.id} id={sourceId}>
                <HumanMessage m={m} own={own} showName={authorId !== previous} />
                <div className={cn(!own && "pl-10")}>
                  <Reactions reactions={m.reactions} selfId={user?.id} names={nameOf} align={align} onReact={(emoji) => void react(m, emoji)} />
                  {content && (
                    <MessageActions
                      align={align}
                      copy={parseReply(content)?.body ?? content}
                      onReply={onReply}
                      onEdit={() => startEdit(m, content)}
                      editBlocked={!own ? "Only the author can edit this message" : piWorking ? "Wait until Beezy has finished" : undefined}
                      onReact={(emoji) => void react(m, emoji)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div data-chat-composer className={cn("mx-auto grid w-full max-w-3xl shrink-0 gap-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3", !chat && "pointer-events-none opacity-60")}>
        {editing && <EditPreview text={editing.text} onCancel={cancelEdit} />}
        {reply && <ReplyPreview reply={reply} onCancel={() => setReply(undefined)} />}
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
          folder={chat?.folder ?? ""}
          sessionKey={chat?.sessionKey}
          value={text}
          onChange={setText}
          busy={sending || uploading}
          selfId={user?.id}
          hash="paths"
          placeholder={editing ? "Edit message…" : "Message… (# for files)"}
          agent={<AgentToggle checked={agent} onChange={setAgent} />}
          controls={<ComposerControls draft={composerConfig} onDraftChange={setComposerConfig} sessionKey={chat?.sessionKey} onCamera={(files) => void attach(files)} disabled={sending || uploading} agentEnabled={agent} />}
          onSubmit={(message) => (editing ? saveEdit(message.raw) : send(agent && !message.pi ? `@pi ${message.raw}` : message.raw))}
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
      <ForwardDialog text={forwarding} from={{ kind: "chat", id: chatId }} onOpenChange={(o) => !o && setForwarding(undefined)} />
    </div>
  )
}
