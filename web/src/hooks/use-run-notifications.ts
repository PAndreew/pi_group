import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

interface RunNotice {
  type: "run"
  kind: "finished" | "error"
  key: string
  path: string
  name: string
  text: string
}

const STORAGE_KEY = "pi-group:notify"

/** Browsers only offer notifications on HTTPS (or localhost). */
export const notificationsSupported = () => typeof Notification !== "undefined" && window.isSecureContext

export function registerServiceWorker() {
  if (notificationsSupported() && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {})
}

const sessionHash = (n: RunNotice) => `#${new URLSearchParams({ ...(n.path ? { f: n.path } : {}), s: n.key })}`

async function showSystemNotification(n: RunNotice) {
  const title = n.kind === "error" ? `Agent error · ${n.name}` : `Agent finished · ${n.name}`
  const options: NotificationOptions = { body: n.text || (n.kind === "error" ? "The run failed." : "The run is done."), tag: `${n.key}:${n.kind}`, data: { url: `/${sessionHash(n)}` } }
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  if (registration) return registration.showNotification(title, options)
  const notification = new Notification(title, options)
  notification.onclick = () => {
    window.focus()
    window.location.hash = sessionHash(n)
    notification.close()
  }
}

/**
 * Listens for finished/failed runs in sessions the user is involved in. When the app is in the
 * background a system notification is shown (if enabled); when it is in front, a toast, unless
 * the user is already looking at that session.
 */
export function useRunNotifications(currentSession: string | undefined) {
  const supported = notificationsSupported()
  const [enabled, setEnabled] = useState(() => supported && localStorage.getItem(STORAGE_KEY) === "1" && Notification.permission === "granted")
  const current = useRef(currentSession)
  current.current = currentSession

  useEffect(() => {
    const source = new EventSource("/api/notifications")
    source.onmessage = (message) => {
      const notice = JSON.parse(message.data) as RunNotice
      if (notice.type !== "run") return
      const inFront = document.visibilityState === "visible" && document.hasFocus()
      if (inFront) {
        if (current.current === notice.key) return
        const open = { label: "Open", onClick: () => (window.location.hash = sessionHash(notice)) }
        if (notice.kind === "error") toast.error(`${notice.name}: ${notice.text || "the run failed"}`, { action: open })
        else toast.success(`${notice.name} finished`, { description: notice.text.slice(0, 140), action: open })
        return
      }
      if (enabled && Notification.permission === "granted") void showSystemNotification(notice)
    }
    return () => source.close()
  }, [enabled])

  // Clicks on service-worker notifications come back here as a message.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "open") window.location.hash = new URL(event.data.url, window.location.origin).hash
    }
    navigator.serviceWorker?.addEventListener("message", onMessage)
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage)
  }, [])

  const toggle = useCallback(async () => {
    if (!supported) return
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, "0")
      setEnabled(false)
      return
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
    if (permission !== "granted") {
      toast.error("Notifications are blocked for this site. Allow them in the browser's site settings.")
      return
    }
    localStorage.setItem(STORAGE_KEY, "1")
    setEnabled(true)
    toast.success("You'll be notified when a run finishes or fails.")
  }, [enabled, supported])

  return { supported, enabled, toggle }
}
