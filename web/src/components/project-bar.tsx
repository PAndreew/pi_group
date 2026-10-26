import { Folder, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
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
function FolderSuggestions({ query, onPick }: { query: string; onPick: (folder: string) => void }) {
  const [folders, setFolders] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => api.searchFolders(query).then((r) => alive && setFolders(r.folders.slice(0, 6)), () => {}), 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])
  const shown = folders.filter((f) => f !== query)
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

/** A new project, or `project`'s name and folder. A new one gets a new folder named after it unless one is picked. */
function ProjectDialog({ project, open, onOpenChange }: { project?: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { reload, setActive } = useProjects()
  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [picked, setPicked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? "")
    setFolder(project?.folder ?? "")
    setPicked(Boolean(project))
  }, [open, project])

  const target = picked ? folder : `projects/${slug(name)}`
  const pick = (value: string) => {
    setPicked(true)
    setFolder(value)
  }
  const save = async () => {
    setBusy(true)
    try {
      if (project) await api.updateProject(project.id, { name, folder: target })
      else setActive((await api.createProject({ name, folder: target, create: !picked })).project.id)
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
          <DialogDescription>Sessions and chats are grouped by project. New ones start in its folder or a subfolder; moved ones keep the folder they work in.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Holiday, school project, my app…" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-folder">Folder</Label>
            <Input id="project-folder" value={target} onChange={(e) => pick(e.target.value)} className="font-mono text-sm" />
            <FolderSuggestions query={picked ? folder : name} onPick={pick} />
            <p className="text-[11px] text-muted-foreground">{picked ? "An existing folder, e.g. a git repo. Sessions already working in it join the project." : "A new folder; type or pick an existing one (a git repo, say) instead."}</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim() || !target.trim() || target === "projects/"}>
              {busy && <Loader2 className="animate-spin" />} {project ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The secondary navbar: General, every other project, then +. The active project's menu edits or deletes it. */
export function ProjectBar({ className, onSelect }: { className?: string; onSelect?: () => void }) {
  const { projects, active, setActive, reload } = useProjects()
  const [editing, setEditing] = useState<Project>()
  const [creating, setCreating] = useState(false)
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
            {selected && project.canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="-ml-1 size-6" aria-label={`${project.name} menu`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">/{project.folder}</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => setEditing(project)}>
                    <Pencil /> Rename or change folder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(project)}>
                    <Trash2 /> Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}
      <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => setCreating(true)} aria-label="New project" title="New project">
        <Plus />
      </Button>
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
