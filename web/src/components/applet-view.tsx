import { ArrowUp, CheckCircle2, CircleSlash, File, Folder, FolderOpen, LayoutGrid, Loader2, Play, ShieldCheck, Trash2, Upload, X, XCircle } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, type Applet, type AppletField, type AppletRun, type AppletSpec, type FsEntry } from "@/lib/api"
import { uploadDir } from "@/lib/attachments"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"
import { cn } from "@/lib/utils"

type Value = string | number | boolean | string[]
type Values = Record<string, Value>
type InputField = Exclude<AppletField, { type: "markdown" }>

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
const many = (field: InputField) => (field.type === "select" || field.type === "file") && Boolean(field.multiple)

function initialValues(spec: AppletSpec): Values {
  const values: Values = {}
  for (const field of spec.fields) {
    if (field.type === "markdown") continue
    if (field.type === "checkbox") values[field.id] = field.default ?? false
    else if (field.type === "number") values[field.id] = field.default ?? ""
    else if (field.type === "select") values[field.id] = field.default ?? (field.multiple ? [] : "")
    else if (field.type === "text" || field.type === "textarea" || field.type === "radio") values[field.id] = field.default ?? ""
    else values[field.id] = many(field) ? [] : ""
  }
  return values
}

const blank = (value: Value | undefined) => value === undefined || value === "" || (Array.isArray(value) && value.length === 0)

/** Files or a folder under the shared root, browsed from `start`. */
function PathPicker({ mode, accept, multiple, start, open, onOpenChange, onPick }: { mode: "file" | "folder"; accept?: string[]; multiple?: boolean; start: string; open: boolean; onOpenChange: (open: boolean) => void; onPick: (paths: string[]) => void }) {
  const [dir, setDir] = useState(start)
  const [entries, setEntries] = useState<FsEntry[]>()
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setDir(start)
    setPicked([])
  }, [open, start])
  useEffect(() => {
    if (!open) return
    setEntries(undefined)
    api.list(dir).then(({ entries }) => (setEntries(entries), setError(undefined)), (e: Error) => setError(e.message))
  }, [open, dir])

  const fits = (entry: FsEntry) => entry.type === "dir" || (mode === "file" && (!accept?.length || accept.some((ext) => entry.name.toLowerCase().endsWith(ext.toLowerCase()))))
  const choose = (entry: FsEntry) => {
    if (entry.type === "dir") return setDir(entry.path)
    if (!multiple) return (onPick([entry.path]), onOpenChange(false))
    setPicked((all) => (all.includes(entry.path) ? all.filter((p) => p !== entry.path) : [...all, entry.path]))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "folder" ? "Choose a folder" : multiple ? "Choose files" : "Choose a file"}</DialogTitle>
          <DialogDescription className="truncate">/{dir}</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2">
          {dir && (
            <li>
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent" onClick={() => setDir(dir.split("/").slice(0, -1).join("/"))}>
                <ArrowUp className="size-4" /> ..
              </button>
            </li>
          )}
          {error && <li className="text-sm text-destructive">{error}</li>}
          {!entries && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {entries?.filter(fits).map((entry) => (
            <li key={entry.path}>
              <button type="button" className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", picked.includes(entry.path) && "bg-accent font-medium")} onClick={() => choose(entry)}>
                {entry.type === "dir" ? <Folder className="size-4 shrink-0 text-sky-500" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          ))}
          {entries && !entries.some(fits) && <li className="px-2 py-3 text-sm text-muted-foreground">Nothing to choose here.</li>}
        </ul>
        {(mode === "folder" || multiple) && (
          <DialogFooter>
            <Button onClick={() => (onPick(mode === "folder" ? [dir] : picked), onOpenChange(false))} disabled={mode === "file" && !picked.length}>
              {mode === "folder" ? "Choose this folder" : `Choose ${picked.length || ""} file${picked.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Picked paths as chips, filled by uploading into the applet folder's uploads or by browsing. */
function PathField({ field, value, folder, disabled, onChange }: { field: Extract<InputField, { type: "file" | "folder" }>; value: Value; folder: string; disabled: boolean; onChange: (value: Value) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [browsing, setBrowsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const multiple = field.type === "file" && Boolean(field.multiple)
  const paths = Array.isArray(value) ? value : value ? [String(value)] : []
  const set = (next: string[]) => onChange(multiple ? [...new Set(next)] : (next.at(-1) ?? ""))

  const upload = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      const { files: saved } = await api.upload(uploadDir(folder), files)
      set([...(multiple ? paths : []), ...saved.map((f) => f.path)])
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid gap-2">
      {paths.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {paths.map((p) => (
            <li key={p} className="flex max-w-full items-center gap-1 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 text-xs">
              {field.type === "folder" ? <Folder className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}
              <span className="truncate" title={`/${p}`}>{p.split("/").pop() || "/"}</span>
              <Button variant="ghost" size="icon-sm" className="size-5" disabled={disabled} onClick={() => set(paths.filter((q) => q !== p))} aria-label={`Remove ${p}`}>
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {field.type === "file" && (
          <>
            <input ref={input} type="file" hidden multiple={multiple} accept={field.accept?.join(",")} onChange={(e) => {
                void upload([...(e.target.files ?? [])])
                e.target.value = ""
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => input.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload
            </Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setBrowsing(true)}>
          <FolderOpen /> {field.type === "folder" ? "Choose folder" : "From the workspace"}
        </Button>
      </div>
      <PathPicker mode={field.type} accept={field.type === "file" ? field.accept : undefined} multiple={multiple} start={folder} open={browsing} onOpenChange={setBrowsing} onPick={(picked) => set([...(multiple ? paths : []), ...picked])} />
    </div>
  )
}

function FieldInput({ field, value, folder, disabled, onChange }: { field: InputField; value: Value; folder: string; disabled: boolean; onChange: (value: Value) => void }) {
  const id = `applet-field-${field.id}`
  switch (field.type) {
    case "text":
      return <Input id={id} value={String(value)} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    case "textarea":
      return <Textarea id={id} value={String(value)} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="min-h-24" />
    case "number":
      return <Input id={id} type="number" value={String(value)} min={field.min} max={field.max} step={field.step} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="w-40" />
    case "select":
      if (!field.multiple)
        return (
          <Select value={String(value) || undefined} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={id} className="w-full sm:w-72">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-label`}>
          {field.options.map((o) => {
            const on = (value as string[]).includes(o)
            return (
              <button key={o} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? (value as string[]).filter((v) => v !== o) : [...(value as string[]), o])} className={cn("rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
                {o}
              </button>
            )
          })}
        </div>
      )
    case "radio":
      return (
        <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-50">
              <input type="radio" className="accent-primary" name={id} checked={value === o} disabled={disabled} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      )
    case "checkbox":
      return null
    default:
      return <PathField field={field} value={value} folder={folder} disabled={disabled} onChange={onChange} />
  }
}

/** The applet's form; `onRun` is left out to show it as a preview. */
function AppletForm({ spec, folder, onRun }: { spec: AppletSpec; folder: string; onRun?: (action: string, values: Values) => Promise<void> }) {
  const [values, setValues] = useState(() => initialValues(spec))
  const [busy, setBusy] = useState<string>()
  const disabled = !onRun || Boolean(busy)
  const inputs = spec.fields.filter((f): f is InputField => f.type !== "markdown")
  const missing = inputs.filter((f) => f.type !== "checkbox" && !f.optional && blank(values[f.id]))

  const run = async (action: string) => {
    if (!onRun) return
    setBusy(action)
    try {
      await onRun(action, values)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
      {spec.fields.map((field, i) =>
        field.type === "markdown" ? (
          <Markdown key={i} text={field.text} className="text-sm text-muted-foreground" />
        ) : field.type === "checkbox" ? (
          <label key={field.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={values[field.id] === true} disabled={disabled} onChange={(e) => setValues({ ...values, [field.id]: e.target.checked })} />
            <span>
              {field.label}
              {field.help && <span className="block text-xs text-muted-foreground">{field.help}</span>}
            </span>
          </label>
        ) : (
          <div key={field.id} className="grid gap-1.5">
            <Label id={`applet-field-${field.id}-label`} htmlFor={`applet-field-${field.id}`}>
              {field.label}
              {field.optional && <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <FieldInput field={field} value={values[field.id]} folder={folder} disabled={disabled} onChange={(value) => setValues({ ...values, [field.id]: value })} />
            {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
          </div>
        ),
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {spec.actions.map((action, i) => (
          <Button key={action.id} type="button" variant={i === 0 ? "default" : "outline"} disabled={disabled || missing.length > 0} onClick={() => void run(action.id)} title={missing.length ? `Fill in: ${missing.map((f) => f.label).join(", ")}` : undefined}>
            {busy === action.id ? <Loader2 className="animate-spin" /> : <Play />} {action.label}
          </Button>
        ))}
        {onRun && missing.length > 0 && <span className="text-xs text-muted-foreground">Fill in {missing.map((f) => f.label).join(", ")}</span>}
      </div>
    </form>
  )
}

function showValue(value: Value) {
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (Array.isArray(value)) return value.map((v) => v.split("/").pop()).join(", ")
  return String(value).length > 80 ? `${String(value).slice(0, 80)}…` : String(value)
}

function RunItem({ run, folder, onOpenSession }: { run: AppletRun; folder: string; onOpenSession: (key: string, folder: string) => void }) {
  const icon = {
    running: <Loader2 className="size-4 animate-spin text-sky-500" />,
    finished: <CheckCircle2 className="size-4 text-green-600" />,
    error: <XCircle className="size-4 text-destructive" />,
    aborted: <CircleSlash className="size-4 text-muted-foreground" />,
  }[run.status]
  const shown = Object.entries(run.values).filter(([, v]) => !blank(v) && v !== false)
  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {icon}
        <span className="font-medium">{run.action}</span>
        <span className="text-xs text-muted-foreground">{when(run.startedAt)}</span>
        <span className="flex-1" />
        {run.session && (
          <Button variant="ghost" size="sm" onClick={() => onOpenSession(run.session!.key, run.session!.folder)}>
            {run.status === "running" ? "Watch" : "Open session"}
          </Button>
        )}
      </div>
      {shown.length > 0 && <p className="text-xs break-words text-muted-foreground">{shown.map(([k, v]) => `${k}: ${showValue(v)}`).join(" · ")}</p>}
      {run.output && <Markdown text={run.output} base={run.session?.folder ?? folder} className={cn("max-h-96 overflow-y-auto text-sm", run.status === "error" && "text-destructive")} />}
    </li>
  )
}

/** What approving lets the applet do: the prompts its buttons send. */
function Prompts({ spec }: { spec: AppletSpec }) {
  return (
    <div className="grid gap-2">
      {spec.actions.map((a) => (
        <div key={a.id} className="grid gap-1">
          <p className="text-xs font-medium">“{a.label}” sends:</p>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">{a.prompt}</pre>
        </div>
      ))}
    </div>
  )
}

/** An applet's page (/apps/<slug>): its form, approval for its owner, and the signed-in user's runs. */
export function AppletView({ slug, header }: { slug: string; header?: React.ReactNode }) {
  const nav = useNav()
  const [applet, setApplet] = useState<Applet & { spec: AppletSpec }>()
  const [runs, setRuns] = useState<AppletRun[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(
    () =>
      api.applet(slug).then(
        (r) => (setApplet(r.applet), setRuns(r.runs), setError(undefined)),
        (e: Error) => setError(e.message),
      ),
    [slug],
  )
  useEffect(() => {
    void load()
    return subscribeUserEvents((event) => (event.type === "applets" || event.type === "stream_open") && void load())
  }, [load])

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const run = async (action: string, values: Values) => {
    try {
      const { run } = await api.runApplet(applet!.id, action, values)
      setRuns((all) => [run, ...all])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const remove = () =>
    act(async () => {
      await api.deleteApplet(applet!.id)
      toast.success(`Deleted ${applet!.title}`)
      nav.home()
    })

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 items-center gap-2 border-b px-2 py-1">
        {header}
        <LayoutGrid className="ml-1 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{applet?.title ?? slug}</h2>
          {applet && <p className="truncate text-[11px] text-muted-foreground">/apps/{applet.slug} · runs in /{applet.folder} · by {applet.owner}</p>}
        </div>
        {applet?.canManage && (
          <Button size="sm" variant={confirmDelete ? "destructive" : "ghost"} onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))} onBlur={() => setConfirmDelete(false)} disabled={busy}>
            <Trash2 /> {confirmDelete ? "Delete for good" : <span className="sr-only sm:not-sr-only">Delete</span>}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-2xl gap-6 p-4 sm:p-6">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!applet && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {applet && (
            <>
              {applet.description && <p className="text-sm text-muted-foreground">{applet.description}</p>}
              {applet.canManage && (!applet.approved || applet.draft) && (
                <section className="grid gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <p>
                    {applet.approved ? "The agent proposed a change. The approved version below keeps working until you approve it." : "Nobody can use this applet until you approve it."} Each button starts a new agent session in /{applet.folder} as the person who pressed it, with the prompt below filled in from the form.
                  </p>
                  {(applet.note || applet.proposedIn) && (
                    <p className="text-xs text-muted-foreground">
                      {applet.proposedIn ? (
                        <>
                          Proposed in{" "}
                          <button type="button" className="font-medium underline underline-offset-2" onClick={() => nav.openSession(applet.proposedIn!.key, applet.proposedIn!.folder)}>
                            {applet.proposedIn.name}
                          </button>
                        </>
                      ) : (
                        "Proposed by an agent"
                      )}
                      {applet.note && <>: {applet.note}</>}
                    </p>
                  )}
                  {applet.draft && (
                    <div className="grid gap-2 rounded-md border bg-background p-3">
                      <p className="text-xs font-medium text-muted-foreground">Proposed version (preview)</p>
                      <AppletForm key={`draft-${applet.version}`} spec={applet.draft} folder={applet.folder} />
                    </div>
                  )}
                  <Prompts spec={applet.draft ?? applet.spec} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void act(() => api.approveApplet(applet.id, applet.version))}>
                      <ShieldCheck /> {applet.draft ? "Approve the change" : "Approve"}
                    </Button>
                    {applet.draft && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => api.discardAppletDraft(applet.id))}>
                        Discard the change
                      </Button>
                    )}
                  </div>
                </section>
              )}
              <section className="rounded-lg border bg-card p-4">
                <AppletForm key={`${applet.id}-${applet.approvedAt}`} spec={applet.spec} folder={applet.folder} onRun={applet.approved ? run : undefined} />
              </section>
              {runs.length > 0 && (
                <section className="grid gap-2">
                  <h3 className="text-sm font-medium">Your runs</h3>
                  <ul className="grid gap-2">
                    {runs.map((r) => (
                      <RunItem key={r.id} run={r} folder={applet.folder} onOpenSession={nav.openSession} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
