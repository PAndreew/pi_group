import { ProjectCapabilities } from "@/components/project-capabilities"
import { Folder, Link2, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"
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
          <DialogDescription>Sessions and chats are grouped by project. New ones and everything uploaded go to its own folder; linked folders bring the sessions working in them along.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Holiday, school project, my app…" autoFocus={!project} />
            <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              <Folder className="size-3 shrink-0" />
              <span className="truncate">{project ? `/${project.folder}` : `New folder: /projects/${slug(name) || "…"}`}</span>
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-link">Linked folders</Label>
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
                placeholder="Search folders, e.g. a git repo"
                className="font-mono text-sm"
              />
              <Button type="button" variant="outline" disabled={!adding.trim()} onClick={() => link(adding)}>
                Link
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
        <DialogTitle>Share project with…</DialogTitle>
        <DialogDescription>Share “{project.name}” and its linked folders. No sessions are shared automatically, including earlier sessions. Share conversations separately from their session menu.</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-64 gap-2 overflow-y-auto">
        {users.map(user => <label key={user.id} className="flex items-center gap-2">
          <input type="checkbox" checked={members.includes(user.id)} onChange={e => setMembers(e.target.checked ? [...members, user.id] : members.filter(id => id !== user.id))} />
          {user.username}
        </label>)}
      </div>
      <DialogFooter><Button disabled={busy} onClick={() => void save()}>Save sharing</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

/** The secondary navbar: General, every other project, then +. The active project's menu edits or deletes it. */
export function ProjectBar({ className, onSelect }: { className?: string; onSelect?: () => void }) {
  const { projects, active, setActive, reload } = useProjects()
  const [editing, setEditing] = useState<Project>()
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState<Project>()
  const [tools, setTools] = useState<Project>()
  const [confirmDelete, setConfirmDelete] = useState<Project>()

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
    <nav className={cn("flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 sm:px-3", className)} aria-label="Projects">
      {projects.map((project) => {
        const selected = project.id === active?.id
        return (
          <div key={project.id} className={cn("flex shrink-0 items-center rounded-md", selected && "bg-accent")}>
            <button
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => {
                setActive(project.id)
                onSelect?.()
              }}
              title={`/${project.folder}`}
              className={cn("max-w-48 truncate rounded-md px-2.5 py-1 text-sm", selected ? "font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {project.name}
            </button>
            {selected && (project.canManage || project.canManageTools) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="-ml-1 size-6" aria-label={`${project.name} menu`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">/{project.folder}</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => setTools(project)}>Tools & connections</DropdownMenuItem>
                  {project.canManage && <>
                  <DropdownMenuItem onSelect={() => setSharing(project)}>
                    Share project with…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditing(project)}>
                    <Pencil /> Rename or link folders
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(project)}>
                    <Trash2 /> Delete project
                  </DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}
      <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setCreating(true)} aria-label="New project" title="New project">
        <Plus />
      </Button>
      {tools && <ProjectCapabilities project={tools} onClose={() => setTools(undefined)} />}
      {sharing && <ShareProjectDialog project={sharing} onClose={() => setSharing(undefined)} />}
      <ProjectDialog open={creating} onOpenChange={setCreating} />
      <ProjectDialog project={editing} open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(undefined)} />
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>Its sessions and chats go back to General, or to the project holding their folder. No files or conversations are deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={() => confirmDelete && void remove(confirmDelete)}>
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}
