import { File, Folder, X } from "lucide-react"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { relativePath } from "@/lib/utils"

/**
 * #file and #folder suggestions (fuzzy) for the direct-session composer. Picking one inserts the path
 * in backticks, relative to the session's folder, so the agent can open it.
 */
export function PathDropup({ value, folder, onChange }: { value: string; folder: string; onChange: (value: string) => void }) {
  const [entries, setEntries] = useState<{ path: string; type: "dir" | "file" }[]>([])
  const [dismissed, setDismissed] = useState<string>()
  const match = /(^|\s)#([^\s#]*)$/.exec(value)
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
    <div className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full max-w-sm overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
      <div className="flex justify-end">
        <button type="button" aria-label="Dismiss file suggestions" className="rounded p-1 hover:bg-accent" onClick={() => setDismissed(value)}>
          <X className="size-4" />
        </button>
      </div>
      {entries.map((e) => (
        <button
          type="button"
          key={e.path}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(`${value.slice(0, value.length - match[2].length - 1)}\`${relativePath(folder, e.path)}${e.type === "dir" ? "/" : ""}\` `)}
        >
          {e.type === "dir" ? <Folder className="size-4 shrink-0 text-sky-600 dark:text-sky-400" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">/{e.path}</span>
        </button>
      ))}
    </div>
  )
}
