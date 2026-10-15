import { Code, Download, Eye, FileQuestion, Loader2 } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
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
  const [state, setState] = useState<{ text?: string; error?: string; binary?: boolean; tooBig?: number }>({})
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
        if (!cancelled) setState({ text: new TextDecoder().decode(buffer) })
      } catch (error) {
        if (!cancelled) setState({ error: (error as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, enabled])
  return state
}

export function FileViewer({ path }: { path: string }) {
  const kind = kindOf(path)
  const needsText = kind === "html" || kind === "markdown" || kind === "csv" || kind === "text"
  const { text, error, binary, tooBig } = useText(path, needsText)
  const [source, setSource] = useState(false)
  const name = path.split("/").pop() ?? path
  const url = api.rawUrl(path)
  const rows = useMemo(() => (kind === "csv" && text ? parseCsv(text, path.toLowerCase().endsWith(".tsv") ? "\t" : ",") : []), [kind, text, path])
  useEffect(() => setSource(false), [path])

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
        {canToggle && (
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
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  )
}
