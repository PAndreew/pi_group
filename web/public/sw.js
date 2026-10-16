// Minimal service worker: shows run notifications (Android Chrome only allows them from a
// service worker) and brings the app to the session when one is clicked. No caching.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        await client.focus()
        client.postMessage({ type: "open", url })
      } else {
        await self.clients.openWindow(url)
      }
    })()
  )
})
