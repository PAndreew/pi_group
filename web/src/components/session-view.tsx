import {
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Power,
  Share2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { PiAvatar } from "@/components/mention-composer"
import { AuthorAvatar } from "@/components/author-avatar"
import { ComposerBox } from "@/components/composer-box"
import { AgentToggle, ComposerControls } from "@/components/composer-controls"
import { ComposerTools } from "@/components/composer-tools"
import { PathDropup } from "@/components/path-dropup"
import { InteractionCards, useInteractions } from "@/components/interaction-cards"
import { SkillDropup } from "@/components/skill-dropup"
import { canDelete, DeleteSessionDialog } from "@/components/delete-session-dialog"
import { Markdown } from "@/components/markdown"
import { ForwardDialog } from "@/components/forward-dialog"
import { ImageGallery } from "@/components/image-gallery"
import { EditPreview, MessageActions } from "@/components/message-actions"
import { imageRefs, uploadDir } from "@/lib/attachments"
import { BrowserPanel } from "@/components/browser-panel"
import { type ElementRef, refImageFile, refLabel, refsPrompt } from "@/lib/element-refs"
import { MessageBody } from "@/components/message-body"
import { JumpToBottom, useJumpToBottom } from "@/components/jump-to-bottom"
import { focusComposer, ReplyPreview, ReplyStack, replySource, selectReply } from "@/components/message-reply"
import { parseReply, replaceReplyBody, replyPrompt, type ReplyTarget } from "@/lib/reply"
import { ShareDialog } from "@/components/share-dialog"
import { StepsDialog } from "@/components/step-dialog"
import { StepStrip } from "@/components/step-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/use-auth"
import { useSessionStream } from "@/hooks/use-session-stream"
import { type AgentMessage, api, type ExtensionDialog, type ModelInfo, type SessionSummary } from "@/lib/api"
import { buildRuns, messageText, type Run } from "@/lib/steps"
import { cn, formatBytes } from "@/lib/utils"

const MAX_INLINE_IMAGE = 5 * 1024 * 1024

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function UserBubble({ message, folder }: { message: AgentMessage; folder?: string }) {
  const text = messageText(message.content)
  // Uploads show from their files (MessageBody); inline copies only when the prompt names no stored image.
  const images = Array.isArray(message.content) && imageRefs(text, folder).length === 0 ? message.content.filter((c: any) => c?.type === "image").map((img: any) => ({ src: `data:${img.mimeType};base64,${img.data}` })) : []
  return (
    <div className="flex items-start justify-end gap-2">
      <ReplyStack text={text} align="end" className="max-w-[88%]">
        {(body) => (
          <div className="rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            <div className="mb-1 text-xs font-semibold">{message.author?.username ?? "Unknown author"}</div>
            <MessageBody text={body} folder={folder} tinted />
            <ImageGallery images={images} />
          </div>
        )}
      </ReplyStack>
      <AuthorAvatar id={message.author?.id ?? "unknown"} name={message.author?.username ?? "?"} />
    </div>
  )
}

type DialogAnswer = { value?: string; confirmed?: boolean; cancelled?: boolean }
/** A message to edit and its current text: a whole prompt, or the answer's text. */
type EditTarget = { message: AgentMessage; text: string; prompt: boolean }
/** A question the agent asked in a run and how it was answered (kept for this page view). */
type Answered = { runKey: string; dialog: ExtensionDialog; answer: DialogAnswer }

function answerLabel(dialog: ExtensionDialog, answer: DialogAnswer) {
  if (answer.cancelled) return "Cancelled"
  if (dialog.method === "confirm") return answer.confirmed ? "Yes" : "No"
  return answer.value?.trim() || "(empty)"
}

/**
 * A question from the agent (select / confirm / input / editor), shown inside its bubble so the
 * conversation scrolls past it once answered. Without write access it is shown but not answerable.
 */
function InlineQuestion({ dialog, onAnswer }: { dialog: ExtensionDialog; onAnswer?: (answer: DialogAnswer) => void }) {
  const [value, setValue] = useState(dialog.prefill ?? "")
  useEffect(() => setValue(dialog.prefill ?? ""), [dialog])
  const text = dialog.method === "input" || dialog.method === "editor"
  return (
    <div className="mt-2 grid gap-2 rounded-xl bg-background p-3 text-foreground">
      <div className="grid gap-0.5">
        <span className="text-sm font-medium">{dialog.title ?? "The agent asks"}</span>
        {dialog.message && <span className="text-xs whitespace-pre-wrap text-muted-foreground">{dialog.message}</span>}
      </div>
      {!onAnswer ? (
        <span className="text-xs text-muted-foreground">Waiting for someone with write access to answer.</span>
      ) : (
        <>
          {dialog.method === "select" && (
            <div className="grid gap-1.5">
              {dialog.options?.map((o) => (
                <Button key={o} variant="outline" size="sm" className="h-auto justify-start py-1.5 text-left whitespace-normal" onClick={() => onAnswer({ value: o })}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          {text && <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={dialog.placeholder} rows={dialog.method === "editor" ? 6 : 2} className="min-h-0" />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onAnswer(dialog.method === "confirm" ? { confirmed: false } : { cancelled: true })}>
              {dialog.method === "confirm" ? "No" : "Cancel"}
            </Button>
            {dialog.method === "confirm" && (
              <Button size="sm" onClick={() => onAnswer({ confirmed: true })}>
                Yes
              </Button>
            )}
            {text && (
              <Button size="sm" onClick={() => onAnswer({ value })}>
                Submit
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** The agent's side of a run, mirrored from the user bubble: steps first, then the answer. */
function AgentBubble({
  run,
  onOpen,
  question,
  onAnswer,
  answered = [],
  interactions,
  folder,
}: {
  run: Run
  onOpen: (index: number | null) => void
  question?: ExtensionDialog
  onAnswer?: (answer: DialogAnswer) => void
  answered?: Answered[]
  interactions?: React.ReactNode
  /** The session folder, for links to files the agent wrote. */
  folder?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <PiAvatar />
      <div className="agent-bubble max-w-[88%] min-w-0 rounded-2xl rounded-bl-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
        <div className="mb-1 text-xs font-semibold">Beezy</div>
        <StepStrip steps={run.steps} onOpen={onOpen} onAll={() => onOpen(null)} />
        {run.answer && (
          <div>
            <Markdown text={run.answer} base={folder} />
            {run.answerStreaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary-foreground/60 align-middle" />}
          </div>
        )}
        {answered.map((a) => (
          <div key={a.dialog.id} className="mt-2 rounded-lg bg-primary-foreground/10 px-2.5 py-1.5 text-xs">
            <span className="opacity-80">{a.dialog.title ?? a.dialog.message ?? "The agent asked"}</span>
            <span className="font-medium"> → {answerLabel(a.dialog, a.answer)}</span>
          </div>
        ))}
        {interactions}
        {question && <InlineQuestion dialog={question} onAnswer={onAnswer} />}
        {run.running && !run.answerStreaming && !question && (
          <div className="flex items-center gap-2 text-xs text-primary-foreground/70">
            <Loader2 className="size-3 animate-spin" /> working…
          </div>
        )}
      </div>
    </div>
  )
}

function RunView({
  run,
  onReply,
  onShare,
  onEdit,
  editBlocked,
  onDelete,
  pendingDelete,
  selfId,
  onOpen,
  question,
  onAnswer,
  answered,
  interactions,
  folder,
}: {
  run: Run
  folder?: string
  onOpen: (index: number | null) => void
  question?: ExtensionDialog
  onAnswer?: (answer: DialogAnswer) => void
  answered?: Answered[]
  onReply?: (reply: ReplyTarget) => void
  onShare?: (text: string) => void
  /** Absent without write access. */
  onEdit?: (target: EditTarget) => void
  editBlocked?: string
  /** Delete one of your own prompts; absent without write access. */
  onDelete?: (message: AgentMessage, text: string) => void
  /** Whether this run's prompt waits to be deleted when the agent finishes. */
  pendingDelete?: boolean
  selfId?: string
  interactions?: React.ReactNode
}) {
  const sourceId = `run-${run.key}`
  const userText = run.user ? messageText(run.user.content) : ""
  const answerText = run.answer
  const answerMessage = run.steps.at(-1)?.message
  const user = run.user
  return (
    <div className="space-y-2" id={sourceId}>
      {user && (
        <div {...replySource(userText)}>
          <div className={cn(pendingDelete && "opacity-50")}>
            <UserBubble message={user} folder={folder} />
          </div>
          {userText && (
            <MessageActions
              align="end"
              className="pr-10"
              copy={parseReply(userText)?.body ?? userText}
              onReply={onReply && (() => onReply({ author: user.author?.username ?? "Unknown author", text: userText, sourceId }))}
              onEdit={onEdit && (() => onEdit({ message: user, text: userText, prompt: true }))}
              editBlocked={onEdit && (user.author?.id !== selfId ? "Only the author can edit this message" : editBlocked)}
              onDelete={onDelete && user.author?.id === selfId && !pendingDelete ? () => onDelete(user, userText) : undefined}
              deletePending={pendingDelete}
            />
          )}
        </div>
      )}
      {(run.steps.length > 0 || run.running || answerText || question || answered?.length) && (
        <div {...(answerText ? replySource(answerText) : {})}>
          <AgentBubble run={run} onOpen={onOpen} question={question} onAnswer={onAnswer} answered={answered} interactions={interactions} folder={folder} />
          {answerText && !run.running && (
            <MessageActions
              className="pl-10"
              copy={answerText}
              onReply={onReply && (() => onReply({ author: "Beezy", text: answerText, sourceId, assistant: true }))}
              onShare={onShare && (() => onShare(answerText))}
              onEdit={onEdit && answerMessage && (() => onEdit({ message: answerMessage, text: answerText, prompt: false }))}
              editBlocked={onEdit && editBlocked}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function SessionView({ sessionKey, header, onDeleted }: { sessionKey: string; header?: React.ReactNode; onDeleted: (key: string) => void }) {
  const { user } = useAuth()
  const interactions = useInteractions(sessionKey)
  const { state, connected, deletedBy, browser } = useSessionStream(sessionKey)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [summary, setSummary] = useState<SessionSummary>()
  const [models, setModels] = useState<ModelInfo[]>([])
  /** Steps modal of one run; `step` is the expanded step, null shows just the grid. */
  const [open, setOpen] = useState<{ run: number; step: number | null } | null>(null)
  const [authorFilter, setAuthorFilter] = useState("all")
  const [text, setText] = useState("")
  const [reply, setReply] = useState<ReplyTarget>()
  const [editing, setEditing] = useState<EditTarget>()
  /** An agent answer being sent on to other sessions. */
  const [forwarding, setForwarding] = useState<string>()
  const [files, setFiles] = useState<File[]>([])
  /** Elements picked in the shared browser, sent with the next message. */
  const [refs, setRefs] = useState<ElementRef[]>([])
  const [browserShown, setBrowserShown] = useState(false)
  const [browserLive, setBrowserLive] = useState(false)
  const [mode, setMode] = useState<"steer" | "followUp">("steer")
  const [sending, setSending] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [answered, setAnswered] = useState<Answered[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const jumper = useJumpToBottom(scroller, stick)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    api.session(sessionKey).then(({ session }) => setSummary(session), (error) => toast.error(error.message))
  }, [sessionKey])

  useEffect(() => {
    setSummary(undefined)
    setOpen(null)
    setAuthorFilter("all")
    setEditing(undefined)
    stick.current = true
    refresh()
  }, [refresh])

  useEffect(() => {
    setRefs([])
    setBrowserShown(false)
    api.browserStatus(sessionKey).then((status) => setBrowserLive(status.open), () => setBrowserLive(false))
  }, [sessionKey])

  // Someone (often the agent) opened the shared browser while we were watching.
  useEffect(() => {
    if (!browser) return
    setBrowserLive((was) => {
      if (browser.open && !was && !browserShown) toast.info(`Browser opened: ${browser.title || browser.url}`, { action: { label: "View", onClick: () => setBrowserShown(true) } })
      return browser.open
    })
  }, [browser])

  // Someone else deleted the session while we were looking at it.
  useEffect(() => {
    if (!deletedBy || deletedBy === user?.username) return
    toast.info(`This session was deleted by ${deletedBy}`)
    onDeleted(sessionKey)
  }, [deletedBy])

  useEffect(() => {
    if (!summary?.harness) return
    api.models(summary.harness).then(({ models }) => setModels(models), () => setModels([]))
  }, [summary?.harness, state?.live])

  const runs = useMemo(
    () => (state ? buildRuns(state.messages, { partial: state.partial, toolOutputs: state.toolOutputs, runningTools: state.runningTools, running: state.running }) : []),
    [state]
  )

  const participants = useMemo(() => {
    const authors = new Map<string, string>()
    for (const run of runs) {
      if (run.user) authors.set(run.user.author?.id ?? "unknown", run.user.author?.username ?? "Unknown author")
    }
    return Array.from(authors, ([id, name]) => ({ id, name }))
  }, [runs])
  const visibleRuns = runs.map((run, index) => ({ run, index })).filter(({ run }) => authorFilter === "all" || (run.user && (run.user.author?.id ?? "unknown") === authorFilter))

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  // The agent's open question appears in the latest run's bubble.
  const question = state?.dialogs[0]
  const lastRun = runs.at(-1)
  const answer = (dialog: ExtensionDialog) => (value: DialogAnswer) =>
    act(async () => {
      await api.answerDialog(sessionKey, { id: dialog.id, ...value })
      if (lastRun) setAnswered((list) => [...list, { runKey: lastRun.key, dialog, answer: value }])
    })

  // Keep the newest output (and any new question) in view unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [runs, question?.id])

  const canWrite = summary?.access === "owner" || summary?.access === "admin" || summary?.access === "write"
  const running = Boolean(state?.running)
  const title = state?.name || summary?.name || summary?.firstMessage || "New session"

  const startEdit = (target: EditTarget) => {
    setReply(undefined)
    setEditing(target)
    setText(target.prompt ? (parseReply(target.text)?.body ?? target.text) : target.text)
    focusComposer()
  }
  const cancelEdit = () => {
    setEditing(undefined)
    setText("")
  }
  /** Delete one of your own prompts; while the agent runs the server queues it until the run ends. */
  const deletePrompt = async (message: AgentMessage, text: string) => {
    if (!state || !window.confirm("Delete this message from the session? The agent will no longer see it.")) return
    try {
      const { queued } = await api.deleteMessage(sessionKey, { index: state.messages.indexOf(message), timestamp: message.timestamp, expect: text })
      toast.success(queued ? "The message will be deleted when the agent finishes" : "Message deleted")
      if (editing?.message === message) cancelEdit()
      if (!queued) refresh()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const saveEdit = async (target: EditTarget) => {
    const body = text.trim()
    if (!body || !state) return
    setSending(true)
    try {
      await api.editMessage(sessionKey, {
        index: state.messages.indexOf(target.message),
        timestamp: target.message.timestamp,
        expect: target.text,
        text: target.prompt ? replaceReplyBody(target.text, body) : body,
      })
      cancelEdit()
      refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  const send = async () => {
    if (editing) return saveEdit(editing)
    const body = text.trim()
    if ((!body && files.length === 0 && refs.length === 0) || !summary) return
    setSending(true)
    try {
      // Picked elements go along as text, and their screenshots as attachments.
      const shots = refs.map(refImageFile)
      const attached = [...files, ...shots.filter((f): f is File => Boolean(f))]
      const picked = refs.length ? refsPrompt(refs, shots.map((f) => f?.name)) : ""
      const message = [replyPrompt(body, reply), picked].filter(Boolean).join("\n\n")
      let prompt = message
      let images: { data: string; mimeType: string }[] | undefined
      if (attached.length) {
        const dir = uploadDir(summary.path)
        const uploaded = await api.upload(dir, attached)
        const rel = uploaded.files.map((f) => (summary.path && f.path.startsWith(`${summary.path}/`) ? f.path.slice(summary.path.length + 1) : f.path))
        prompt = `${message || "See the attached files."}\n\nAttached files (relative to the working directory):\n${rel.map((p) => `- ${p}`).join("\n")}`
        const model = models.find((m) => m.provider === state?.model?.provider && m.id === state?.model?.id)
        if (!model || model.input?.includes("image")) {
          const imgs = attached.filter((f) => f.type.startsWith("image/") && f.size <= MAX_INLINE_IMAGE)
          if (imgs.length) images = await Promise.all(imgs.map(async (f) => ({ data: await readBase64(f), mimeType: f.type })))
        }
      }
      await api.prompt(sessionKey, { text: prompt, images, mode: running ? mode : undefined })
      setText("")
      setFiles([])
      setRefs([])
      setReply(undefined)
      stick.current = true
      if (!summary.live) refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  const addRef = (ref: ElementRef) => {
    if (!canWrite) return void toast.info("You have view-only access, so picks cannot be sent.")
    setRefs((list) => [...list, ref])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const coarse = window.matchMedia("(pointer: coarse)").matches
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const openRun = open ? runs[open.run] : undefined
  const queue = [...(state?.queue.steering ?? []).map((t) => ({ t, k: "steer" })), ...(state?.queue.followUp ?? []).map((t) => ({ t, k: "follow-up" }))]

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5 sm:px-3">
          {header}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={title}>
              {title}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("inline-block size-1.5 rounded-full", running ? "animate-pulse bg-green-500" : state?.live ? "bg-sky-500" : "bg-muted-foreground/40")} />
              {running ? "running" : state?.live ? "idle" : "stopped"}
              {summary && <span>· {summary.harness}</span>}
              {summary?.pinned && <Pin className="size-3" />}
              {summary?.visibility === "shared" && <Share2 className="size-3" />}
              {!connected && <span className="text-amber-600">· reconnecting…</span>}
            </div>
          </div>
          {summary && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Session menu">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!canWrite}
                  onSelect={() => {
                    setNewName(state?.name || summary.name || "")
                    setRenameOpen(true)
                  }}
                >
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem disabled={summary.access !== "owner" && summary.access !== "admin"} onSelect={() => setShareOpen(true)}>
                  <Share2 /> Access & sharing
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canWrite} onSelect={() => act(async () => setSummary((await api.pin(sessionKey, !summary.pinned)).session))}>
                  {summary.pinned ? <PinOff /> : <Pin />} {summary.pinned ? "Allow idle shutdown" : "Keep running in background"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!canWrite || !state?.live} onSelect={() => act(() => api.stop(sessionKey), "Session process stopped")}>
                  <Power /> Stop process
                </DropdownMenuItem>
                {canDelete(summary) && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete session
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {participants.length > 0 && (
          <div aria-label="Filter by prompt author" className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2">
            {[{ id: "all", name: "Everyone" }, ...participants].map(({ id, name }) => (
              <Button key={id} size="sm" variant={authorFilter === id ? "secondary" : "ghost"} aria-pressed={authorFilter === id} onClick={() => { setAuthorFilter(id); setOpen(null) }}>
                {id !== "all" && <AuthorAvatar id={id} name={name} />}{name}
              </Button>
            ))}
          </div>
        )}

        <div
          ref={scroller}
          onScroll={jumper.onScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 sm:px-4">
            {!state && <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />}
            {state && runs.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">No messages yet. Ask the agent something.</p>}
            {authorFilter !== "all" && <p className="text-xs text-muted-foreground">Showing this author’s prompts with their agent responses. <button className="underline" onClick={() => setAuthorFilter("all")}>Show everyone</button></p>}
            {state && runs.length > 0 && visibleRuns.length === 0 && <p className="text-sm text-muted-foreground">No prompts from this author.</p>}
            {visibleRuns.map(({ run, index }) => (
              <RunView
                key={run.key}
                run={run}
                folder={summary?.path}
                onReply={canWrite ? (target) => selectReply(setReply, target) : undefined}
                onShare={setForwarding}
                onEdit={canWrite ? startEdit : undefined}
                editBlocked={running ? "Wait until the agent has finished" : undefined}
                onDelete={canWrite ? (message, text) => void deletePrompt(message, text) : undefined}
                pendingDelete={Boolean(run.user && state?.pendingDeletes?.some((d) => d.text === messageText(run.user!.content) && (d.timestamp === undefined || d.timestamp === run.user!.timestamp)))}
                selfId={user?.id}
                onOpen={(step) => setOpen({ run: index, step })}
                question={run === lastRun ? question : undefined}
                onAnswer={run === lastRun && question && canWrite ? answer(question) : undefined}
                answered={answered.filter((a) => a.runKey === run.key)}
                interactions={<InteractionCards cards={interactions.cards.filter((card) => run.steps.some((step) => step.toolCall?.id === card.toolCallId))} canWrite={canWrite} onResolved={interactions.onResolved} />}
              />
            ))}
            {state?.notice?.level === "error" && !running && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">{state.notice.text}</span>
              </div>
            )}
          </div>
        </div>

        <div data-chat-composer className="relative shrink-0 border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
          <JumpToBottom show={jumper.away} onClick={jumper.jump} />
          <div className="mx-auto max-w-3xl space-y-2">
            {editing && <EditPreview text={editing.text} onCancel={cancelEdit} />}
            {reply && <ReplyPreview reply={reply} onCancel={() => setReply(undefined)} />}
            {queue.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {queue.map((q, i) => (
                  <Badge key={i} variant="secondary" className="max-w-full truncate">
                    {q.k}: {q.t}
                  </Badge>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {files.map((f, i) => (
                  <Badge key={i} variant="outline" className="gap-1">
                    {f.name} <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                    <button type="button" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {refs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {refs.map((ref) => (
                  <Badge key={ref.id} variant="outline" className="max-w-full gap-1.5 py-0.5 pl-0.5" title={ref.elements.map((el) => el.selector).join("\n")}>
                    {ref.image ? <img src={`data:image/png;base64,${ref.image}`} alt="" className="h-6 max-w-12 rounded-sm border object-cover object-left-top" /> : null}
                    <span className="truncate">{refLabel(ref)}</span>
                    <button type="button" onClick={() => setRefs((list) => list.filter((r) => r !== ref))} aria-label={`Remove ${refLabel(ref)}`}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            {canWrite ? (
              <>
                {running && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="inline-flex rounded-md border p-0.5">
                      {(["steer", "followUp"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          className={cn("rounded px-2 py-1", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                        >
                          {m === "steer" ? "Steer now" : "Follow-up"}
                        </button>
                      ))}
                    </div>
                    <span className="hidden text-muted-foreground sm:inline">
                      {mode === "steer" ? "delivered after the current tool step" : "delivered when the agent finishes"}
                    </span>
                  </div>
                )}
                <div className="flex items-end gap-1.5">
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])])
                      e.target.value = ""
                    }}
                  />
                  <div className="min-w-0 flex-1">
                  <ComposerBox
                    agent={<AgentToggle checked disabled />}
                    controls={<ComposerControls sessionKey={sessionKey} disabled={sending} onCamera={(photos) => setFiles((fs) => [...fs, ...photos])} />}
                    onSend={send}
                    canSend={Boolean(text.trim()) || (!editing && (files.length > 0 || refs.length > 0))}
                    sending={sending}
                    onStop={running ? () => act(() => api.abort(sessionKey)) : undefined}
                  >
                  <SkillDropup value={text} sessionKey={sessionKey} onChange={setText} />
                  <PathDropup value={text} folder={summary?.path ?? ""} onChange={setText} />
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={editing ? "Edit message…" : running ? (mode === "steer" ? "Steer the agent…" : "Queue a follow-up…") : "Message the agent…"}
                    className={cn("max-h-48 min-h-12 resize-none border-0 shadow-none focus-visible:ring-0 py-3")}
                    rows={1}
                  />
                  </ComposerBox>
                  </div>
                </div>
                <ComposerTools sessionKey={sessionKey} folder={summary?.path ?? ""} onAttach={() => fileInput.current?.click()}
                  onInsert={setText}
                  browser={{ live: browserLive, shown: browserShown, toggle: () => setBrowserShown((s) => !s) }}
                />
                {state && !state.live && state.messages.length > 0 && <p className="text-center text-[11px] text-muted-foreground">Sending a message resumes this session.</p>}
              </>
            ) : (
              <p className="flex items-center justify-center gap-1.5 py-2 text-sm text-muted-foreground">
                <Eye className="size-4" /> You have view-only access.
              </p>
            )}
          </div>
        </div>
      </div>
      {browserShown && (
        // Beside the chat on wide screens; over it on phones.
        <div className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[55%] lg:max-w-[calc(100%-22rem)] lg:shrink-0 lg:border-l">
          <BrowserPanel sessionKey={sessionKey} picks={refs.length} onPick={addRef} onClose={() => setBrowserShown(false)} />
        </div>
      )}

      <StepsDialog steps={openRun?.steps ?? []} open={Boolean(openRun)} index={open?.step ?? null} onIndex={(step) => setOpen((current) => current && { ...current, step })} onClose={() => setOpen(null)} />
      {summary && <ShareDialog session={summary} open={shareOpen} onOpenChange={setShareOpen} onSaved={setSummary} />}
      <DeleteSessionDialog session={deleteOpen ? summary : undefined} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
      <ForwardDialog text={forwarding} from={{ kind: "session", id: sessionKey }} onOpenChange={(o) => !o && setForwarding(undefined)} />
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void act(async () => {
                await api.rename(sessionKey, newName)
                setRenameOpen(false)
                refresh()
              })
            }}
            className="grid gap-4"
          >
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
