import { File, Folder, X } from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { relativePath } from "@/lib/utils"

/**
 * $file and $folder suggestions (fuzzy) for the direct-session composer. Picking one takes the `$query` out of the
 * text and hands the path, relative to the session's folder, to `onPick` (shown as a pill, sent in backticks).
 */
export function PathDropup({ value, folder, onPick }: { value: string; folder: string; onPick: (path: string, rest: string) => void }) {
  const [entries, setEntries] = useState<{ path: string; type: "dir" | "file" }[]>([])
  const [dismissed, setDismissed] = useState<string>()
  const match = /(^|\s)\$([^\s$]*)$/.exec(value)
  const query = match?.[2]

  useEffect(() => {
    if (query === undefined) return setEntries([])
    let alive = true
    const timer = setTimeout(() => {
      api.searchPaths(query).then((r) => alive && setEntries(r.entries), () => {})
    }, 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  if (!match || dismissed === value || !entries.length) return null

  return (
    <div data-suggestions className="absolute bottom-full left-0 z-20 mb-1 flex max-h-64 w-full max-w-sm flex-col rounded-md border bg-[var(--composer-background)] text-[var(--composer-foreground)] shadow-md">
      <div className="flex shrink-0 justify-end px-1 pt-1">
        <button type="button" aria-label="Dismiss file suggestions" className="rounded p-1.5 hover:bg-accent" onClick={() => setDismissed(value)}>
          <X className="size-4" />
        </button>
      </div>
      <div className="chat-scroll-fade min-h-0 flex-1 overflow-y-auto px-1 py-2">
      {entries.map((e) => (
        <button
          type="button"
          key={e.path}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(`${relativePath(folder, e.path)}${e.type === "dir" ? "/" : ""}`, value.slice(0, value.length - match[2].length - 1))}
        >
          {e.type === "dir" ? <Folder className="size-4 shrink-0 text-sky-600 dark:text-sky-400" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">/{e.path}</span>
        </button>
      ))}
      </div>
    </div>
  )
}
