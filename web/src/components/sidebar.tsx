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
  Upload,
  Users,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

function SessionList({
  folder,
  selected,
  onOpen,
  onNew,
  version,
}: {
  folder: string
  selected?: string
  onOpen: (key: string) => void
  onNew: () => void
  version: number
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .sessions(folder)
      .then(({ sessions }) => setSessions(sessions))
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [folder])

  useEffect(() => {
    setSessions(undefined)
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [load, version])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-2 px-3 pb-2">
        <Button className="flex-1" size="sm" onClick={onNew}>
          <Plus /> New session
        </Button>
        <Button variant="outline" size="icon-sm" onClick={load} aria-label="Refresh sessions">
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!sessions && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        {sessions?.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No sessions in this folder yet.</p>}
        {sessions?.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onOpen(s.key)}
            className={cn("flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left hover:bg-accent", selected === s.key && "bg-accent")}
          >
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
        ))}
      </div>
    </div>
  )
}

function FileList({ folder, selected, onFolder, onFile }: { folder: string; selected?: string; onFolder: (p: string) => void; onFile: (p: string) => void }) {
  const [entries, setEntries] = useState<FsEntry[]>()
  const [hidden, setHidden] = useState(() => localStorage.getItem("pi-group:hidden") === "1")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api
      .list(folder)
      .then(({ entries }) => setEntries(entries))
      .catch((error) => {
        toast.error(error.message)
        setEntries([])
      })
  }, [folder])

  useEffect(() => {
    setEntries(undefined)
    load()
  }, [load])

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

  const visible = entries?.filter((e) => hidden || !e.name.startsWith("."))
  const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : ""

  return (
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
        <Button size="sm" variant="outline" className="flex-1" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
        </Button>
        <Button size="icon-sm" variant="outline" onClick={mkdir} aria-label="New folder">
          <FolderPlus />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => {
            setHidden((h) => !h)
            localStorage.setItem("pi-group:hidden", hidden ? "0" : "1")
          }}
          aria-label="Toggle hidden files"
        >
          {hidden ? <Eye /> : <EyeOff />}
        </Button>
        <Button size="icon-sm" variant="outline" onClick={load} aria-label="Refresh files">
          <RefreshCw />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {folder && (
          <button type="button" onClick={() => onFolder(parent)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent">
            <CornerLeftUp className="size-4" /> ..
          </button>
        )}
        {!visible && <Loader2 className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />}
        {visible?.map((e) => (
          <div key={e.path} className={cn("group flex items-center rounded-md hover:bg-accent", selected === e.path && "bg-accent")}>
            <button
              type="button"
              onClick={() => (e.type === "dir" ? onFolder(e.path) : onFile(e.path))}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
            >
              <FileIcon entry={e} />
              <span className={cn("min-w-0 flex-1 truncate", e.name.startsWith(".") && "text-muted-foreground")}>{e.name}</span>
              {e.type === "file" && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatBytes(e.size)}</span>}
            </button>
            {e.type === "file" && (
              <a href={api.downloadUrl(e.path)} className="p-2 text-muted-foreground hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100" aria-label={`Download ${e.name}`}>
                <Download className="size-4" />
              </a>
            )}
          </div>
        ))}
        {visible?.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Empty folder. Drop files here to upload.</p>}
      </div>
    </div>
  )
}

export function Sidebar(props: {
  rootName: string
  folder: string
  tab: string
  onTab: (tab: string) => void
  selectedSession?: string
  selectedFile?: string
  onFolder: (path: string) => void
  onSession: (key: string) => void
  onFile: (path: string) => void
  onNewSession: () => void
  version: number
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3 pb-2">
        <Breadcrumb rootName={props.rootName} folder={props.folder} onFolder={props.onFolder} />
      </div>
      <Tabs value={props.tab} onValueChange={props.onTab} className="min-h-0 flex-1 gap-2">
        <TabsList className="mx-3 w-[calc(100%-1.5rem)]">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions" className="flex min-h-0 flex-col">
          <SessionList folder={props.folder} selected={props.selectedSession} onOpen={props.onSession} onNew={props.onNewSession} version={props.version} />
        </TabsContent>
        <TabsContent value="files" className="flex min-h-0 flex-col">
          <FileList folder={props.folder} selected={props.selectedFile} onFolder={props.onFolder} onFile={props.onFile} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
