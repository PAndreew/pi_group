import { toast } from "sonner"
import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { unsubscribePush } from "@/hooks/use-run-notifications"
import { ApiError, api, type User, type SessionDefaults, type AssistanceSettings } from "@/lib/api"
import { clearStates } from "@/lib/state-cache"
import { activeTenant, setActiveTenant } from "@/lib/tenant"

interface AuthValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  saveDefaults: (defaults: SessionDefaults) => Promise<void>
  saveAssistance: (settings: AssistanceSettings) => Promise<void>
}

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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  }, [user])

  useEffect(() => {
    let redirecting = false
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
      })
      .catch((error) => {
        // Offline or the server is restarting: keep the remembered user; only a 401 signs out.
        if (error instanceof ApiError && error.status === 401) setUser(null)
        else if (!rememberedUser()) setUser(null)
      })
      .finally(() => { if (!redirecting) setLoading(false) })
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

  const saveAssistance = useCallback(async (settings: AssistanceSettings) => {
    const { user } = await api.saveAssistance(settings)
    setUser(user)
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout, saveDefaults, saveAssistance }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth outside AuthProvider")
  return value
}
