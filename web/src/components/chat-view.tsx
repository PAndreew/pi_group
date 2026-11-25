import { ArrowLeft, ExternalLink, Folder, FolderInput, Loader2, MoreVertical, TriangleAlert, WandSparkles } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { BusyBee } from "@/components/busy-bee"
import { BrowserPanel } from "@/components/browser-panel"
import { ComposerControls, type ComposerConfig } from "@/components/composer-controls"
import { UploadedPreviews } from "@/components/attachment-preview"
import { ComposerTools } from "@/components/composer-tools"
import { InteractionCards, useInteractions } from "@/components/interaction-cards"
import { Markdown } from "@/components/markdown"
import { ForwardDialog } from "@/components/forward-dialog"
import { EditPreview, MessageActions, Reactions } from "@/components/message-actions"
import { MessageBody } from "@/components/message-body"
import { MessageHeader } from "@/components/message-header"
import { MoveDialog, type MoveTarget } from "@/components/project-move"
import { JumpToBottom, useJumpToBottom } from "@/components/jump-to-bottom"
import { focusComposer, ReplyPreview, ReplyStack, replySource, selectReply } from "@/components/message-reply"
import { parseReply, replaceReplyBody, replyPrompt, type ReplyTarget } from "@/lib/reply"
import { MentionComposer, parseMessage, PiAvatar, type ParsedMessage } from "@/components/mention-composer"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { api, type Chat, type ChatMessage } from "@/lib/api"
import { ConversationHeader } from "@/lib/nav-slot"
import { uploadDir } from "@/lib/attachments"
import { useLocale } from "@/lib/i18n"
import { useNav } from "@/lib/nav"
import { buildRuns, messageText } from "@/lib/steps"
import { useSessionStream } from "@/hooks/use-session-stream"
import { StepsDialog } from "@/components/step-dialog"
import { STEP_ICON } from "@/components/step-strip"
import { List } from "lucide-react"
import { subscribeUserEvents } from "@/lib/user-stream"
import { useProjects } from "@/lib/projects"
import { cn } from "@/lib/utils"


function PiMessage({ m, folder, onWatch, children, actions }: { m: ChatMessage; folder?: string; onWatch?: () => void; children?: React.ReactNode; actions?: React.ReactNode }) {
  const { t: tr } = useLocale()
  const text = messageText(m.message.content)
  const { state } = useSessionStream(m.sessionKey)
  const [details, setDetails] = useState<{ failed: boolean; index: number | null } | null>(null)
  const runs = state ? buildRuns(state.messages, state) : []
  const run = runs.find((run) => run.steps.some((step) => step.message && step.message.timestamp === m.message.timestamp))
    ?? (m.status === "working" ? runs.at(-1) : undefined)
  const steps = run?.steps ?? []
  const failed = steps.filter((step) => step.status === "error")
  const shownSteps = details?.failed ? failed : steps
  const current = steps.findLast((step) => step.status === "running") ?? steps.at(-1)
  const Icon = current ? STEP_ICON[current.kind] : Loader2
  const working = m.status === "working"
  // The session cache can still contain the previous turn when this pending reply appears.
  const answerAt = run?.steps.at(-1)?.message?.timestamp
  const isCurrentAnswer = answerAt === undefined ? run?.answerStreaming : answerAt >= (m.message.timestamp ?? 0)
  const partial = working && isCurrentAnswer ? run?.answer : undefined
  const buzzing = working && !partial?.trim()
  return (
    <div className="flex items-start gap-2">
      <PiAvatar />
      <div className="min-w-0 max-w-[85%]">
        <MessageHeader name="Beezy" at={m.status === "working" ? undefined : m.createdAt} edited={Boolean(m.editedAt)}>
          <button type="button" onClick={() => setDetails({ failed: false, index: null })} className="rounded p-1 text-gray-500 hover:bg-accent dark:text-gray-300" aria-label={tr("message.openSteps")} title={tr("message.openSteps")}><List className="size-4" /></button>
          <button type="button" onClick={() => setDetails({ failed: false, index: null })} className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-300" title={tr("message.allSteps")}>
            {m.status === "working" ? <><Icon className="size-3.5" />{tr("message.stepCount", { count: steps.length })}</> : tr("message.stepTotal", { count: steps.length })}
          </button>
          <button type="button" onClick={() => setDetails({ failed: true, index: null })} className={failed.length ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-300"} title={tr("message.openFailedSteps")}>{tr(working ? "message.failingCount" : "message.failedCount", { count: failed.length })}</button>
          {m.status === "working" && <span className="running-shimmer">{tr("message.running")}</span>}
          {onWatch && (
            <button type="button" className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={onWatch}>
              {tr(working ? "message.watch" : "message.session")} <ExternalLink className="size-3" />
            </button>
          )}
        </MessageHeader>
        {buzzing && <div className="agent-message w-fit rounded-3xl px-4 py-2.5"><BusyBee /></div>}
        <div className={cn("grid min-w-0 grid-cols-1 gap-1", !buzzing && "agent-message agent-bubble rounded-3xl px-4 py-2.5")}>
          {buzzing ? null : m.status === "error" ? (
            <span className="flex items-start gap-1.5 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {text || tr("message.runFailed")}
            </span>
          ) : m.status === "aborted" ? (
            <span className="text-sm text-muted-foreground">{tr("message.stopped")}</span>
          ) : (
            <Markdown text={partial ?? text} className="text-sm" base={folder} />
          )}
          {children}
        </div>
      {actions}
      <StepsDialog steps={shownSteps} open={details !== null} index={details?.index ?? null} onIndex={(index) => setDetails((value) => value && { ...value, index })} onClose={() => setDetails(null)} />
      </div>
    </div>
  )
}

function HumanMessage({ m, own, folder }: { m: ChatMessage; own: boolean; folder?: string }) {
  const { t: tr } = useLocale()
  const author = m.message.author as { id: string; username: string } | undefined
  const text = messageText(m.message.content)
  return (
    <div className="flex items-start gap-2">
      {author ? <AuthorAvatar id={author.id} name={author.username} /> : <span className="size-8 shrink-0" />}
      <ReplyStack text={text} className="max-w-[85%]" header={<MessageHeader name={author?.username ?? tr("message.unknownAuthor")} at={m.createdAt} edited={Boolean(m.editedAt)} />}>
        {(body) => (
          <div className="min-w-0">
            <div className={cn("human-bubble rounded-3xl px-4 py-2.5 text-sm", own ? "own-bubble bg-blue-50 text-black" : "bg-muted")}>
              <MessageBody text={body} folder={folder} />
            </div>
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
  const { t: tr } = useLocale()
  const { user } = useAuth()
  const { uploadFolder } = useProjects()
  const nav = useNav()
  const [chat, setChat] = useState<Chat>()
  const [browserShown, setBrowserShown] = useState(false)
  const interactions = useInteractions(chat?.sessionKey)
  const [messages, setMessages] = useState<ChatMessage[]>()
  const stick = useRef(true)
  const [text, setText] = useState("")
  const [reply, setReply] = useState<ReplyTarget>()
  /** The message whose text the composer holds for editing; `text` is its full text, reply quote included. */
  const [editing, setEditing] = useState<{ id: number; text: string; assistant: boolean }>()
  /** A Beezy reply being sent on to other sessions. */
  const [forwarding, setForwarding] = useState<string>()
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
      if (event.type === "stream_open") {
        if (latest.current) void refreshHeader()
        return sync()
      }
      if (event.chatId !== chatId) return
      if (event.type === "chat_title") return void refreshHeader()
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

  const send = async ({ raw, pi }: ParsedMessage) => {
    setSending(true)
    try {
      const { message } = await api.sendChat(chatId, replyPrompt(raw, reply, true), pi || reply?.assistant ? composerConfig : undefined)
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
  const [moving, setMoving] = useState<MoveTarget>()

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ConversationHeader className="gap-2 px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" onClick={nav.home} aria-label={tr("ui.back-to-chats-8de6f6")}>
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
        {chat && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tr("ui.chat-actions-c08e62")}><MoreVertical /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {chat.sessionKey && <DropdownMenuItem onSelect={() => {
                void api.generateTitle(chat.sessionKey!).then(({ name }) => {
                  setChat(current => current ? { ...current, title: name } : current)
                  toast.success("Title generated")
                }).catch(error => toast.error(error.message))
              }}><WandSparkles /> {tr("ui.generate-title-547a38")}</DropdownMenuItem>}
              {watch && <DropdownMenuItem onSelect={watch}><ExternalLink /> {tr("ui.open-agent-session-3bdbc2")}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setMoving({ kind: "chat", id: chat.id, title: chat.title, projectId: chat.projectId })}><FolderInput /> {tr("ui.move-to-project-34a4d0")}</DropdownMenuItem>
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
            const onReply = () => selectReply(setReply, { author: assistant ? "Beezy" : author, text: content, sourceId, assistant })
            if (assistant) {
              const nextReply = messages.slice(i + 1).find((next) => next.message.role === "assistant")
              const cards = interactions.cards.filter((card) => card.createdAt >= m.createdAt && (!nextReply || card.createdAt < nextReply.createdAt))
              const actions = content && m.status !== "working" ? (
                <MessageActions copy={content} onReply={onReply} onShare={() => setForwarding(content)} onEdit={() => startEdit(m, content)} editBlocked={piWorking ? "Wait until Beezy has finished" : m.status !== "done" ? "Only finished replies can be edited" : undefined} />
              ) : null
              return <div key={m.id} id={sourceId} {...replySource(content)}><PiMessage m={m} folder={chat?.folder} onWatch={watch} actions={actions}><InteractionCards cards={cards} canWrite={Boolean(chat?.members.some((member) => member.id === user?.id))} onResolved={interactions.onResolved} /></PiMessage></div>
            }
            const authorId = (m.message.author as { id?: string } | undefined)?.id
            const own = authorId === user?.id
            return (
              <div key={m.id} id={sourceId} {...replySource(content)}>
                <HumanMessage m={m} own={own} folder={chat?.folder} />
                <div className="pl-10">
                  <Reactions reactions={m.reactions} selfId={user?.id} names={nameOf} onReact={(emoji) => void react(m, emoji)} />
                  {content && (
                    <MessageActions
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
          onStop={piWorking && chat?.sessionKey ? () => { void api.abort(chat.sessionKey!).catch((error) => toast.error(error.message)) } : undefined}
          selfId={user?.id}
          hash="paths"
          placeholder={tr(editing ? "composer.edit" : "composer.chat")}
          editing={Boolean(editing)}
          controls={<ComposerControls browser={chat?.sessionKey ? { live: false, shown: browserShown, toggle: () => setBrowserShown((shown) => !shown) } : undefined} draft={composerConfig} onDraftChange={setComposerConfig} sessionKey={chat?.sessionKey} onCamera={(files) => void attach(files)} onAttach={() => fileInput.current?.click()} disabled={sending || uploading} agentEnabled={parseMessage(text, []).pi || reply?.assistant === true} />}
          onFiles={(files) => void attach(files)}
          onSubmit={(message) => (editing ? saveEdit(message.raw) : send(message))}
        />
        {chat && (
          <ComposerTools
            sessionKey={chat.sessionKey}
            folder={chat.folder}
            onInsert={(command) => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@pi ${command}`)}
          />
        )}
      </div>
      {browserShown && chat?.sessionKey && <div className="h-[50vh] shrink-0 border-t"><BrowserPanel sessionKey={chat.sessionKey} picks={0} onPick={(ref) => setText((text) => `${text}${text ? "\n" : ""}${JSON.stringify(ref)}`)} onClose={() => setBrowserShown(false)} /></div>}
      <ForwardDialog text={forwarding} from={{ kind: "chat", id: chatId }} onOpenChange={(o) => !o && setForwarding(undefined)} />
    </div>
  )
}
