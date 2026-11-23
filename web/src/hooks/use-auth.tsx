import { toast } from "sonner"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { unsubscribePush } from "@/hooks/use-run-notifications"
import { ApiError, api, type User, type SessionDefaults } from "@/lib/api"
import { clearStates } from "@/lib/state-cache"
import { activeTenant, setActiveTenant } from "@/lib/tenant"

interface AuthValue {
  user: User | null
  loading: boolean
  /** While loading: still trying, or the server could not be reached and a retry is scheduled. */
  connection: Connection
  /** Retry reaching the server now instead of waiting for the next attempt. */
  retry: () => void
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  saveDefaults: (defaults: SessionDefaults) => Promise<void>
}

export type Connection = { state: "connecting" } | { state: "offline"; retryAt: number; attempt: number; reason: string }

const AuthContext = createContext<AuthValue | null>(null)
// React StrictMode replays mount effects; a notification must switch only once.
let notificationSwitch: Promise<unknown> | undefined

/** The signed-in user from last time, so a reopened app renders at once while /me revalidates. */
const USER_KEY = "pi-group:user"
function rememberedUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "null")
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(rememberedUser)
  // A remembered user renders at once while /me revalidates in the background; only a first
  // visit (or a notification switching tenants) waits for the server.
  const [loading, setLoading] = useState(() => {
    const target = new URLSearchParams(window.location.search).get("tenant")
    return !rememberedUser() || Boolean(target && target !== activeTenant())
  })
  const [connection, setConnection] = useState<Connection>({ state: "connecting" })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setConnection({ state: "connecting" })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  }, [user])

  useEffect(() => {
    let redirecting = false
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    api
      .me()
      .then(async ({ user, tenantId }) => {
        const target = new URLSearchParams(window.location.search).get("tenant")
        if (tenantId && tenantId !== activeTenant()) {
          setActiveTenant(tenantId)
          redirecting = true
          window.location.replace(target ? window.location.href : window.location.pathname)
          return
        }
        if (target) {
          try {
            if (target !== activeTenant()) {
              await (notificationSwitch ??= api.switchTenant(target).catch(error => {
                notificationSwitch = undefined
                throw error
              }))
              await clearStates()
              setActiveTenant(target)
              redirecting = true
              window.location.replace(window.location.pathname + window.location.hash)
              return
            }
            window.history.replaceState(null, "", window.location.pathname + window.location.hash)
          } catch (error) {
            window.history.replaceState(null, "", window.location.pathname)
            toast.error((error as Error).message, { id: "notification-tenant" })
          }
        }
        setUser(user)
        if (!redirecting) setLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        // Only a 401 signs out. Offline or the server restarting: keep the remembered user, or
        // (first visit) keep the splash up and try again with backoff instead of showing a login
        // form that cannot work either.
        if (error instanceof ApiError && error.status === 401) {
          setUser(null)
          setLoading(false)
        } else if (rememberedUser()) setLoading(false)
        else {
          const delay = Math.min(2000 * 2 ** attempt, 15_000)
          const reason = !(error instanceof ApiError) ? "No answer from the server." : error.status >= 500 ? `The server isn't responding (${error.status}).` : `The server answered ${error.status}.`
          setConnection({ state: "offline", retryAt: Date.now() + delay, attempt: attempt + 1, reason })
          timer = setTimeout(() => setAttempt((n) => n + 1), delay)
        }
      })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [attempt])

  // Coming back online or to the front: retry at once.
  useEffect(() => {
    if (!loading || connection.state !== "offline") return
    const now = () => document.visibilityState === "visible" && retry()
    window.addEventListener("online", now)
    document.addEventListener("visibilitychange", now)
    return () => {
      window.removeEventListener("online", now)
      document.removeEventListener("visibilitychange", now)
    }
  }, [loading, connection.state, retry])

  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener("pi-group:unauthorized", onUnauthorized)
    const onStorage = (event: StorageEvent) => {
      if (event.key === "pi-group:tenant" || event.key === USER_KEY) window.location.replace(window.location.pathname)
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("pi-group:unauthorized", onUnauthorized)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    await api.login(username, password)
    await clearStates()
    const { tenantId } = await api.me()
    setActiveTenant(tenantId ?? "work")
    window.location.replace(window.location.pathname)
  }, [])

  const logout = useCallback(async () => {
    await unsubscribePush()
    await api.logout().catch(() => {})
    await clearStates()
    setUser(null)
  }, [])

  const saveDefaults = useCallback(async (defaults: SessionDefaults) => {
    const { user } = await api.saveDefaults(defaults)
    setUser(user)
  }, [])


  return <AuthContext.Provider value={{ user, loading, connection, retry, login, logout, saveDefaults }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth outside AuthProvider")
  return value
}
