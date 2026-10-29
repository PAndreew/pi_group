import { ArrowLeft, Bot, ExternalLink, Folder, FolderInput, Loader2, Lock, MoreVertical, Sparkles, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { AgentToggle, ComposerControls, type ComposerConfig } from "@/components/composer-controls"
import { UploadedPreviews } from "@/components/attachment-preview"
import { ComposerTools } from "@/components/composer-tools"
import { InteractionCards, useInteractions } from "@/components/interaction-cards"
import { Markdown } from "@/components/markdown"
import { ForwardDialog } from "@/components/forward-dialog"
import { EditPreview, MessageActions, Reactions } from "@/components/message-actions"
import { MessageBody } from "@/components/message-body"
import { MoveDialog, type MoveTarget } from "@/components/project-move"
import { JumpToBottom, useJumpToBottom } from "@/components/jump-to-bottom"
import { focusComposer, ReplyPreview, ReplyStack, replySource, selectReply } from "@/components/message-reply"
import { parseReply, replaceReplyBody, replyPrompt, type ReplyTarget } from "@/lib/reply"
import { MentionComposer, PiAvatar } from "@/components/mention-composer"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { api, type Chat, type ChatMessage } from "@/lib/api"
import { ConversationHeader } from "@/lib/nav-slot"
import { uploadDir } from "@/lib/attachments"
import { useNav } from "@/lib/nav"
import { messageText } from "@/lib/steps"
import { subscribeUserEvents } from "@/lib/user-stream"
import { useProjects } from "@/lib/projects"
import { cn } from "@/lib/utils"

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** Who an agent reply is from: the viewer's own agent, someone else's, or (older chats) the shared Beezy. */
export function agentName(m: ChatMessage, selfId?: string) {
  const agent = m.message.agentOf as { id?: string; username?: string } | undefined
  if (!agent?.username) return "Beezy"
  return agent.id === selfId ? "Your agent" : `${agent.username}'s agent`
}

function PiMessage({ m, name, folder, onWatch, children, actions }: { m: ChatMessage; name: string; folder?: string; onWatch?: () => void; children?: React.ReactNode; actions?: React.ReactNode }) {
  const text = messageText(m.message.content)
  return (
    <div className="flex items-start gap-2">
      <PiAvatar />
      <div className="min-w-0 max-w-[85%]">
      <div className="grid min-w-0 gap-1 rounded-2xl rounded-tl-sm border bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{name}</span>
          <span>{time(m.createdAt)}{m.editedAt && " · edited"}</span>
          {onWatch && (
            <button type="button" className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={onWatch}>
              {m.status === "working" ? "watch" : "session"} <ExternalLink className="size-3" />
            </button>
          )}
        </div>
        {m.status === "working" ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {name === "Your agent" ? "Your agent is" : `${name} is`} working…
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

function HumanMessage({ m, own, showName, folder }: { m: ChatMessage; own: boolean; showName: boolean; folder?: string }) {
  const author = m.message.author as { id: string; username: string } | undefined
  const text = messageText(m.message.content)
  if (own)
    return (
      <div className="flex justify-end">
        <ReplyStack text={text} align="end" className="max-w-[85%]">
          {(body) => (
            <div className="min-w-0 rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
              <MessageBody text={body} folder={folder} tinted />
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
          <div className="min-w-0 rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm">
            {showName && <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{author?.username}</div>}
            <MessageBody text={body} folder={folder} />
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
  const { uploadFolder } = useProjects()
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
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [naming, setNaming] = useState(false)
  const [composerConfig, setComposerConfig] = useState<ComposerConfig>({})
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const jumper = useJumpToBottom(scroller, stick)
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
      if (event.type === "chat_delete") setMessages((current) => current?.filter((m) => m.id !== event.messageId))
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
  /** Delete your own message; pi forgets it too (after its current run when it is working). */
  const remove = async (m: ChatMessage) => {
    if (!window.confirm("Delete this message for everyone in the chat?")) return
    try {
      const { queued } = await api.deleteChatMessage(chatId, m.id)
      setMessages((current) => current?.filter((other) => other.id !== m.id))
      if (editing?.id === m.id) cancelEdit()
      toast.success(queued ? "Deleted; Beezy forgets it when it finishes the current run" : "Message deleted")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const piWorking = Boolean(messages?.some((m) => m.status === "working"))
  const nameOf = (id: string) => (id === user?.id ? "you" : (chat?.members.find((member) => member.id === id)?.username ?? "someone"))

  /** Files go to the project's (else the chat folder's) uploads; the message gets their paths so pi (and people) can find them. */
  const attach = async (files: File[]) => {
    if (!files.length || !chat) return
    setUploading(true)
    try {
      const { files: done } = await api.upload(uploadDir(uploadFolder(chat.projectId) ?? chat.folder), files)
      setText((t) => `${t}${t ? " " : ""}${done.map((f) => `\`${f.path}\``).join(" ")} `)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const watch = chat?.sessionKey ? () => nav.openSession(chat.sessionKey!, chat.folder) : undefined
  /** The session behind an agent reply, for the person whose agent it is (or an older chat's shared one). */
  const watchReply = (m: ChatMessage) => {
    const agent = m.message.agentOf as { id?: string } | undefined
    if (agent) return agent.id === user?.id && m.sessionKey ? () => nav.openSession(m.sessionKey!, chat?.folder) : undefined
    return watch
  }
  const [moving, setMoving] = useState<MoveTarget>()
  const saveTitle = async (title: string | null) => {
    setRenaming(false)
    if (!chat) return
    try {
      setChat({ ...chat, ...(await api.updateChat(chat.id, { title })).chat, members: chat.members })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const generateTitle = async () => {
    if (!chat) return
    setNaming(true)
    try {
      const { title } = await api.generateChatTitle(chat.id)
      setChat({ ...chat, title, customTitle: true })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setNaming(false)
    }
  }
  const setPrivate = async (value: boolean) => {
    if (!chat) return
    try {
      setChat({ ...chat, ...(await api.updateChat(chat.id, { private: value })).chat, members: chat.members })
      if (value) setAgent(false)
      toast.success(value ? "Private: no agent sees this chat, and it is not archived" : "Agentic: your agents can see this chat, and @pi asks the asker's agent")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ConversationHeader className="gap-2 px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={nav.home} aria-label="Back to chats">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          {renaming && chat ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void saveTitle(titleDraft.trim() || null)
              }}
            >
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void saveTitle(titleDraft.trim() || null)}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                placeholder="Title (empty: the names)"
                maxLength={120}
                className="h-7 text-sm"
              />
            </form>
          ) : (
            <button
              type="button"
              className="block max-w-full truncate text-left text-sm font-medium hover:underline"
              title="Rename"
              disabled={!chat}
              onClick={() => {
                setTitleDraft(chat?.customTitle ? chat.title : "")
                setRenaming(true)
              }}
            >
              {chat?.title ?? "…"}
            </button>
          )}
          {chat && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {chat.private ? <Lock className="size-3 shrink-0" /> : <Bot className="size-3 shrink-0" />}
              <span className="truncate">{chat.members.map((m) => (m.id === user?.id ? "you" : m.username)).join(", ")}{chat.private ? " · private" : " · agentic"}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                · <Folder className="size-3" />/{chat.folder}
              </span>
            </div>
          )}
        </div>
        {chat && (
          <Button variant="ghost" size="icon-sm" onClick={() => void generateTitle()} disabled={naming} aria-label="Generate a title" title="Generate a title from the conversation">
            {naming ? <Loader2 className="animate-spin" /> : <Sparkles />}
          </Button>
        )}
        {chat && (
          <Button variant="ghost" size="icon-sm" onClick={() => void setPrivate(!chat.private)} aria-label={chat.private ? "Make agentic" : "Make private"} title={chat.private ? "Private: no agent sees it. Click to make it agentic" : "Agentic: your agents see it. Click to make it private"}>
            {chat.private ? <Lock /> : <Bot />}
          </Button>
        )}
        {chat && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Chat actions"><MoreVertical /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setTitleDraft(chat.customTitle ? chat.title : ""); setRenaming(true) }}>Rename…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void setPrivate(!chat.private)}>{chat.private ? <><Bot /> Make agentic</> : <><Lock /> Make private</>}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {watch && <DropdownMenuItem onSelect={watch}><ExternalLink /> Open agent session</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setMoving({ kind: "chat", id: chat.id, title: chat.title, projectId: chat.projectId })}><FolderInput /> Move to project…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <MoveDialog item={moving} onOpenChange={(open) => !open && setMoving(undefined)} />
      </ConversationHeader>

      <div ref={scroller} onScroll={jumper.onScroll} className="chat-scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {!messages && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        <div className="mx-auto grid max-w-3xl gap-2">
          {messages?.map((m, i) => {
            const sourceId = `chat-${chatId}-${m.id}`
            const author = (m.message.author as { username?: string } | undefined)?.username ?? "Unknown author"
            const content = messageText(m.message.content)
            const assistant = m.message.role === "assistant"
            const onReply = () => selectReply(setReply, { author: assistant ? agentName(m, user?.id) : author, text: content, sourceId, assistant })
            if (assistant) {
              const nextReply = messages.slice(i + 1).find((next) => next.message.role === "assistant")
              const cards = interactions.cards.filter((card) => card.createdAt >= m.createdAt && (!nextReply || card.createdAt < nextReply.createdAt))
              const actions = content && m.status !== "working" ? (
                <MessageActions copy={content} onReply={onReply} onShare={() => setForwarding(content)} onEdit={() => startEdit(m, content)} editBlocked={piWorking ? "Wait until Beezy has finished" : m.status !== "done" ? "Only finished replies can be edited" : undefined} />
              ) : null
              return <div key={m.id} id={sourceId} {...replySource(content)}><PiMessage m={m} name={agentName(m, user?.id)} folder={chat?.folder} onWatch={watchReply(m)} actions={actions}><InteractionCards cards={cards} canWrite={Boolean(chat?.members.some((member) => member.id === user?.id))} onResolved={interactions.onResolved} /></PiMessage></div>
            }
            const authorId = (m.message.author as { id?: string } | undefined)?.id
            const previous = (messages[i - 1]?.message.author as { id?: string } | undefined)?.id
            const own = authorId === user?.id
            const align = own ? "end" : "start"
            return (
              <div key={m.id} id={sourceId} {...replySource(content)}>
                <HumanMessage m={m} own={own} showName={authorId !== previous} folder={chat?.folder} />
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
                      onDelete={own ? () => void remove(m) : undefined}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div data-chat-composer className={cn("relative mx-auto grid w-full max-w-3xl shrink-0 gap-1 p-2 sm:p-3", !chat && "pointer-events-none opacity-60")}>
        <JumpToBottom show={jumper.away} onClick={jumper.jump} />
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
        <UploadedPreviews text={text} />
        <MentionComposer
          folder={chat?.folder ?? ""}
          sessionKey={chat?.sessionKey}
          value={text}
          onChange={setText}
          busy={sending || uploading}
          selfId={user?.id}
          hash="paths"
          placeholder={editing ? "Edit message…" : chat?.private ? "Private message (no agent): @someone and $folder" : "Message: @pi for your agent, @someone and $folder"}
          agent={<AgentToggle checked={agent && !chat?.private} onChange={setAgent} disabled={chat?.private} />}
          controls={<ComposerControls draft={composerConfig} onDraftChange={setComposerConfig} sessionKey={chat?.sessionKey} onCamera={(files) => void attach(files)} onAttach={() => fileInput.current?.click()} disabled={sending || uploading} agentEnabled={agent} />}
          onFiles={(files) => void attach(files)}
          onSubmit={(message) => (editing ? saveEdit(message.raw) : send(agent && !message.pi ? `@pi ${message.raw}` : message.raw))}
        />
        {chat && (
          <ComposerTools
            sessionKey={chat.sessionKey}
            folder={chat.folder}
            onInsert={(command) => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@pi ${command}`)}
          />
        )}
      </div>
      <ForwardDialog text={forwarding} from={{ kind: "chat", id: chatId }} onOpenChange={(o) => !o && setForwarding(undefined)} />
    </div>
  )
}
