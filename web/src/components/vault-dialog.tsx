import { ArrowRightLeft, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, type VaultSecret } from "@/lib/api"
import { useProjects } from "@/lib/projects"

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const PERSONAL = "personal"

/**
 * Secrets in the separately deployed vault: the signed-in person's own, or those shared with a
 * project (everyone who can open it manages them, and its sessions' agents can read them). The
 * agent sees keys and descriptions and reads a value by its key; values are only shown here when asked for.
 */
export function VaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; reachable: boolean }>()
  const [secrets, setSecrets] = useState<VaultSecret[]>()
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  /** The secret being edited, or "new" for the add form. */
  const [editing, setEditing] = useState<VaultSecret | "new">()
  const { projects } = useProjects()
  /** The project whose secrets are shown; undefined for the person's own. */
  const [project, setProject] = useState<string>()
  const scopeName = (id?: string) => (id ? projects.find((p) => p.id === id)?.name ?? "the project" : "Personal")

  const load = (scope = project) =>
    api.vaultSecrets(scope).then(
      ({ secrets }) => setSecrets(secrets),
      (error) => toast.error(error.message),
    )

  useEffect(() => {
    if (!open) return
    setRevealed({})
    setEditing(undefined)
    setSecrets(undefined)
    setProject(undefined)
    api.vaultStatus().then((s) => {
      setStatus(s)
      if (s.configured && s.reachable) void load(undefined)
    }, (error) => toast.error(error.message))
  }, [open])

  const switchTo = (value: string) => {
    const scope = value === PERSONAL ? undefined : value
    setProject(scope)
    setRevealed({})
    setEditing(undefined)
    setSecrets(undefined)
    void load(scope)
  }

  const reveal = async (key: string) => {
    if (revealed[key] !== undefined) return setRevealed((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== key)))
    try {
      const { value } = await api.vaultSecret(key, project)
      setRevealed((r) => ({ ...r, [key]: value }))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const remove = async (key: string) => {
    if (!window.confirm(`Delete the secret ${key}${project ? ` from ${scopeName(project)}` : ""}? Agents can no longer read it.`)) return
    try {
      await api.deleteVaultSecret(key, project)
      toast.success("Secret deleted")
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const move = async (key: string, to?: string) => {
    try {
      await api.moveVaultSecret(key, project, to ?? null)
      toast.success(`Moved ${key} to ${scopeName(to)}`)
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const ready = status?.configured && status.reachable
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Secret vault</DialogTitle>
          <DialogDescription>
            Personal secrets are yours alone. Project secrets are shared with everyone who can open the project, and agents in its sessions can read them. Agents see ordinary secret keys and descriptions and can read their values by key. Reserved server credentials, such as the configured Cloudflare assistance key, are hidden from agent tools. Values an agent reads become part of that session’s history, which everyone it is shared with can see.
          </DialogDescription>
        </DialogHeader>

        {!status && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
        {status && !ready && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              {status.configured
                ? "The vault service is not reachable. Make sure it is running (npm run start:vault) and VAULT_URL points at it."
                : "The vault service is not configured. Set VAULT_TOKEN (and VAULT_URL if it runs elsewhere) in .env, start it with npm run start:vault, and restart Beezy."}
            </span>
          </div>
        )}

        {ready && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="vault-scope">Secrets of</Label>
              <Select value={project ?? PERSONAL} onValueChange={switchTo}>
                <SelectTrigger id="vault-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PERSONAL}>Personal</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      Project: {p.name}
                      {p.general ? " (everyone in this tenant)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {!secrets && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
              {secrets?.length === 0 && editing !== "new" && <p className="text-sm text-muted-foreground">No secrets yet.</p>}
              {secrets?.map((s) =>
                editing !== "new" && editing?.key === s.key ? (
                  <SecretForm key={s.key} secret={s} project={project} onDone={() => { setEditing(undefined); void load() }} onCancel={() => setEditing(undefined)} />
                ) : (
                  <div key={s.key} className="rounded-md border px-2.5 py-2">
                    <div className="flex items-center gap-1">
                      <code className="min-w-0 flex-1 truncate text-sm font-medium">{s.key}</code>
                      <Button variant="ghost" size="icon-sm" onClick={() => void reveal(s.key)} aria-label={revealed[s.key] !== undefined ? `Hide ${s.key}` : `Show ${s.key}`}>
                        {revealed[s.key] !== undefined ? <EyeOff /> : <Eye />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.key}`}>
                        <Pencil />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Move ${s.key}`} title="Move to…">
                            <ArrowRightLeft />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Move to</DropdownMenuLabel>
                          {project && <DropdownMenuItem onSelect={() => void move(s.key)}>Personal</DropdownMenuItem>}
                          {projects
                            .filter((p) => p.id !== project)
                            .map((p) => (
                              <DropdownMenuItem key={p.id} onSelect={() => void move(s.key, p.id)}>
                                Project: {p.name}
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button variant="ghost" size="icon-sm" onClick={() => void remove(s.key)} aria-label={`Delete ${s.key}`}>
                        <Trash2 />
                      </Button>
                    </div>
                    {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                    {revealed[s.key] !== undefined && <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-xs break-all whitespace-pre-wrap">{revealed[s.key]}</pre>}
                  </div>
                ),
              )}
            </div>
            {editing === "new" ? (
              <SecretForm project={project} taken={secrets?.map((s) => s.key) ?? []} onDone={() => { setEditing(undefined); void load() }} onCancel={() => setEditing(undefined)} />
            ) : (
              <Button variant="outline" onClick={() => setEditing("new")}>
                <Plus /> Add {project ? "project" : "personal"} secret
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Add a secret, or change one's description and (optionally) value. */
function SecretForm({ secret, project, taken = [], onDone, onCancel }: { secret?: VaultSecret; project?: string; taken?: string[]; onDone: () => void; onCancel: () => void }) {
  const [key, setKey] = useState(secret?.key ?? "")
  const [value, setValue] = useState("")
  const [description, setDescription] = useState(secret?.description ?? "")
  const [saving, setSaving] = useState(false)
  const keyError = !secret && key && (!KEY.test(key) ? "Letters, digits and _; not starting with a digit" : taken.includes(key) ? "That key already exists" : undefined)
  const canSave = Boolean(key && !keyError && (secret || value))

  const save = async () => {
    setSaving(true)
    try {
      await api.saveVaultSecret(key, { description: description.trim(), ...(value ? { value } : {}) }, project)
      toast.success(secret ? "Secret updated" : "Secret saved")
      onDone()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="grid gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) void save()
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="vault-key">Key</Label>
        <Input id="vault-key" value={key} onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9_]/g, "_"))} placeholder="GITHUB_TOKEN" disabled={Boolean(secret)} autoComplete="off" spellCheck={false} className="font-mono" />
        {keyError && <span className="text-xs text-destructive">{keyError}</span>}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="vault-value">{secret ? "New value (leave empty to keep)" : "Value"}</Label>
        <Input id="vault-value" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" spellCheck={false} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="vault-description">Description for the agent</Label>
        <Textarea id="vault-description" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} placeholder="Personal access token for github.com/acme, repo scope" rows={2} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || saving}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  )
}
