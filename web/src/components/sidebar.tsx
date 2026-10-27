import {
  ChevronRight,
  CornerLeftUp,
  Download,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Lock,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Users,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { canDelete, DeleteSessionDialog } from "@/components/delete-session-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api, type FsEntry, type SessionSummary } from "@/lib/api"
import { cn, formatBytes, timeAgo } from "@/lib/utils"

const CODE_EXT = ["py", "js", "ts", "tsx", "jsx", "json", "sh", "rs", "go", "c", "cpp", "h", "java", "rb", "php", "css", "html", "yml", "yaml", "toml", "sql"]
const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]

function FileIcon({ entry }: { entry: FsEntry }) {
  if (entry.type === "dir") return <Folder className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? ""
  if (IMG_EXT.includes(ext)) return <FileImage className="size-4 shrink-0 text-muted-foreground" />
  if (CODE_EXT.includes(ext)) return <FileCode className="size-4 shrink-0 text-muted-foreground" />
  if (["md", "txt", "pdf", "csv"].includes(ext)) return <FileText className="size-4 shrink-0 text-muted-foreground" />
  return <File className="size-4 shrink-0 text-muted-foreground" />
}

export function Breadcrumb({ rootName, folder, onFolder }: { rootName: string; folder: string; onFolder: (path: string) => void }) {
  const parts = folder ? folder.split("/") : []
  return (
    <div className="scrollbar-thin flex items-center gap-0.5 overflow-x-auto text-sm whitespace-nowrap">
      <button type="button" className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent" onClick={() => onFolder("")} title={rootName}>
        <Home className="size-3.5" />
      </button>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5">
          <ChevronRight className="size-3 text-muted-foreground" />
          <button type="button" className={cn("rounded px-1 py-0.5 hover:bg-accent", i === parts.length - 1 && "font-medium")} onClick={() => onFolder(parts.slice(0, i + 1).join("/"))}>
            {part}
          </button>
        </span>
      ))}
    </div>
  )
}

type Count = { total: number; running: number }

function SessionRow({ s, selected, onOpen, onDelete, indent }: { s: SessionSummary; selected?: string; onOpen: (key: string) => void; onDelete: (s: SessionSummary) => void; indent?: boolean }) {
  return (
    <div className={cn("flex items-center rounded-md hover:bg-accent", selected === s.key && "bg-accent", indent && "ml-6")}>
      <button type="button" onClick={() => onOpen(s.key)} className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left">
        <div className="flex items-center gap-1.5">
          <span className={cn("size-2 shrink-0 rounded-full", s.running ? "animate-pulse bg-green-500" : s.live ? "bg-sky-500" : "bg-muted-foreground/30")} />
          <span className="min-w-0 flex-1 truncate text-sm">{s.name || s.firstMessage || "Untitled session"}</span>
          {s.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
          {s.visibility === "shared" ? <Users className="size-3 shrink-0 text-muted-foreground" /> : <Lock className="size-3 shrink-0 text-muted-foreground/60" />}
        </div>
        <div className="flex items-center gap-1.5 pl-3.5 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="px-1 py-0 text-[10px]">
            {s.harness}
          </Badge>
          <span>{timeAgo(s.updatedAt)}</span>
          {s.messageCount > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageSquare className="size-3" />
              {s.messageCount}
            </span>
          )}
          {s.owner && s.access !== "owner" && <span className="truncate">· {s.owner}</span>}
          {!s.owner && <span className="text-amber-600">· unclaimed</span>}
          {s.access === "read" && <span>· view only</span>}
        </div>
      </button>
      {canDelete(s) && (
        <button
          type="button"
          onClick={() => onDelete(s)}
          className="shrink-0 self-stretch rounded-md px-2.5 text-red-500/80 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
          aria-label={`Delete ${s.name || s.firstMessage || "session"}`}
          title="Delete session"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  )
}

/** Sessions of one folder, fetched when its accordion opens and refreshed with the explorer. */
function FolderSessions({ path, selected, onOpen, onDelete, refresh, indent }: { path: string; selected?: string; onOpen: (key: string) => void; onDelete: (s: SessionSummary) => void; refresh: number; indent?: boolean }) {
  const [sessions, setSessions] = useState<SessionSummary[]>()
  useEffect(() => {
    api.sessions(path).then(({ sessions }) => setSessions(sessions), (error) => toast.error(error.message))
  }, [path, refresh])
  if (!sessions) return <Loader2 className={cn("my-1 size-3.5 animate-spin text-muted-foreground", indent ? "ml-9" : "ml-3")} />
  return (
    <div className="grid">
      {sessions.map((s) => (
        <SessionRow key={s.key} s={s} selected={selected} onOpen={onOpen} onDelete={onDelete} indent={indent} />
      ))}
    </div>
  )
}

function CountBadge({ count }: { count?: Count }) {
  if (!count) return null
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums"
      title={`${count.total} session${count.total === 1 ? "" : "s"}${count.running ? `, ${count.running} running` : ""}`}
    >
      {count.running > 0 && <span className="size-1.5 animate-pulse rounded-full bg-green-500" />}
      <MessageSquare className="size-2.5" />
      {count.total}
    </span>
  )
}

/**
 * The file explorer is the only navigation: open folders, start a session in the current one, and
 * unfold any folder that has sessions to open them in place.
 */
export function Sidebar({
  rootName,
  folder,
  selectedSession,
  selectedFile,
  onFolder,
  onSession,
  onFile,
  onNewSession,
  onSessionDeleted,
  creating,
  version,
}: {
  rootName: string
  folder: string
  selectedSession?: string
  selectedFile?: string
  onFolder: (path: string) => void
  onSession: (key: string) => void
  onFile: (path: string) => void
  onNewSession: () => void
  onSessionDeleted: (key: string) => void
  creating?: boolean
  version: number
}) {
  const [entries, setEntries] = useState<FsEntry[]>()
  const [counts, setCounts] = useState<Record<string, Count>>({})
  const [here, setHere] = useState<Count>()
  // Closed at first: people usually look at the folder's content before its sessions.
  const [hereOpen, setHereOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [hidden, setHidden] = useState(() => localStorage.getItem("pi-group:hidden") === "1")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<SessionSummary>()
  const [refresh, setRefresh] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api
      .list(folder)
      .then(({ entries }) => setEntries(entries))
      .catch((error) => {
        toast.error(error.message)
        setEntries([])
      })
    api.sessionCounts(folder).then(({ counts }) => setCounts(counts), () => {})
    api.sessions(folder).then(({ sessions }) => setHere(sessions.length ? { total: sessions.length, running: sessions.filter((s) => s.running).length } : undefined), () => {})
    setRefresh((r) => r + 1)
  }, [folder])

  // A new folder starts collapsed and empty instead of showing the previous one's rows.
  useEffect(() => {
    setEntries(undefined)
    setCounts({})
    setHere(undefined)
    setHereOpen(false)
    setExpanded(new Set())
  }, [folder])

  useEffect(() => {
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [load, version])

  const upload = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const { files: done } = await api.upload(folder, files)
      toast.success(`Uploaded ${done.length} file${done.length === 1 ? "" : "s"}`)
      load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const mkdir = async () => {
    const name = window.prompt("New folder name")?.trim()
    if (!name) return
    try {
      await api.mkdir(folder ? `${folder}/${name}` : name)
      load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const visible = entries?.filter((e) => hidden || !e.name.startsWith("."))
  const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : ""

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3 pb-2">
        <Breadcrumb rootName={rootName} folder={folder} onFolder={onFolder} />
      </div>
      <div
        className={cn("flex min-h-0 flex-1 flex-col", dragging && "bg-accent/50")}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(Array.from(e.dataTransfer.files))
        }}
      >
        <div className="flex gap-1.5 px-3 pb-2">
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []))
              e.target.value = ""
            }}
          />
          <Button size="sm" className="min-w-0 flex-1 lg:h-7 lg:text-xs" disabled={creating} onClick={onNewSession}>
            {creating ? <Loader2 className="animate-spin" /> : <Plus />} New session
          </Button>
          <Button size="icon-sm" variant="outline" className="lg:size-7 lg:[&_svg]:size-3.5" onClick={() => input.current?.click()} disabled={busy} aria-label="Upload files" title="Upload files">
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          </Button>
          <Button size="icon-sm" variant="outline" className="lg:size-7 lg:[&_svg]:size-3.5" onClick={mkdir} aria-label="New folder" title="New folder">
            <FolderPlus />
          </Button>
          <Button
            size="icon-sm"
            variant="outline" className="lg:size-7 lg:[&_svg]:size-3.5"
            onClick={() => {
              setHidden((h) => !h)
              localStorage.setItem("pi-group:hidden", hidden ? "0" : "1")
            }}
            aria-label="Toggle hidden files"
            title={hidden ? "Hide hidden files" : "Show hidden files"}
          >
            {hidden ? <Eye /> : <EyeOff />}
          </Button>
          <Button size="icon-sm" variant="outline" className="lg:size-7 lg:[&_svg]:size-3.5" onClick={load} aria-label="Refresh" title="Refresh">
            <RefreshCw />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {here && (
            <div className="mb-1 border-b pb-1">
              <button type="button" onClick={() => setHereOpen((o) => !o)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent" aria-expanded={hereOpen}>
                <ChevronRight className={cn("size-3.5 transition-transform", hereOpen && "rotate-90")} />
                <span className="flex-1 text-left">Sessions in this folder</span>
                <CountBadge count={here} />
              </button>
              {hereOpen && <FolderSessions path={folder} selected={selectedSession} onOpen={onSession} onDelete={setDeleting} refresh={refresh + version} />}
            </div>
          )}
          {folder && (
            <button type="button" onClick={() => onFolder(parent)} className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-sm text-muted-foreground hover:bg-accent">
              <CornerLeftUp className="size-4" /> ..
            </button>
          )}
          {!visible && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
          {visible?.map((e) => {
            const count = e.type === "dir" ? counts[e.path] : undefined
            const open = Boolean(count) && expanded.has(e.path)
            return (
              <div key={e.path}>
                <div className={cn("group flex items-center rounded-md hover:bg-accent", selectedFile === e.path && "bg-accent")}>
                  {count ? (
                    <button
                      type="button"
                      onClick={() => toggle(e.path)}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                      aria-expanded={open}
                      aria-label={`${open ? "Hide" : "Show"} sessions in ${e.name}`}
                    >
                      <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                    </button>
                  ) : (
                    <span className="w-7 shrink-0" />
                  )}
                  <button type="button" onClick={() => (e.type === "dir" ? onFolder(e.path) : onFile(e.path))} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm">
                    <FileIcon entry={e} />
                    <span className={cn("min-w-0 flex-1 truncate", e.name.startsWith(".") && "text-muted-foreground")}>{e.name}</span>
                    {e.type === "dir" && <CountBadge count={count} />}
                    {e.type === "file" && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatBytes(e.size)}</span>}
                  </button>
                  {e.type === "file" && (
                    <a href={api.downloadUrl(e.path)} className="p-2 text-muted-foreground hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100" aria-label={`Download ${e.name}`}>
                      <Download className="size-4" />
                    </a>
                  )}
                </div>
                {open && <FolderSessions path={e.path} selected={selectedSession} onOpen={onSession} onDelete={setDeleting} refresh={refresh + version} indent />}
              </div>
            )
          })}
          {visible?.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Empty folder. Drop files here to upload.</p>}
        </div>
      </div>
      <DeleteSessionDialog
        session={deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        onDeleted={(key) => {
          load()
          onSessionDeleted(key)
        }}
      />
    </div>
  )
}
