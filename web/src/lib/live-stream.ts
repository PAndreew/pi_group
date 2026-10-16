/** The server pings every 15 s; a stream that has been silent longer than this is treated as dead. */
const STALE_MS = 35_000

interface Handlers {
  onMessage: (data: string) => void
  onOpen?: () => void
  onError?: () => void
}

/**
 * An EventSource that heals itself faster than the browser would:
 * - reconnects at once when the page comes back to the front or the network returns, instead of
 *   waiting for the browser to notice the old connection died (phones freeze background tabs);
 * - replaces a connection that went silent (no data, no ping) while it looked open;
 * - keeps retrying with backoff after the browser gave up (e.g. the server was restarting).
 * Returns a function that closes it for good.
 */
export function liveStream(url: string, handlers: Handlers) {
  let source: EventSource
  let lastActivity = Date.now()
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let closed = false

  const connect = () => {
    clearTimeout(retryTimer)
    source?.close()
    lastActivity = Date.now()
    source = new EventSource(url)
    source.onopen = () => {
      failures = 0
      lastActivity = Date.now()
      handlers.onOpen?.()
    }
    source.onmessage = (message) => {
      lastActivity = Date.now()
      handlers.onMessage(message.data)
    }
    source.addEventListener("ping", () => (lastActivity = Date.now()))
    source.onerror = () => {
      handlers.onError?.()
      // CONNECTING means the browser retries by itself; CLOSED means it gave up.
      if (source.readyState !== EventSource.CLOSED || closed) return
      retryTimer = setTimeout(connect, Math.min(1000 * 2 ** failures++, 15_000))
    }
  }

  const stale = () => source.readyState !== EventSource.OPEN || Date.now() - lastActivity > STALE_MS
  const onVisible = () => {
    if (document.visibilityState === "visible" && stale()) connect()
  }
  const onShow = (event: PageTransitionEvent) => {
    if (event.persisted) connect()
  }
  const watchdog = setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - lastActivity > STALE_MS) connect()
  }, 5_000)

  document.addEventListener("visibilitychange", onVisible)
  window.addEventListener("pageshow", onShow)
  window.addEventListener("online", connect)
  connect()

  return () => {
    closed = true
    clearTimeout(retryTimer)
    clearInterval(watchdog)
    document.removeEventListener("visibilitychange", onVisible)
    window.removeEventListener("pageshow", onShow)
    window.removeEventListener("online", connect)
    source.close()
  }
}
