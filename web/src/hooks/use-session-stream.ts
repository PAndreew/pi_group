import { useEffect, useReducer, useState } from "react"
import { toast } from "sonner"
import { api, type SessionState } from "@/lib/api"

type Event =
  | { type: "state"; state: SessionState }
  | { type: "message"; message: any }
  | { type: "partial"; partial: any }
  | { type: "tool_output"; toolCallId: string; output: string }
  | { type: "status"; status: Omit<SessionState, "messages" | "partial" | "toolOutputs"> }
  | { type: "notify"; level: "info" | "warn" | "error"; text: string; silent?: boolean }
  | { type: "deleted"; by: string }
  | { type: "reset" }

function reduce(state: SessionState | null, event: Event): SessionState | null {
  switch (event.type) {
    case "reset":
      return null
    case "state":
      return event.state
    case "message":
      if (!state) return state
      return { ...state, messages: [...state.messages, event.message] }
    case "partial":
      return state && { ...state, partial: event.partial }
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

/** Live session state over server-sent events; EventSource reconnects and the server resends full state. */
export function useSessionStream(key: string | undefined) {
  const [state, dispatch] = useReducer(reduce, null)
  const [connected, setConnected] = useState(false)
  const [deletedBy, setDeletedBy] = useState<string>()

  useEffect(() => {
    dispatch({ type: "reset" })
    setDeletedBy(undefined)
    if (!key) return
    const source = new EventSource(api.eventsUrl(key))
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Event
      if (event.type === "notify") {
        if (event.silent) return
        if (event.level === "error") toast.error(event.text)
        else if (event.level === "warn") toast.warning(event.text)
        return
      }
      if (event.type === "deleted") {
        setDeletedBy(event.by)
        source.close()
        return
      }
      dispatch(event)
    }
    return () => {
      source.close()
      setConnected(false)
    }
  }, [key])

  return { state, connected, deletedBy }
}
