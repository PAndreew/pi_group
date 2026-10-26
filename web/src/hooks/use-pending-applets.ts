import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { subscribeUserEvents } from "@/lib/user-stream"

/** Applets (or changes to them) waiting for the user's approval, for the badge on the grid icon; follows changes live. */
export function usePendingApplets() {
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const load = () => api.applets().then(({ applets }) => setPending(applets.filter((a) => a.canManage && (!a.approved || a.hasDraft)).length), () => {})
    void load()
    return subscribeUserEvents((event) => (event.type === "applets" || event.type === "stream_open") && void load())
  }, [])
  return pending
}
