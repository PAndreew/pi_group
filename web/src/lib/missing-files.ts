import { useEffect, useState } from "react"
import { api } from "@/lib/api"

/** How long an answer is trusted; files the agent moves show up as dead (or alive again) after this. */
const TTL_MS = 60_000
const BATCH = 200

const known = new Map<string, { missing: boolean; at: number }>()
const listeners = new Set<() => void>()
const queued = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined

const notify = () => { for (const listener of listeners) listener() }

/** Every message on screen asks at once; one request answers them all. */
function check(paths: string[]) {
  const now = Date.now()
  for (const path of paths) {
    const entry = known.get(path)
    if (!entry || now - entry.at > TTL_MS) queued.add(path)
  }
  if (!queued.size || timer) return
  timer = setTimeout(() => {
    timer = undefined
    const batch = [...queued].slice(0, BATCH)
    for (const path of batch) queued.delete(path)
    api.missingFiles(batch).then(({ missing }) => {
      const at = Date.now()
      for (const path of batch) known.set(path, { missing: missing.includes(path), at })
      notify()
    }, () => {})
    if (queued.size) check([])
  }, 50)
}

/** Record what the preview found, so links update without waiting for the next check. */
export function markMissing(path: string, missing: boolean) {
  if (known.get(path)?.missing === missing) return
  known.set(path, { missing, at: Date.now() })
  notify()
}

/** The subset of `paths` known to no longer exist; checked lazily, batched and cached. */
export function useMissingFiles(paths: string[]): Set<string> {
  const key = paths.join("\n")
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!key) return
    const listener = () => rerender((n) => n + 1)
    listeners.add(listener)
    check(key.split("\n"))
    return () => { listeners.delete(listener) }
  }, [key])
  return new Set(paths.filter((path) => known.get(path)?.missing))
}
