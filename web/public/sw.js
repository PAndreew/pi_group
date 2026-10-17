// Service worker: run notifications (Web Push, and Android Chrome only allows notifications from a
// service worker), and an app-shell cache so a reopened app paints without waiting for the server.
// API calls are never cached.
const SHELL = "beezy-shell-v3"
const ASSETS = "beezy-assets-v3"

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== SHELL && name !== ASSETS) await caches.delete(name)
      await self.clients.claim()
    })()
  )
)

const sessionUrl = (n) => `/#${new URLSearchParams({ ...(n.path ? { f: n.path } : {}), s: n.key })}`

self.addEventListener("push", (event) => {
  const notice = event.data?.json()
  if (notice?.type === "chat") return event.waitUntil(chatNotification(notice))
  if (notice?.type === "interaction") return event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    if (windows.some((c) => c.focused && c.visibilityState === "visible")) return
    await self.registration.showNotification("beezy · Awaiting your input", {
      body: notice.title,
      tag: `interaction:${notice.id}`,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: sessionUrl(notice) },
    })
  })())
  if (notice?.type !== "run") return
  event.waitUntil(
    (async () => {
      // With the app in front, the page shows a toast instead.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      if (windows.some((c) => c.focused && c.visibilityState === "visible")) return
      const error = notice.kind === "error"
      await self.registration.showNotification(`${error ? "Agent error" : "Agent finished"} · ${notice.name}`, {
        body: notice.text || (error ? "The run failed." : "The run is done."),
        tag: `${notice.key}:${notice.kind}`,
        icon: "/icon-192.png",
        badge: "/badge-96.png",
        data: { url: sessionUrl(notice) },
      })
    })()
  )
})

/** A chat message: "author · chat" with the text; skipped when the app is in front (it shows a toast). */
async function chatNotification(notice) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  if (windows.some((c) => c.focused && c.visibilityState === "visible")) return
  await self.registration.showNotification(notice.author === notice.title ? notice.author : `${notice.author} · ${notice.title}`, {
    body: notice.text,
    tag: `chat:${notice.chatId}`,
    renotify: true,
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    data: { url: `/#c=${encodeURIComponent(notice.chatId)}` },
  })
}

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

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return
  // Let the browser revalidate install metadata rather than returning an old cached app name.
  if (url.pathname.endsWith(".webmanifest")) return
  if (request.mode === "navigate") event.respondWith(page(event))
  else if (url.pathname.startsWith("/assets/")) event.respondWith(asset(request))
  else if (/\.(png|svg|ico|webmanifest)$/.test(url.pathname)) event.respondWith(staleWhileRevalidate(request))
})

/**
 * The HTML: network first so a deployment shows up at once, but fall back to the cached copy when
 * the server is slow or unreachable. A changed page means a new build, so old hashed assets go.
 */
async function page(event) {
  const cache = await caches.open(SHELL)
  const network = fetch(event.request).then(async (response) => {
    if (!response.ok) return response
    const previous = await cache.match("/")
    const fresh = await response.clone().text()
    if (previous && (await previous.text()) !== fresh) await caches.delete(ASSETS)
    await cache.put("/", response.clone())
    return response
  })
  event.waitUntil(network.catch(() => {}))
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500))
  const first = await Promise.race([network.catch(() => undefined), timeout])
  if (first?.ok) return first
  return (await cache.match("/")) || first || network
}

/** Vite's hashed bundles never change under the same name. */
async function asset(request) {
  const cache = await caches.open(ASSETS)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL)
  const cached = await cache.match(request)
  const network = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone())
    return response
  })
  if (cached) {
    network.catch(() => {})
    return cached
  }
  return network
}
