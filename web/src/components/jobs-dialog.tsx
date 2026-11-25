import { useLocale } from "@/lib/i18n"
import { ChevronRight, Clock, Loader2, Play, Plus, ShieldCheck, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, type Job, type JobInput, type JobSessionRef, type JobStep } from "@/lib/api"
import { blankStep, formatHeaders, jobStatus, parseHeaders, type JobStatus } from "@/lib/jobs"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn } from "@/lib/utils"

const when = (iso: string, language: string) => new Date(iso).toLocaleString(language, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

const STATUS: Record<JobStatus, { dot: string; label: "jobs.running" | "jobs.approval" | "jobs.paused" | "jobs.failing" | "jobs.active" }> = {
  running: { dot: "bg-blue-500 animate-pulse", label: "jobs.running" },
  approval: { dot: "bg-amber-500", label: "jobs.approval" },
  paused: { dot: "bg-muted-foreground/40", label: "jobs.paused" },
  failing: { dot: "bg-red-500", label: "jobs.failing" },
  active: { dot: "bg-green-500", label: "jobs.active" },
}

const STEP_LABEL = { prompt: "jobs.prompt", script: "jobs.script", http: "jobs.http" } as const satisfies Record<JobStep["type"], string>

/** Keeps its own text, so a line still being typed (no colon yet) is not dropped. */
function HeadersField({ headers, onChange }: { headers: Record<string, string>; onChange: (headers: Record<string, string>) => void }) {
  const { t: tr } = useLocale()
  const [text, setText] = useState(() => formatHeaders(headers))
  // Follow outside changes (discard, a save from elsewhere) without fighting the typing.
  if (JSON.stringify(parseHeaders(text)) !== JSON.stringify(headers)) setText(formatHeaders(headers))
  return (
    <Textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseHeaders(e.target.value))
      }}
      rows={2}
      className="font-mono text-xs"
      placeholder={tr("ui.header-value-one-per-line-5e560c")}
    />
  )
}

function StepEditor({ step, onChange, onRemove }: { step: JobStep; onChange: (step: JobStep) => void; onRemove?: () => void }) {
  const { t: tr } = useLocale()
  const timeout = (max: number) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {tr("ui.timeout-d4c45d")}
      <Input type="number" min={1} max={max} value={step.type === "prompt" ? "" : step.timeoutSec} onChange={(e) => onChange({ ...step, timeoutSec: Number(e.target.value) } as JobStep)} className="h-7 w-20 text-xs" />s
    </label>
  )
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-2">
        <Select value={step.type} onValueChange={(type) => onChange(blankStep(type as JobStep["type"]))}>
          <SelectTrigger size="sm" className="w-auto text-xs" aria-label={tr("ui.step-type-5dd37b")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STEP_LABEL) as JobStep["type"][]).map((type) => (
              <SelectItem key={type} value={type}>
                {tr(STEP_LABEL[type])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        {onRemove && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={tr("ui.remove-step-088d48")}>
            <X />
          </Button>
        )}
      </div>
      {step.type === "prompt" && (
        <>
          <Textarea value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} rows={3} className="text-sm" placeholder={tr("ui.what-the-agent-should-do-2586d7")} />
          <p className="text-[11px] text-muted-foreground">
            <code>{"{{output}}"}</code> {tr("ui.stands-for-the-previous-step-s-outp-89a0c1")}
          </p>
        </>
      )}
      {step.type === "script" && (
        <>
          <Textarea value={step.command} onChange={(e) => onChange({ ...step, command: e.target.value })} rows={2} className="font-mono text-xs" placeholder={tr("ui.shell-command-run-in-the-job-s-fold-205993")} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{tr("ui.runs-as-the-server-s-user-the-previ-5ab41d")}</p>
            {timeout(600)}
          </div>
        </>
      )}
      {step.type === "http" && (
        <>
          <div className="flex gap-2">
            <Select value={step.method} onValueChange={(method) => onChange({ ...step, method: method as typeof step.method })}>
              <SelectTrigger size="sm" className="w-24 shrink-0 text-xs" aria-label={tr("ui.method-883069")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} className="h-8 min-w-0 flex-1 font-mono text-xs" placeholder="https://…" />
          </div>
          <HeadersField headers={step.headers} onChange={(headers) => onChange({ ...step, headers })} />
          {step.method !== "GET" && <Textarea value={step.body ?? ""} onChange={(e) => onChange({ ...step, body: e.target.value || undefined })} rows={3} className="font-mono text-xs" placeholder={tr("ui.request-body-943cee")} />}
          <div className="flex justify-end">{timeout(120)}</div>
        </>
      )}
    </div>
  )
}

function SessionLink({ session, onOpen }: { session: JobSessionRef; onOpen: (s: JobSessionRef) => void }) {
  return (
    <button type="button" className="font-medium underline underline-offset-2" onClick={() => onOpen(session)}>
      {session.name}
    </button>
  )
}

const draftOf = (job: Job): JobInput => ({ name: job.name, schedule: job.schedule, steps: job.steps, enabled: job.enabled })

function JobItem({ job, onChange, onDeleted, onOpenSession }: { job: Job; onChange: (job: Job) => void; onDeleted: () => void; onOpenSession: (s: JobSessionRef) => void }) {
  const { t: tr, language } = useLocale()
  const [open, setOpen] = useState(!job.approved)
  /** Unsaved edits; until the first one the item shows the server's version, which may change live. */
  const [edits, setEdits] = useState<JobInput>()
  const draft = edits ?? draftOf(job)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty = Boolean(edits) && JSON.stringify(edits) !== JSON.stringify(draftOf(job))
  const status = jobStatus(job)

  const act = async (action: () => Promise<{ job: Job }>) => {
    setBusy(true)
    try {
      onChange((await action()).job)
      setEdits(undefined)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const save = () => act(() => api.updateJob(job.id, draft))
  const remove = async () => {
    setBusy(true)
    try {
      await api.deleteJob(job.id)
      onDeleted()
    } catch (error) {
      toast.error((error as Error).message)
      setBusy(false)
    }
  }
  const setStep = (index: number, step: JobStep) => setEdits({ ...draft, steps: draft.steps.map((s, i) => (i === index ? step : s)) })

  return (
    <li className="min-w-0 rounded-md border [overflow-wrap:anywhere] [&_.grid]:min-w-0 [&_.grid]:grid-cols-1">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={cn("size-2 shrink-0 rounded-full", STATUS[status].dot)} title={tr(STATUS[status].label)} />
        <span className="grid min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{job.name}</span>
            {status !== "active" && (
              <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-normal", status === "approval" && "border-amber-500/60 text-amber-600 dark:text-amber-400")}>
                {tr(STATUS[status].label)}
              </Badge>
            )}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            <code>{job.schedule}</code>
            {job.nextRunAt && ` · ${tr("jobs.nextRun", { time: when(job.nextRunAt, language) })}`} · /{job.folder}
          </span>
        </span>
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="grid gap-3 border-t px-3 py-3">
          <p className="text-xs text-muted-foreground">{tr(job.recipients?.length ? "jobs.outputWithRecipients" : "jobs.outputOwnerOnly", { owner: job.owner, recipients: job.recipients?.join(", ") ?? "" })} {tr("jobs.outputAccess")}</p>
          {(job.proposedIn || job.note) && (
            <p className="text-xs text-muted-foreground">
              {job.proposedIn ? (
                <>
                  {tr("ui.proposed-by-the-agent-in-75ce05")} <SessionLink session={job.proposedIn} onOpen={onOpenSession} />
                </>
              ) : (
                "Proposed by an agent"
              )}
              {job.note && <>: {job.note}</>}
            </p>
          )}
          {!job.approved && (
            <div className="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <p>
                {tr("ui.this-job-does-not-run-until-it-is-a-b9f253")} {tr(job.needsAdmin ? "jobs.scriptWarning" : "jobs.promptWarning")}
              </p>
              {job.canApprove ? (
                <Button size="sm" className="justify-self-start" disabled={busy || dirty} onClick={() => void act(() => api.approveJob(job.id))} title={dirty ? tr("jobs.saveFirst") : undefined}>
                  <ShieldCheck /> {tr("ui.approve-and-enable-795acb")}
                </Button>
              ) : (
                <p className="font-medium">{job.needsAdmin ? tr("jobs.waitAdmin") : tr("jobs.waitOwner", { owner: job.owner })}</p>
              )}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`job-name-${job.id}`}>{tr("ui.name-709a23")}</Label>
            <Input id={`job-name-${job.id}`} value={draft.name} onChange={(e) => setEdits({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`job-schedule-${job.id}`}>{tr("ui.schedule-0a8ada")}</Label>
            <Input id={`job-schedule-${job.id}`} value={draft.schedule} onChange={(e) => setEdits({ ...draft, schedule: e.target.value })} className="font-mono text-sm" />
            <p className="text-[11px] text-muted-foreground">
              {tr("ui.cron-in-the-server-s-time-2da398")}<code>30 7 * * 1-5</code> {tr("ui.weekdays-7-30-f8314c")} <code>@daily</code>, <code>@weekly</code> {tr("ui.or-175835")} <code>@every 2h</code>{tr("ui.at-most-every-5-minutes-c3dad9")}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => setEdits({ ...draft, enabled })} />
            {tr("ui.enabled-df174a")}
          </label>
          <div className="grid gap-1.5">
            <Label>{tr("ui.steps-run-in-order-f16e51")}</Label>
            {draft.steps.map((step, i) => (
              <StepEditor key={i} step={step} onChange={(next) => setStep(i, next)} onRemove={draft.steps.length > 1 ? () => setEdits({ ...draft, steps: draft.steps.filter((_, j) => j !== i) }) : undefined} />
            ))}
            {draft.steps.length < 5 && (
              <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setEdits({ ...draft, steps: [...draft.steps, blankStep("prompt")] })}>
                <Plus /> {tr("ui.add-step-2a4b94")}
              </Button>
            )}
          </div>
          {draft.steps.some((s) => s.type === "prompt") && (
            <p className="text-xs text-muted-foreground">
              {tr("ui.prompts-go-to-b20929")} {job.session ? <SessionLink session={job.session} onOpen={onOpenSession} /> : "a new session, made on the first run"}.
            </p>
          )}
          {job.lastRun && (
            <div className="grid gap-1">
              <p className={cn("text-xs", job.lastRun.ok ? "text-muted-foreground" : "text-destructive")}>
                {tr("ui.last-run-333c63")} {when(job.lastRun.at, language)} · {job.lastRun.ok ? "succeeded" : "failed"} in {Math.round(job.lastRun.ms / 1000)} s
              </p>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">{job.lastRun.output || "(no output)"}</pre>
            </div>
          )}
          {dirty && job.approved && !job.canApprove && <p className="text-xs text-amber-600 dark:text-amber-400">{tr("ui.changing-the-schedule-or-steps-of-t-6cef79")}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
              {busy && <Loader2 className="animate-spin" />} {tr("ui.save-efc007")}
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => setEdits(undefined)} disabled={busy}>
                {tr("ui.discard-36fff6")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void act(() => api.runJob(job.id))} disabled={busy || dirty || !job.approved || job.running} title={!job.approved ? tr("jobs.approveFirst") : undefined}>
              <Play /> {tr("ui.run-now-2af00e")}
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant={confirmDelete ? "destructive" : "ghost"} onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)} disabled={busy}>
              <Trash2 /> {tr(confirmDelete ? "jobs.deleteConfirm" : "ui.delete-f6fdbe")}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Scheduled jobs the user owns (admins see everyone's), each an accordion with its settings. */
export function JobsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t: tr } = useLocale()
  const nav = useNav()
  const [jobs, setJobs] = useState<Job[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(() => api.jobs().then(({ jobs }) => (setJobs(jobs), setError(undefined)), (e: Error) => setError(e.message)), [])
  useEffect(() => {
    if (!open) return
    void load()
    return subscribeUserEvents((event) => (event.type === "jobs" || event.type === "stream_open") && void load())
  }, [open, load])

  const openSession = (session: JobSessionRef) => {
    onOpenChange(false)
    nav.openSession(session.key, session.folder)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("ui.scheduled-jobs-3fea94")}</DialogTitle>
          <DialogDescription>{tr("ui.prompts-scripts-and-http-calls-that-bfdbeb")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 grid min-h-0 min-w-0 grid-cols-1 gap-2 overflow-y-auto px-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!jobs && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {jobs?.length === 0 && (
            <div className="grid justify-items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
              <Clock className="size-8 opacity-50" />
              <p>{tr("ui.no-scheduled-jobs-yet-bcc892")}</p>
              <p className="text-xs">{tr("ui.ask-the-agent-for-example-every-wee-9d8128")}</p>
            </div>
          )}
          {jobs && jobs.length > 0 && (
            <ul className="grid min-w-0 grid-cols-1 gap-2">
              {jobs.map((job) => (
                <JobItem
                  key={job.id}
                  job={job}
                  onChange={(next) => setJobs((all) => all?.map((j) => (j.id === next.id ? next : j)))}
                  onDeleted={() => setJobs((all) => all?.filter((j) => j.id !== job.id))}
                  onOpenSession={openSession}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
