import { useEffect, useReducer, useRef, useState } from "react"
import { toast } from "sonner"
import { api, type SessionState } from "@/lib/api"
import { liveStream } from "@/lib/live-stream"
import { cachedState, loadState, saveState } from "@/lib/state-cache"

type Event =
  | { type: "state"; state: SessionState }
  | { type: "message"; message: any }
  | { type: "partial"; partial: any }
  | { type: "tool_output"; toolCallId: string; output: string }
  | { type: "status"; status: Omit<SessionState, "messages" | "partial" | "toolOutputs"> }
  | { type: "notify"; level: "info" | "warn" | "error"; text: string; silent?: boolean }
  | { type: "deleted"; by: string }
  | { type: "pending_deletes"; pendingDeletes: NonNullable<SessionState["pendingDeletes"]> }
  | { type: "reset"; cached?: SessionState }
  | { type: "cached"; state: SessionState }

function reduce(state: SessionState | null, event: Event): SessionState | null {
  switch (event.type) {
    case "reset":
      return event.cached ?? null
    case "cached":
      return state ?? event.state
    case "state":
      return event.state
    case "message":
      if (!state) return state
      return { ...state, messages: [...state.messages, event.message] }
    case "partial":
      return state && { ...state, partial: event.partial }
    case "pending_deletes":
      return state && { ...state, pendingDeletes: event.pendingDeletes }
    case "tool_output":
      return state && { ...state, toolOutputs: { ...state.toolOutputs, [event.toolCallId]: event.output } }
    case "status": {
      if (!state) return state
      const toolOutputs = Object.fromEntries(Object.entries(state.toolOutputs).filter(([id]) => event.status.runningTools.includes(id)))
      return { ...state, ...event.status, toolOutputs }
    }
    default:
      return state
  }
}

/**
 * Live session state over server-sent events; on (re)connect the server resends full state.
 * The last known state is painted first, so reopening a session does not wait for the network.
 */
export function useSessionStream(key: string | undefined) {
  const [state, dispatch] = useReducer(reduce, null)
  const [connected, setConnected] = useState(false)
  const [deletedBy, setDeletedBy] = useState<string>()
  const live = useRef(false)

  useEffect(() => {
    live.current = false
    dispatch({ type: "reset", cached: key ? cachedState(key) : undefined })
    setDeletedBy(undefined)
    if (!key) return
    void loadState(key).then((cached) => cached && dispatch({ type: "cached", state: cached }))
    const close = liveStream(api.eventsUrl(key), {
      onOpen: () => setConnected(true),
      onError: () => setConnected(false),
      onMessage: (data) => {
        const event = JSON.parse(data) as Event
        if (event.type === "notify") {
          if (event.silent) return
          if (event.level === "error") toast.error(event.text)
          else if (event.level === "warn") toast.warning(event.text)
          return
        }
        if (event.type === "deleted") {
          setDeletedBy(event.by)
          close()
          return
        }
        if (event.type === "state") live.current = true
        dispatch(event)
      },
    })
    return () => {
      close()
      setConnected(false)
    }
  }, [key])

  // Remember live state (not what was restored from the cache) shortly after it settles.
  useEffect(() => {
    if (!key || !state || !live.current) return
    const persist = () => void saveState(key, state)
    const timer = setTimeout(persist, 1000)
    // A backgrounded phone tab may be killed before the timer fires.
    const onHide = () => document.visibilityState === "hidden" && persist()
    document.addEventListener("visibilitychange", onHide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", onHide)
    }
  }, [key, state])

  return { state, connected, deletedBy }
}
