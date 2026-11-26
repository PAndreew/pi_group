import { useLocale } from "@/lib/i18n"
import { ArrowRightLeft, Check, Copy, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react"
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
import { copyText } from "@/lib/clipboard"
import { useProjects } from "@/lib/projects"

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const PERSONAL = "personal"

/**
 * Secrets in the separately deployed vault: the signed-in person's own, or those shared with a
 * project (everyone who can open it manages them, and its sessions' agents can read them). The
 * agent sees keys and descriptions and reads a value by its key; values are only shown here when asked for.
 */
export function VaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t: tr } = useLocale()
  const [status, setStatus] = useState<{ configured: boolean; reachable: boolean }>()
  const [secrets, setSecrets] = useState<VaultSecret[]>()
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string>()
  const copySecret = (key: string, value: string) =>
    void copyText(value).then(
      () => {
        setCopied(key)
        setTimeout(() => setCopied((c) => (c === key ? undefined : c)), 1500)
      },
      (error) => toast.error((error as Error).message),
    )
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
          <DialogTitle>{tr("ui.secret-vault-9ab269")}</DialogTitle>
          <DialogDescription>
            {tr("ui.personal-secrets-are-yours-alone-pr-731104")}
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
              <Label htmlFor="vault-scope">{tr("ui.secrets-of-8ea9bb")}</Label>
              <Select value={project ?? PERSONAL} onValueChange={switchTo}>
                <SelectTrigger id="vault-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PERSONAL}>{tr("ui.personal-40f073")}</SelectItem>
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
              {secrets?.length === 0 && editing !== "new" && <p className="text-sm text-muted-foreground">{tr("ui.no-secrets-yet-c3d50e")}</p>}
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
                          <Button variant="ghost" size="icon-sm" aria-label={`Move ${s.key}`} title={tr("ui.move-to-c0a3ef")}>
                            <ArrowRightLeft />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>{tr("ui.move-to-349f80")}</DropdownMenuLabel>
                          {project && <DropdownMenuItem onSelect={() => void move(s.key)}>{tr("ui.personal-40f073")}</DropdownMenuItem>}
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
                    {revealed[s.key] !== undefined && (
                      <div className="mt-1 flex items-start gap-1">
                        <pre className="max-h-32 min-w-0 flex-1 overflow-auto rounded bg-muted p-1.5 text-xs break-all whitespace-pre-wrap">{revealed[s.key]}</pre>
                        <Button variant="ghost" size="icon-sm" onClick={() => copySecret(s.key, revealed[s.key])} aria-label={`Copy ${s.key}`} title={tr("ui.copy-af74f7")}>
                          {copied === s.key ? <Check className="text-green-600" /> : <Copy />}
                        </Button>
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
            {editing === "new" ? (
              <SecretForm project={project} taken={secrets?.map((s) => s.key) ?? []} onDone={() => { setEditing(undefined); void load() }} onCancel={() => setEditing(undefined)} />
            ) : (
              <Button variant="outline" onClick={() => setEditing("new")}>
                <Plus /> {tr("ui.add-61cc55")} {project ? "project" : "personal"} {tr("ui.secret-e5e9fa")}
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
  const { t: tr } = useLocale()
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
        <Label htmlFor="vault-key">{tr("ui.key-c67dd2")}</Label>
        <Input id="vault-key" value={key} onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9_]/g, "_"))} placeholder="GITHUB_TOKEN" disabled={Boolean(secret)} autoComplete="off" spellCheck={false} className="font-mono" />
        {keyError && <span className="text-xs text-destructive">{keyError}</span>}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="vault-value">{secret ? "New value (leave empty to keep)" : "Value"}</Label>
        <Input id="vault-value" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="new-password" spellCheck={false} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="vault-description">{tr("ui.description-for-the-agent-09cec3")}</Label>
        <Textarea id="vault-description" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} placeholder={tr("ui.personal-access-token-for-github-co-92321c")} rows={2} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tr("ui.cancel-77dfd2")}
        </Button>
        <Button type="submit" disabled={!canSave || saving}>
          {saving && <Loader2 className="animate-spin" />} {tr("ui.save-efc007")}
        </Button>
      </div>
    </form>
  )
}
