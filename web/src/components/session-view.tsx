import {
  ArrowUp,
  CircleStop,
  Eye,
  Loader2,
  MoreVertical,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Power,
  Share2,
  TriangleAlert,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AuthorAvatar } from "@/components/author-avatar"
import { Markdown } from "@/components/markdown"
import { ModelPicker, ThinkingPicker } from "@/components/model-picker"
import { ShareDialog } from "@/components/share-dialog"
import { StepDialog } from "@/components/step-dialog"
import { StepStrip } from "@/components/step-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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

function UserBubble({ message }: { message: AgentMessage }) {
  const text = messageText(message.content)
  const images = Array.isArray(message.content) ? message.content.filter((c: any) => c?.type === "image") : []
  return (
    <div className="flex items-start justify-end gap-2">
      <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
        <div className="mb-1 text-xs font-semibold">{message.author?.username ?? "Unknown author"}</div>
        <div className="whitespace-pre-wrap break-words">{text}</div>
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {images.map((img: any, i: number) => (
              <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="max-h-28 rounded" />
            ))}
          </div>
        )}
      </div>
      <AuthorAvatar id={message.author?.id ?? "unknown"} name={message.author?.username ?? "?"} />
    </div>
  )
}

function RunView({ run, onOpen }: { run: Run; onOpen: (index: number) => void }) {
  return (
    <div className="space-y-1.5">
      {run.user && <UserBubble message={run.user} />}
      {(run.steps.length > 0 || run.running) && <div className="flex items-center gap-2 text-xs text-muted-foreground"><AuthorAvatar id="agent" name="π" /> Agent</div>}
      <StepStrip steps={run.steps} running={run.running} onOpen={onOpen} />
      {run.answer && (
        <div className="rounded-lg">
          <Markdown text={run.answer} />
          {run.answerStreaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-middle" />}
        </div>
      )}
      {run.running && !run.answerStreaming && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> working…
        </div>
      )}
    </div>
  )
}

function ExtensionDialogView({ dialog, onAnswer }: { dialog?: ExtensionDialog; onAnswer: (answer: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void }) {
  const [value, setValue] = useState("")
  useEffect(() => setValue(dialog?.prefill ?? ""), [dialog])
  return (
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && onAnswer({ cancelled: true })}>
      <DialogContent>
        {dialog && (
          <>
            <DialogHeader>
              <DialogTitle>{dialog.title ?? "The agent asks"}</DialogTitle>
              {dialog.message && <DialogDescription className="whitespace-pre-wrap">{dialog.message}</DialogDescription>}
            </DialogHeader>
            {dialog.method === "select" && (
              <div className="grid gap-2">
                {dialog.options?.map((o) => (
                  <Button key={o} variant="outline" className="h-auto justify-start py-2 text-left whitespace-normal" onClick={() => onAnswer({ value: o })}>
                    {o}
                  </Button>
                ))}
              </div>
            )}
            {(dialog.method === "input" || dialog.method === "editor") && (
              <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder={dialog.placeholder} rows={dialog.method === "editor" ? 8 : 2} />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onAnswer(dialog.method === "confirm" ? { confirmed: false } : { cancelled: true })}>
                {dialog.method === "confirm" ? "No" : "Cancel"}
              </Button>
              {dialog.method === "confirm" && <Button onClick={() => onAnswer({ confirmed: true })}>Yes</Button>}
              {(dialog.method === "input" || dialog.method === "editor") && <Button onClick={() => onAnswer({ value })}>Submit</Button>}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SessionView({ sessionKey, header }: { sessionKey: string; header?: React.ReactNode }) {
  const { state, connected } = useSessionStream(sessionKey)
  const [summary, setSummary] = useState<SessionSummary>()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [open, setOpen] = useState<{ run: number; step: number } | null>(null)
  const [authorFilter, setAuthorFilter] = useState("all")
  const [text, setText] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<"steer" | "followUp">("steer")
  const [sending, setSending] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    api.session(sessionKey).then(({ session }) => setSummary(session), (error) => toast.error(error.message))
  }, [sessionKey])

  useEffect(() => {
    setSummary(undefined)
    setOpen(null)
    setAuthorFilter("all")
    stick.current = true
    refresh()
  }, [refresh])

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

  // Keep the newest output in view unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [runs])

  const canWrite = summary?.access === "owner" || summary?.access === "admin" || summary?.access === "write"
  const running = Boolean(state?.running)
  const title = state?.name || summary?.name || summary?.firstMessage || "New session"

  const send = async () => {
    const body = text.trim()
    if ((!body && files.length === 0) || !summary) return
    setSending(true)
    try {
      let prompt = body
      let images: { data: string; mimeType: string }[] | undefined
      if (files.length) {
        const dir = summary.path ? `${summary.path}/uploads` : "uploads"
        const uploaded = await api.upload(dir, files)
        const rel = uploaded.files.map((f) => (summary.path && f.path.startsWith(`${summary.path}/`) ? f.path.slice(summary.path.length + 1) : f.path))
        prompt = `${body || "See the attached files."}\n\nAttached files (relative to the working directory):\n${rel.map((p) => `- ${p}`).join("\n")}`
        const model = models.find((m) => m.provider === state?.model?.provider && m.id === state?.model?.id)
        if (!model || model.input?.includes("image")) {
          const imgs = files.filter((f) => f.type.startsWith("image/") && f.size <= MAX_INLINE_IMAGE)
          if (imgs.length) images = await Promise.all(imgs.map(async (f) => ({ data: await readBase64(f), mimeType: f.type })))
        }
      }
      await api.prompt(sessionKey, { text: prompt, images, mode: running ? mode : undefined })
      setText("")
      setFiles([])
      stick.current = true
      if (!summary.live) refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (error) {
      toast.error((error as Error).message)
    }
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5 sm:px-3">
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {canWrite && (
        <div className="scrollbar-thin flex items-center gap-1.5 overflow-x-auto border-b px-2 py-1.5 sm:px-3">
          <ModelPicker compact models={models} value={state?.model} onChange={(m) => act(() => api.setModel(sessionKey, m.provider, m.id))} />
          <ThinkingPicker compact value={state?.thinkingLevel} onChange={(l) => act(() => api.setThinking(sessionKey, l))} />
        </div>
      )}

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
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 sm:px-4">
          {!state && <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />}
          {state && runs.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">No messages yet. Ask the agent something.</p>}
          {authorFilter !== "all" && <p className="text-xs text-muted-foreground">Showing this author’s prompts with their agent responses. <button className="underline" onClick={() => setAuthorFilter("all")}>Show everyone</button></p>}
          {state && runs.length > 0 && visibleRuns.length === 0 && <p className="text-sm text-muted-foreground">No prompts from this author.</p>}
          {visibleRuns.map(({ run, index }) => (
            <RunView key={run.key} run={run} onOpen={(step) => setOpen({ run: index, step })} />
          ))}
          {state?.notice?.level === "error" && !running && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{state.notice.text}</span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
        <div className="mx-auto max-w-3xl space-y-2">
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
                <Button variant="ghost" size="icon" onClick={() => fileInput.current?.click()} aria-label="Attach files">
                  <Paperclip />
                </Button>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={running ? (mode === "steer" ? "Steer the agent…" : "Queue a follow-up…") : "Message the agent…"}
                  className="max-h-48 min-h-10 resize-none py-2"
                  rows={1}
                />
                {running && (
                  <Button variant="destructive" size="icon" onClick={() => act(() => api.abort(sessionKey))} aria-label="Stop the agent">
                    <CircleStop />
                  </Button>
                )}
                <Button size="icon" onClick={send} disabled={sending || (!text.trim() && files.length === 0)} aria-label="Send">
                  {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </Button>
              </div>
              {state && !state.live && state.messages.length > 0 && <p className="text-center text-[11px] text-muted-foreground">Sending a message resumes this session.</p>}
            </>
          ) : (
            <p className="flex items-center justify-center gap-1.5 py-2 text-sm text-muted-foreground">
              <Eye className="size-4" /> You have view-only access.
            </p>
          )}
        </div>
      </div>

      <StepDialog steps={openRun?.steps ?? []} index={open?.step ?? null} onIndex={(step) => setOpen(step === null ? null : { run: open!.run, step })} />
      <ExtensionDialogView dialog={canWrite ? state?.dialogs[0] : undefined} onAnswer={(answer) => state?.dialogs[0] && act(() => api.answerDialog(sessionKey, { id: state.dialogs[0].id, ...answer }))} />
      {summary && <ShareDialog session={summary} open={shareOpen} onOpenChange={setShareOpen} onSaved={setSummary} />}
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
