import { liveStream } from "@/lib/live-stream"
import { tenantUrl } from "@/lib/tenant"

/**
 * The signed-in user's event stream (/api/notifications): run outcomes and chat messages, plus a
 * local "stream_open" on every (re)connect. One connection per tab, shared by every subscriber; it
 * opens with the first and closes with the last.
 */
type Listener = (event: { type: string; [key: string]: any }) => void

const listeners = new Set<Listener>()
let close: (() => void) | undefined

export function subscribeUserEvents(listener: Listener) {
  listeners.add(listener)
  close ??= liveStream(tenantUrl("/api/notifications"), {
    // Events sent while the connection was down are lost; this tells views to catch up.
    onOpen: () => {
      for (const l of listeners) l({ type: "stream_open" })
    },
    onMessage: (data) => {
      const event = JSON.parse(data)
      for (const l of listeners) l(event)
    },
  })
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      close?.()
      close = undefined
    }
  }
}
