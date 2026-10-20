import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { subscribeUserEvents } from "@/lib/user-stream"

/** Scheduled jobs waiting for someone's approval, for the badge on the clock icon; follows changes live. */
export function usePendingJobs() {
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const load = () => api.jobs().then(({ jobs }) => setPending(jobs.filter((j) => !j.approved).length), () => {})
    void load()
    return subscribeUserEvents((event) => (event.type === "jobs" || event.type === "stream_open") && void load())
  }, [])
  return pending
}
