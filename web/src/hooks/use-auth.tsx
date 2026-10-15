import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { api, type User, type SessionDefaults } from "@/lib/api"

interface AuthValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  saveDefaults: (defaults: SessionDefaults) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
    const onUnauthorized = () => setUser(null)
    window.addEventListener("pi-group:unauthorized", onUnauthorized)
    return () => window.removeEventListener("pi-group:unauthorized", onUnauthorized)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const { user } = await api.login(username, password)
    setUser(user)
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
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
