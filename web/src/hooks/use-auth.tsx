import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { unsubscribePush } from "@/hooks/use-run-notifications"
import { ApiError, api, type User, type SessionDefaults } from "@/lib/api"
import { clearStates } from "@/lib/state-cache"
import { activeTenant, setActiveTenant } from "@/lib/tenant"

interface AuthValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  saveDefaults: (defaults: SessionDefaults) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

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
    api
      .me()
      .then(({ user, tenantId }) => {
        if (tenantId && tenantId !== activeTenant()) {
          setActiveTenant(tenantId)
          window.location.replace(window.location.pathname)
          return
        }
        setUser(user)
      })
      .catch((error) => {
        // Offline or the server is restarting: keep the remembered user; only a 401 signs out.
        if (error instanceof ApiError && error.status === 401) setUser(null)
        else if (!rememberedUser()) setUser(null)
      })
      .finally(() => setLoading(false))
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

  return <AuthContext.Provider value={{ user, loading, login, logout, saveDefaults }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth outside AuthProvider")
  return value
}
