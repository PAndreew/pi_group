import type { SessionState } from "@/lib/api"

/**
 * Last known state of recently viewed sessions, so reopening the app (or a session) paints at once
 * while the live stream reconnects. In memory for this page, in IndexedDB across reloads.
 */
const DB = "pi-group"
const STORE = "sessions"
const KEEP = 12
const RECENT = "pi-group:cached-sessions"

const recentKeys = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? "[]")
  } catch {
    return []
  }
}

const memory = new Map<string, SessionState>()
let db: Promise<IDBDatabase | undefined> | undefined

function open() {
  db ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined)
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(undefined)
  })
  return db
}

function done(request: IDBRequest | IDBTransaction) {
  return new Promise<void>((resolve) => {
    if (request instanceof IDBTransaction) request.oncomplete = request.onerror = request.onabort = () => resolve()
    else request.onsuccess = request.onerror = () => resolve()
  })
}

/** Transient parts (streaming text, open dialogs, running tools) are dropped: they are stale by definition. */
const settled = (state: SessionState): SessionState => ({ ...state, partial: null, dialogs: [], runningTools: [], toolOutputs: {} })

export function cachedState(key: string) {
  return memory.get(key)
}

export async function loadState(key: string): Promise<SessionState | undefined> {
  if (memory.has(key)) return memory.get(key)
  const database = await open()
  if (!database) return undefined
  const request = database.transaction(STORE).objectStore(STORE).get(key)
  await done(request)
  return (request.result as { state: SessionState } | undefined)?.state
}

export async function saveState(key: string, state: SessionState) {
  const value = settled(state)
  memory.set(key, value)
  const database = await open()
  if (!database) return
  try {
    // Keep only the most recently saved sessions; the order lives in localStorage so pruning stays cheap.
    const recent = [key, ...recentKeys().filter((k) => k !== key)]
    localStorage.setItem(RECENT, JSON.stringify(recent.slice(0, KEEP)))
    const tx = database.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put({ state: value }, key)
    for (const old of recent.slice(KEEP)) tx.objectStore(STORE).delete(old)
    await done(tx)
  } catch {
    // Quota or private mode: the cache is only an optimisation.
  }
}

export async function clearStates() {
  memory.clear()
  localStorage.removeItem(RECENT)
  const database = await open()
  if (!database) return
  const tx = database.transaction(STORE, "readwrite")
  tx.objectStore(STORE).clear()
  await done(tx)
}
