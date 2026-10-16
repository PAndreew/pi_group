import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { liveStream } from "@/lib/live-stream"

interface RunNotice {
  type: "run"
  kind: "finished" | "error"
  key: string
  path: string
  name: string
  text: string
}

const STORAGE_KEY = "pi-group:notify"

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
const iOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

/** Browsers only offer notifications on HTTPS (or localhost); iOS only to an app added to the home screen. */
export const notificationsSupported = () => typeof Notification !== "undefined" && window.isSecureContext

/** Why the notifications toggle is unavailable, for the menu label. */
export function notificationsUnavailable() {
  if (!window.isSecureContext) return "Notifications need HTTPS"
  if (iOS() && !standalone()) return "Add to Home Screen for notifications"
  return "Notifications unsupported here"
}

/** Push delivers while the app is closed or frozen in the background. */
const pushSupported = () => notificationsSupported() && "serviceWorker" in navigator && "PushManager" in window

export function registerServiceWorker() {
  if (window.isSecureContext && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {})
}

const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
const toBase64Url = (buffer: ArrayBuffer | null) => (buffer ? btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "")

/** Subscribe this device (again) and tell the server; a subscription made for an old server key is replaced. */
async function subscribePush() {
  const registration = await navigator.serviceWorker.ready
  const { publicKey } = await api.pushKey()
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && toBase64Url(subscription.options.applicationServerKey) !== publicKey) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) })
  await api.pushSubscribe(subscription.toJSON())
}

/** Stop pushes to this device, e.g. before signing out so the next user of the device gets none. */
export async function unsubscribePush() {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await api.pushUnsubscribe(subscription.endpoint).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}

const sessionHash = (n: RunNotice) => `#${new URLSearchParams({ ...(n.path ? { f: n.path } : {}), s: n.key })}`

/** Same title, body and tag as the service worker's push notification, so the two collapse into one. */
async function showSystemNotification(n: RunNotice) {
  const title = n.kind === "error" ? `Agent error · ${n.name}` : `Agent finished · ${n.name}`
  const options: NotificationOptions = { body: n.text || (n.kind === "error" ? "The run failed." : "The run is done."), tag: `${n.key}:${n.kind}`, icon: "/icon-192.png", badge: "/badge-96.png", data: { url: `/${sessionHash(n)}` } }
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
 * Finished/failed runs in sessions the user is involved in. While the app is open the server streams
 * them: a toast when the app is in front (unless that session is on screen), a system notification
 * when it is in the background. Web Push covers the app being closed or frozen by the phone.
 */
export function useRunNotifications(currentSession: string | undefined) {
  const supported = notificationsSupported()
  const [enabled, setEnabled] = useState(() => supported && localStorage.getItem(STORAGE_KEY) === "1" && Notification.permission === "granted")
  const current = useRef(currentSession)
  current.current = currentSession
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(
    () =>
      liveStream("/api/notifications", {
        onMessage: (data) => {
          const notice = JSON.parse(data) as RunNotice
          if (notice.type !== "run") return
          const inFront = document.visibilityState === "visible" && document.hasFocus()
          if (inFront) {
            if (current.current === notice.key) return
            const open = { label: "Open", onClick: () => (window.location.hash = sessionHash(notice)) }
            if (notice.kind === "error") toast.error(`${notice.name}: ${notice.text || "the run failed"}`, { action: open })
            else toast.success(`${notice.name} finished`, { description: notice.text.slice(0, 140), action: open })
            return
          }
          if (enabledRef.current && Notification.permission === "granted") void showSystemNotification(notice)
        },
      }),
    [],
  )

  // Keep the server's copy of this device's subscription current (new server key, cleared data, …).
  useEffect(() => {
    if (enabledRef.current && pushSupported()) subscribePush().catch(() => {})
  }, [])

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
      await unsubscribePush()
      return
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
    if (permission !== "granted") {
      toast.error("Notifications are blocked for this site. Allow them in the browser's site settings.")
      return
    }
    localStorage.setItem(STORAGE_KEY, "1")
    setEnabled(true)
    if (!pushSupported()) return void toast.success("You'll be notified while the app is open.")
    try {
      await subscribePush()
      toast.success("You'll be notified when a run finishes or fails, even with the app closed.")
    } catch (error) {
      toast.warning(`Notifications work while the app is open, but push failed: ${(error as Error).message}`)
    }
  }, [enabled, supported])

  return { supported, enabled, toggle }
}
