import { Check, KeyRound, Loader2, Pencil, Plus, RefreshCw, Server, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, type RemoteMachine } from "@/lib/api"
import { cn, timeAgo } from "@/lib/utils"

const NAME = /^[A-Za-z0-9][\w.-]{0,39}$/
type Keys = Awaited<ReturnType<typeof api.remoteMachines>>["keys"]

const STATE = {
  online: { dot: "bg-green-500", label: "Online" },
  auth: { dot: "bg-amber-500", label: "Reachable, login refused" },
  offline: { dot: "bg-red-500", label: "Offline" },
  unknown: { dot: "bg-muted-foreground/40 animate-pulse", label: "Checking…" },
} as const

export function StatusDot({ machine, className }: { machine: Pick<RemoteMachine, "status">; className?: string }) {
  const s = STATE[machine.status.state]
  return <span className={cn("size-2.5 shrink-0 rounded-full", s.dot, className)} title={s.label} aria-label={s.label} />
}

/** A name people can type after #: the host's first label, cleaned up. */
const defaultName = (host: string) => host.split(".")[0].replace(/[^\w.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 40)

/**
 * Machines this server reaches over SSH: hosts of the server's ~/.ssh/config appear on their own,
 * others are added by hand. Each gets a name people refer to as #name in messages.
 */
export function RemoteMachinesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.remoteMachines>>>()
  const [checking, setChecking] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string }>()
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => api.remoteMachines().then(setData, (e) => toast.error(e.message)), [])
  const check = useCallback(async (id?: string) => {
    setChecking(true)
    try {
      const { machines } = await api.checkRemoteMachines(id)
      setData((d) => d && { ...d, machines: d.machines.map((m) => machines.find((x) => x.id === m.id) ?? m) })
    } catch (e) { toast.error((e as Error).message) } finally { setChecking(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setRenaming(undefined)
    setAdding(false)
    void load().then(() => check())
    const timer = setInterval(() => void load(), 20_000)
    return () => clearInterval(timer)
  }, [open, load, check])

  const rename = async () => {
    if (!renaming) return
    try {
      await api.updateRemoteMachine(renaming.id, { name: renaming.name })
      setRenaming(undefined)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }
  const remove = async (m: RemoteMachine) => {
    if (!confirm(`Remove #${m.name}?${m.source === "ssh-config" ? " It stays in ~/.ssh/config but is no longer listed here." : ""}`)) return
    try { await api.deleteRemoteMachine(m.id); await load() } catch (e) { toast.error((e as Error).message) }
  }

  const edit = data?.canEdit
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Server className="size-5" /> Remote machines</DialogTitle>
          <DialogDescription>Machines this server reaches over SSH. Type <code>#</code> and a name in a message to point the agent at one; it gets how to connect.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{data ? `${data.machines.length} machine${data.machines.length === 1 ? "" : "s"}` : ""}</span>
          <Button variant="outline" size="sm" className="ml-auto" disabled={checking || !data?.machines.length} onClick={() => void check()}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check all
          </Button>
        </div>
        {!data && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
        {data && !data.machines.length && !adding && <p className="text-sm text-muted-foreground">No machines yet. Hosts in the server’s <code>~/.ssh/config</code> show up here by themselves{edit ? ", or add one below" : ""}.</p>}
        <ul className="grid min-w-0 gap-1.5">
          {data?.machines.map((m) => (
            <li key={m.id} className="min-w-0 rounded-md border px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <StatusDot machine={m} />
                {renaming?.id === m.id ? (
                  <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void rename() }}>
                    <span className="text-sm text-muted-foreground">#</span>
                    <Input autoFocus className="h-7 min-w-0 flex-1" value={renaming.name} maxLength={40} aria-label="Name" onChange={(e) => setRenaming({ ...renaming, name: e.target.value.replace(/\s/g, "-") })} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setRenaming(undefined))} />
                    <Button size="icon-sm" variant="ghost" type="submit" disabled={!NAME.test(renaming.name)} aria-label="Save name"><Check /></Button>
                    <Button size="icon-sm" variant="ghost" type="button" onClick={() => setRenaming(undefined)} aria-label="Cancel"><X /></Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">#{m.name}</span>
                    {edit && <Button size="icon-sm" variant="ghost" onClick={() => setRenaming({ id: m.id, name: m.name })} aria-label={`Rename ${m.name}`} title="Rename"><Pencil /></Button>}
                    <Button size="icon-sm" variant="ghost" disabled={checking} onClick={() => void check(m.id)} aria-label={`Check ${m.name}`} title="Check now"><RefreshCw /></Button>
                    {edit && <Button size="icon-sm" variant="ghost" onClick={() => void remove(m)} aria-label={`Remove ${m.name}`} title="Remove"><Trash2 /></Button>}
                  </>
                )}
              </div>
              <div className="mt-1 grid min-w-0 gap-0.5 pl-4.5 text-xs text-muted-foreground">
                <span className="truncate" title={m.ssh}><code className="text-foreground/80">{m.ssh}</code>{m.alias && m.host && m.host !== m.alias ? ` → ${m.user ? `${m.user}@` : ""}${m.host}${m.port && m.port !== 22 ? `:${m.port}` : ""}` : ""}</span>
                <span className="truncate">
                  {m.source === "ssh-config" ? "from ~/.ssh/config" : "added by hand"}
                  {m.identityFile ? ` · key ${m.identityFile}` : ""}
                  {" · "}{STATE[m.status.state].label}{m.status.checkedAt ? ` ${timeAgo(m.status.checkedAt)}` : ""}
                </span>
                {m.status.detail && m.status.state !== "online" && <span className="wrap-anywhere text-amber-700 dark:text-amber-400">{m.status.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
        {edit && (adding ? (
          <MachineForm keys={data!.keys} suggestions={data!.suggestions} taken={data!.machines.map((m) => m.name.toLowerCase())} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); void load() }} />
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}><Plus /> Add machine</Button>
        ))}
        {edit && !!data?.keys.length && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">SSH keys on this server ({data.keys.length})</summary>
            <ul className="mt-1 grid gap-0.5">
              {data.keys.map((k) => <li key={k.path} className="flex min-w-0 items-center gap-1.5 text-xs"><KeyRound className="size-3.5 shrink-0 text-muted-foreground" /><code className="truncate">{k.path}</code><span className="shrink-0 text-muted-foreground">{k.type}</span>{k.comment && <span className="truncate text-muted-foreground">{k.comment}</span>}</li>)}
            </ul>
          </details>
        )}
        {data && !edit && <p className="text-xs text-muted-foreground">Only admins can add, rename or remove machines.</p>}
      </DialogContent>
    </Dialog>
  )
}

const CUSTOM = "__custom"

function MachineForm({ keys, suggestions, taken, onDone, onCancel }: { keys: Keys; suggestions: string[]; taken: string[]; onDone: () => void; onCancel: () => void }) {
  const [host, setHost] = useState("")
  const [user, setUser] = useState("")
  const [port, setPort] = useState("")
  const [name, setName] = useState<string>()
  const [key, setKey] = useState("")
  const [customKey, setCustomKey] = useState("")
  const [saving, setSaving] = useState(false)
  // user@host:port typed in the host box is split into its fields.
  const typedHost = (value: string) => {
    const m = /^(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?$/.exec(value.trim())
    if (m && (m[1] || m[3])) { if (m[1]) setUser(m[1]); if (m[3]) setPort(m[3]); return setHost(m[2]) }
    setHost(value.trim())
  }
  const shown = name ?? defaultName(host)
  const nameError = shown && (!NAME.test(shown) ? "Letters, digits, . - _ (starting with a letter or digit)" : taken.includes(shown.toLowerCase()) ? "That name is taken" : undefined)
  const identityFile = key === CUSTOM ? customKey.trim() : key
  const save = async () => {
    setSaving(true)
    try {
      await api.addRemoteMachine({ name: shown, host, user: user.trim() || undefined, port: port ? Number(port) : undefined, identityFile: identityFile || undefined })
      toast.success(`Added #${shown}`)
      onDone()
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }
  return (
    <form className="grid min-w-0 gap-2 rounded-md border p-2.5" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="grid gap-1">
        <Label htmlFor="rm-host">Host</Label>
        <Input id="rm-host" list="rm-hosts" placeholder="example.org, 10.0.0.5 or user@host:port" value={host} onChange={(e) => typedHost(e.target.value)} autoComplete="off" />
        <datalist id="rm-hosts">{suggestions.map((h) => <option key={h} value={h} />)}</datalist>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <div className="grid gap-1"><Label htmlFor="rm-user">User</Label><Input id="rm-user" placeholder="default" value={user} onChange={(e) => setUser(e.target.value.trim())} autoComplete="off" /></div>
        <div className="grid gap-1"><Label htmlFor="rm-port">Port</Label><Input id="rm-port" type="number" min={1} max={65535} placeholder="22" value={port} onChange={(e) => setPort(e.target.value)} /></div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="rm-key">Key</Label>
        <select id="rm-key" className="w-full min-w-0 rounded-md border bg-background p-2 text-sm" value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">ssh’s default keys and agent</option>
          {keys.map((k) => <option key={k.path} value={k.path}>{k.path} ({k.type}{k.comment ? `, ${k.comment}` : ""})</option>)}
          <option value={CUSTOM}>Another key file…</option>
        </select>
        {key === CUSTOM && <Input placeholder="~/.ssh/id_ed25519_lab" value={customKey} onChange={(e) => setCustomKey(e.target.value)} aria-label="Key file path" />}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="rm-name">Name</Label>
        <div className="flex items-center gap-1"><span className="text-sm text-muted-foreground">#</span><Input id="rm-name" placeholder="name" value={shown} maxLength={40} onChange={(e) => setName(e.target.value.replace(/\s/g, "-"))} /></div>
        {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving || !host || !shown || Boolean(nameError) || (key === CUSTOM && !customKey.trim())}>{saving && <Loader2 className="animate-spin" />} Add</Button>
      </div>
    </form>
  )
}
