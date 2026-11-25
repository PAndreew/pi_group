import { useLocale } from "@/lib/i18n"
import { Check, Folder, FolderKanban, Link2, Loader2, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, type Project } from "@/lib/api"
import { useProjects } from "@/lib/projects"
import { cn } from "@/lib/utils"

const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

/** Existing folders matching what is typed, to pick one (a git repo, say) as the project's folder. */
function FolderSuggestions({ query, exclude = [], onPick }: { query: string; exclude?: string[]; onPick: (folder: string) => void }) {
  const [folders, setFolders] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => api.searchFolders(query).then((r) => alive && setFolders(r.folders.slice(0, 6)), () => {}), 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])
  const shown = folders.filter((f) => f !== query && !exclude.includes(f))
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <button key={f} type="button" onClick={() => onPick(f)} className="flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          <Folder className="size-3 shrink-0" />
          <span className="truncate">/{f}</span>
        </button>
      ))}
    </div>
  )
}

/** A new project (it gets a new folder of its own), or `project`'s name; either way, the existing folders linked to it. */
function ProjectDialog({ project, open, onOpenChange }: { project?: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t: tr } = useLocale()
  const { reload, setActive } = useProjects()
  const [name, setName] = useState("")
  const [links, setLinks] = useState<string[]>([])
  const [adding, setAdding] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? "")
    setLinks(project?.links ?? [])
    setAdding("")
  }, [open, project])

  const link = (folder: string) => {
    const clean = folder.trim().replace(/^\/+|\/+$/g, "")
    if (clean && !links.includes(clean)) setLinks([...links, clean])
    setAdding("")
  }
  const save = async () => {
    setBusy(true)
    try {
      const all = adding.trim() ? [...new Set([...links, adding.trim().replace(/^\/+|\/+$/g, "")])] : links
      if (project) await api.updateProject(project.id, { name, links: all })
      else setActive((await api.createProject({ name, links: all })).project.id)
      reload()
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{project ? "Project settings" : "New project"}</DialogTitle>
          <DialogDescription>{tr("ui.sessions-and-chats-are-grouped-by-p-3f040e")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">{tr("ui.name-709a23")}</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("ui.holiday-school-project-my-app-0c19bc")} autoFocus={!project} />
            <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              <Folder className="size-3 shrink-0" />
              <span className="truncate">{project ? `/${project.folder}` : `New folder: /projects/${slug(name) || "…"}`}</span>
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-link">{tr("ui.linked-folders-8f50b6")}</Label>
            {links.length > 0 && (
              <ul className="grid gap-1">
                {links.map((l) => (
                  <li key={l} className="flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">/{l}</span>
                    <Button type="button" variant="ghost" size="icon-sm" className="size-6" onClick={() => setLinks(links.filter((x) => x !== l))} aria-label={`Unlink /${l}`}>
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                id="project-link"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !adding.trim()) return
                  e.preventDefault()
                  link(adding)
                }}
                placeholder={tr("ui.search-folders-e-g-a-git-repo-c1d172")}
                className="font-mono text-sm"
              />
              <Button type="button" variant="outline" disabled={!adding.trim()} onClick={() => link(adding)}>
                {tr("ui.link-d05170")}
              </Button>
            </div>
            <FolderSuggestions query={adding} exclude={[...links, ...(project ? [project.folder] : [])]} onPick={link} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />} {project ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ShareProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t: tr } = useLocale()
  const { reload } = useProjects()
  const [users, setUsers] = useState<{ id: string; username: string }[]>([])
  const [members, setMembers] = useState(project.memberIds)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void api.directory().then(r => setUsers(r.users), error => toast.error(error.message)) }, [])
  const save = async () => {
    setBusy(true)
    try {
      await api.shareProject(project.id, members)
      reload()
      onClose()
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{tr("ui.share-project-with-ca3c69")}</DialogTitle>
        <DialogDescription>{tr("project.shareDescription", { name: project.name })}{project.openToTenant && ` ${tr("project.legacySharing")}`}</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-64 gap-2 overflow-y-auto">
        {users.map(user => <label key={user.id} className="flex items-center gap-2">
          <input type="checkbox" checked={members.includes(user.id)} onChange={e => setMembers(e.target.checked ? [...members, user.id] : members.filter(id => id !== user.id))} />
          {user.username}
        </label>)}
      </div>
      <DialogFooter><Button disabled={busy} onClick={() => void save()}>{tr("ui.save-sharing-2bc976")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

/**
 * The projects in the top bar: the two most recently opened ones, then … with every project, a new
 * one, the chat search (`onSearch`), and the active project's sharing, rename and delete.
 */
export function ProjectSwitcher({ className, onSelect, onSearch }: { className?: string; onSelect?: () => void; onSearch?: () => void }) {
  const { t: tr } = useLocale()
  const { projects, active, setActive, reload } = useProjects()
  const [editing, setEditing] = useState<Project>()
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState<Project>()
  const [confirmDelete, setConfirmDelete] = useState<Project>()
  // Opening the search must not hand focus back to the trigger, or the empty search would close on blur.
  const searching = useRef(false)
  const select = (project: Project) => {
    setActive(project.id)
    onSelect?.()
  }

  const remove = async (project: Project) => {
    try {
      await api.deleteProject(project.id)
      setActive(projects.find((p) => p.general)!.id)
      reload()
    } catch (error) {
      toast.error((error as Error).message)
    }
    setConfirmDelete(undefined)
  }

  return (
    <nav className={cn("flex min-w-0 items-center gap-0.5", className)} aria-label={tr("ui.projects-53e890")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 max-w-full text-sm font-normal [&_svg]:size-4" aria-label={`Switch project: ${active?.name ?? "Projects"}`} title={tr("ui.switch-project-6bb114")}>
            <FolderKanban className="shrink-0" />
            <span className="shrink-0">Project:</span>
            <span className="truncate">{active?.name ?? "Projects"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[70dvh] w-60 overflow-y-auto"
          onCloseAutoFocus={(e) => {
            if (!searching.current) return
            searching.current = false
            e.preventDefault()
          }}
        >
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr("ui.projects-53e890")}</DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => select(project)} title={`/${project.folder}`}>
              {project.id === active?.id ? <Check /> : <Folder />}
              <span className="truncate">{project.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus /> {tr("ui.new-project-e5bcbe")}
          </DropdownMenuItem>
          {active && (onSearch || active.canManage) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{active.name} · /{active.folder}</DropdownMenuLabel>
            </>
          )}
          {onSearch && (
            <DropdownMenuItem
              onSelect={() => {
                searching.current = true
                onSearch()
              }}
            >
              <Search /> {tr("ui.search-chats-9ad51d")}
            </DropdownMenuItem>
          )}
          {active?.canManage && (
            <>
              <DropdownMenuItem onSelect={() => setSharing(active)}>
                <Users /> {tr("ui.share-project-with-ca3c69")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(active)}>
                <Pencil /> {tr("ui.rename-or-link-folders-f732b9")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(active)}>
                <Trash2 /> {tr("ui.delete-project-af1456")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {sharing && <ShareProjectDialog project={sharing} onClose={() => setSharing(undefined)} />}
      <ProjectDialog open={creating} onOpenChange={setCreating} />
      <ProjectDialog project={editing} open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(undefined)} />
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tr("project.deleteTitle", { name: confirmDelete?.name ?? "" })}</DialogTitle>
            <DialogDescription>{tr("ui.its-sessions-and-chats-go-back-to-g-d5f80a")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={() => confirmDelete && void remove(confirmDelete)}>
              {tr("ui.delete-project-af1456")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}
