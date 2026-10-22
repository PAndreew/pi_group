import { Code, Download, Eye, FileQuestion, Loader2, Pencil, Save, X } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { CodeBlock, languageFor } from "@/components/code-block"
import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { formatBytes } from "@/lib/utils"

const PdfViewer = lazy(() => import("./pdf-viewer"))

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]
const VIDEO = ["mp4", "webm", "mov"]
const AUDIO = ["mp3", "wav", "ogg", "m4a", "flac"]
const MAX_TEXT = 3 * 1024 * 1024

type Kind = "image" | "video" | "audio" | "pdf" | "html" | "markdown" | "csv" | "text"

function kindOf(path: string): Kind {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (IMAGE.includes(ext)) return "image"
  if (VIDEO.includes(ext)) return "video"
  if (AUDIO.includes(ext)) return "audio"
  if (ext === "pdf") return "pdf"
  if (ext === "html" || ext === "htm") return "html"
  if (ext === "md" || ext === "markdown" || ext === "mdx") return "markdown"
  if (ext === "csv" || ext === "tsv") return "csv"
  return "text"
}

/** Minimal CSV parser with quoted fields; enough for previews. */
function parseCsv(text: string, sep: string, maxRows = 500) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

function useText(path: string, enabled: boolean) {
  const [state, setState] = useState<{ text?: string; mtime?: number; error?: string; binary?: boolean; tooBig?: number }>({})
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setState({})
    ;(async () => {
      try {
        const info = await api.stat(path)
        if (info.size > MAX_TEXT) return !cancelled && setState({ tooBig: info.size })
        const res = await fetch(api.rawUrl(path), { credentials: "same-origin" })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
        const buffer = await res.arrayBuffer()
        const bytes = new Uint8Array(buffer.slice(0, 8000))
        if (bytes.includes(0)) return !cancelled && setState({ binary: true })
        if (!cancelled) setState({ text: new TextDecoder().decode(buffer), mtime: info.mtime })
      } catch (error) {
        if (!cancelled) setState({ error: (error as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, enabled])
  return [state, setState] as const
}

/**
 * Plain-text editor for source, config and .env files. Saving sends the modification time the file
 * was loaded with, so a newer version on disk (another person, the agent) is never overwritten blindly.
 */
function TextEditor({ path, text, mtime, onSaved, onClose }: { path: string; text: string; mtime?: number; onSaved: (text: string, mtime: number) => void; onClose: () => void }) {
  // Textareas work in \n; files written with \r\n keep their line endings.
  const crlf = text.includes("\r\n")
  const original = crlf ? text.replace(/\r\n/g, "\n") : text
  const [draft, setDraft] = useState(original)
  const [saving, setSaving] = useState(false)
  const dirty = draft !== original
  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const content = crlf ? draft.replace(/\n/g, "\r\n") : draft
      const saved = await api.saveText(path, content, mtime)
      onSaved(content, saved.mtime)
      toast.success("Saved")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const close = () => (!dirty || window.confirm("Discard your unsaved changes?")) && onClose()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex-1">{dirty ? "Unsaved changes" : "No changes"} · Ctrl+S saves</span>
        <Button variant="ghost" size="sm" onClick={close}>
          <X /> Close
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault()
            void save()
          } else if (e.key === "Escape") close()
          else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault()
            const el = e.currentTarget
            const { selectionStart: start, selectionEnd: end } = el
            setDraft(`${draft.slice(0, start)}\t${draft.slice(end)}`)
            requestAnimationFrame(() => el.setSelectionRange(start + 1, start + 1))
          }
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`Edit ${path}`}
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none [tab-size:4]"
      />
    </div>
  )
}

export function FileViewer({ path }: { path: string }) {
  const kind = kindOf(path)
  const needsText = kind === "html" || kind === "markdown" || kind === "csv" || kind === "text"
  const [{ text, mtime, error, binary, tooBig }, setLoaded] = useText(path, needsText)
  const [source, setSource] = useState(false)
  const [editing, setEditing] = useState(false)
  const name = path.split("/").pop() ?? path
  const url = api.rawUrl(path)
  const rows = useMemo(() => (kind === "csv" && text ? parseCsv(text, path.toLowerCase().endsWith(".tsv") ? "\t" : ",") : []), [kind, text, path])
  useEffect(() => {
    setSource(false)
    setEditing(false)
  }, [path])

  const canToggle = (kind === "html" || kind === "markdown" || kind === "csv") && text !== undefined

  let body: React.ReactNode
  if (kind === "image") body = <img src={url} alt={name} className="mx-auto max-h-full max-w-full object-contain" />
  else if (kind === "video") body = <video src={url} controls playsInline className="mx-auto max-h-full max-w-full" />
  else if (kind === "audio") body = <audio src={url} controls className="mx-auto mt-8 w-full max-w-md" />
  else if (kind === "pdf")
    body = (
      <Suspense fallback={<Loader2 className="mx-auto mt-10 animate-spin" />}>
        <PdfViewer url={url} />
      </Suspense>
    )
  else if (error) body = <p className="p-4 text-sm text-destructive">{error}</p>
  else if (binary || tooBig)
    body = (
      <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">
        <FileQuestion className="size-10" />
        {tooBig ? `This file is too large to preview (${formatBytes(tooBig)}).` : "No preview for this file type."}
        <Button asChild variant="outline">
          <a href={api.downloadUrl(path)}>
            <Download /> Download
          </a>
        </Button>
      </div>
    )
  else if (text === undefined) body = <Loader2 className="mx-auto mt-10 animate-spin" />
  else if (editing)
    body = <TextEditor path={path} text={text} mtime={mtime} onSaved={(saved, at) => setLoaded({ text: saved, mtime: at })} onClose={() => setEditing(false)} />
  else if (source || kind === "text") body = <CodeBlock code={text} language={source && kind === "html" ? "xml" : languageFor(path)} className="min-h-full rounded-none bg-transparent" />
  else if (kind === "markdown") body = <Markdown text={text} className="mx-auto max-w-3xl p-4 sm:p-6" />
  else if (kind === "html")
    // Opaque origin: scripts may run for interactive pages but can never reach the app's cookies or API.
    body = <iframe title={name} srcDoc={text} sandbox="allow-scripts allow-popups allow-forms" className="h-full w-full border-0 bg-white" />
  else if (kind === "csv")
    body = (
      <div className="overflow-auto p-2">
        <table className="text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === 0 ? "bg-muted font-medium" : "odd:bg-muted/30"}>
                {r.map((c, j) => (
                  <td key={j} className="border px-2 py-1 whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length >= 500 && <p className="p-2 text-xs text-muted-foreground">Showing the first 500 rows.</p>}
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>
          {name}
        </span>
        {needsText && text !== undefined && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        )}
        {canToggle && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setSource((s) => !s)}>
            {source ? <Eye /> : <Code />}
            <span className="hidden sm:inline">{source ? "Preview" : "Source"}</span>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <a href={api.downloadUrl(path)}>
            <Download />
            <span className="hidden sm:inline">Download</span>
          </a>
        </Button>
      </div>
      <div className={editing ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-auto"}>{body}</div>
    </div>
  )
}
