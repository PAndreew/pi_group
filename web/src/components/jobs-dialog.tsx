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

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

const STATUS: Record<JobStatus, { dot: string; label: string }> = {
  running: { dot: "bg-blue-500 animate-pulse", label: "running" },
  approval: { dot: "bg-amber-500", label: "needs approval" },
  paused: { dot: "bg-muted-foreground/40", label: "paused" },
  failing: { dot: "bg-red-500", label: "last run failed" },
  active: { dot: "bg-green-500", label: "active" },
}

const STEP_LABEL: Record<JobStep["type"], string> = { prompt: "Prompt to the agent", script: "Script", http: "HTTP request" }

/** Keeps its own text, so a line still being typed (no colon yet) is not dropped. */
function HeadersField({ headers, onChange }: { headers: Record<string, string>; onChange: (headers: Record<string, string>) => void }) {
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
      placeholder="Header: value (one per line)"
    />
  )
}

function StepEditor({ step, onChange, onRemove }: { step: JobStep; onChange: (step: JobStep) => void; onRemove?: () => void }) {
  const timeout = (max: number) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      Timeout
      <Input type="number" min={1} max={max} value={step.type === "prompt" ? "" : step.timeoutSec} onChange={(e) => onChange({ ...step, timeoutSec: Number(e.target.value) } as JobStep)} className="h-7 w-20 text-xs" />s
    </label>
  )
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-2">
        <Select value={step.type} onValueChange={(type) => onChange(blankStep(type as JobStep["type"]))}>
          <SelectTrigger size="sm" className="w-auto text-xs" aria-label="Step type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STEP_LABEL) as JobStep["type"][]).map((type) => (
              <SelectItem key={type} value={type}>
                {STEP_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        {onRemove && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove step">
            <X />
          </Button>
        )}
      </div>
      {step.type === "prompt" && (
        <>
          <Textarea value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} rows={3} className="text-sm" placeholder="What the agent should do" />
          <p className="text-[11px] text-muted-foreground">
            <code>{"{{output}}"}</code> stands for the previous step's output; without it the output is added at the end.
          </p>
        </>
      )}
      {step.type === "script" && (
        <>
          <Textarea value={step.command} onChange={(e) => onChange({ ...step, command: e.target.value })} rows={2} className="font-mono text-xs" placeholder="Shell command, run in the job's folder" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Runs as the server's user; the previous output arrives on stdin.</p>
            {timeout(600)}
          </div>
        </>
      )}
      {step.type === "http" && (
        <>
          <div className="flex gap-2">
            <Select value={step.method} onValueChange={(method) => onChange({ ...step, method: method as typeof step.method })}>
              <SelectTrigger size="sm" className="w-24 text-xs" aria-label="Method">
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
            <Input value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} className="h-8 font-mono text-xs" placeholder="https://…" />
          </div>
          <HeadersField headers={step.headers} onChange={(headers) => onChange({ ...step, headers })} />
          {step.method !== "GET" && <Textarea value={step.body ?? ""} onChange={(e) => onChange({ ...step, body: e.target.value || undefined })} rows={3} className="font-mono text-xs" placeholder="Request body" />}
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
    <li className="rounded-md border">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={cn("size-2 shrink-0 rounded-full", STATUS[status].dot)} title={STATUS[status].label} />
        <span className="grid min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{job.name}</span>
            {status !== "active" && (
              <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-normal", status === "approval" && "border-amber-500/60 text-amber-600 dark:text-amber-400")}>
                {STATUS[status].label}
              </Badge>
            )}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            <code>{job.schedule}</code>
            {job.nextRunAt && ` · next ${when(job.nextRunAt)}`} · /{job.folder}
          </span>
        </span>
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="grid gap-3 border-t px-3 py-3">
          <p className="text-xs text-muted-foreground">Output session: owner {job.owner}{job.recipients?.length ? ` + ${job.recipients.join(", ")}` : " only"}. Recipients get read access to the entire session and run notifications (push requires device permission).</p>
          {(job.proposedIn || job.note) && (
            <p className="text-xs text-muted-foreground">
              {job.proposedIn ? (
                <>
                  Proposed by the agent in <SessionLink session={job.proposedIn} onOpen={onOpenSession} />
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
                This job does not run until it is approved. Check every step below: {job.needsAdmin ? "scripts run with the server's permissions, so only an admin can approve them." : "approving lets it act as you on its schedule."}
              </p>
              {job.canApprove ? (
                <Button size="sm" className="justify-self-start" disabled={busy || dirty} onClick={() => void act(() => api.approveJob(job.id))} title={dirty ? "Save your changes first" : undefined}>
                  <ShieldCheck /> Approve and enable
                </Button>
              ) : (
                <p className="font-medium">{job.needsAdmin ? "Waiting for an admin." : `Waiting for ${job.owner}.`}</p>
              )}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`job-name-${job.id}`}>Name</Label>
            <Input id={`job-name-${job.id}`} value={draft.name} onChange={(e) => setEdits({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`job-schedule-${job.id}`}>Schedule</Label>
            <Input id={`job-schedule-${job.id}`} value={draft.schedule} onChange={(e) => setEdits({ ...draft, schedule: e.target.value })} className="font-mono text-sm" />
            <p className="text-[11px] text-muted-foreground">
              Cron in the server's time (<code>30 7 * * 1-5</code> = weekdays 7:30), <code>@daily</code>, <code>@weekly</code> or <code>@every 2h</code>; at most every 5 minutes.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => setEdits({ ...draft, enabled })} />
            Enabled
          </label>
          <div className="grid gap-1.5">
            <Label>Steps, run in order</Label>
            {draft.steps.map((step, i) => (
              <StepEditor key={i} step={step} onChange={(next) => setStep(i, next)} onRemove={draft.steps.length > 1 ? () => setEdits({ ...draft, steps: draft.steps.filter((_, j) => j !== i) }) : undefined} />
            ))}
            {draft.steps.length < 5 && (
              <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setEdits({ ...draft, steps: [...draft.steps, blankStep("prompt")] })}>
                <Plus /> Add step
              </Button>
            )}
          </div>
          {draft.steps.some((s) => s.type === "prompt") && (
            <p className="text-xs text-muted-foreground">
              Prompts go to {job.session ? <SessionLink session={job.session} onOpen={onOpenSession} /> : "a new session, made on the first run"}.
            </p>
          )}
          {job.lastRun && (
            <div className="grid gap-1">
              <p className={cn("text-xs", job.lastRun.ok ? "text-muted-foreground" : "text-destructive")}>
                Last run {when(job.lastRun.at)} · {job.lastRun.ok ? "succeeded" : "failed"} in {Math.round(job.lastRun.ms / 1000)} s
              </p>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">{job.lastRun.output || "(no output)"}</pre>
            </div>
          )}
          {dirty && job.approved && !job.canApprove && <p className="text-xs text-amber-600 dark:text-amber-400">Changing the schedule or steps of this job means an admin has to approve it again.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => setEdits(undefined)} disabled={busy}>
                Discard
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void act(() => api.runJob(job.id))} disabled={busy || dirty || !job.approved || job.running} title={!job.approved ? "Approve it first" : undefined}>
              <Play /> Run now
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant={confirmDelete ? "destructive" : "ghost"} onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)} disabled={busy}>
              <Trash2 /> {confirmDelete ? "Delete for good" : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Scheduled jobs the user owns (admins see everyone's), each an accordion with its settings. */
export function JobsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scheduled jobs</DialogTitle>
          <DialogDescription>Prompts, scripts and HTTP calls that run on a schedule. Ask the agent to set one up; it runs once you approve it here.</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 grid min-h-0 gap-2 overflow-y-auto px-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!jobs && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {jobs?.length === 0 && (
            <div className="grid justify-items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
              <Clock className="size-8 opacity-50" />
              <p>No scheduled jobs yet.</p>
              <p className="text-xs">Ask the agent, for example: “Every weekday at 7:30, check the weather and tell me if I need an umbrella.”</p>
            </div>
          )}
          {jobs && jobs.length > 0 && (
            <ul className="grid gap-2">
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
