import { Activity, Bot, KeyRound, Loader2, LogOut, Menu, Monitor, Moon, Sun, Users } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Toaster, toast } from "sonner"
import { FileViewer } from "@/components/file-viewer"
import { Login } from "@/components/login"
import { NewSessionDialog } from "@/components/new-session-dialog"
import { SessionView } from "@/components/session-view"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PasswordDialog, UsersDialog } from "@/components/users-dialog"
import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { api, type SessionSummary } from "@/lib/api"

type Theme = "light" | "dark" | "system"

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("pi-group:theme") as Theme) || "system")
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches))
    apply()
    localStorage.setItem("pi-group:theme", theme)
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])
  return [theme, setTheme] as const
}

interface Route {
  folder: string
  session?: string
  file?: string
  tab: string
}

function readRoute(): Route {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return { folder: params.get("f") ?? "", session: params.get("s") ?? undefined, file: params.get("file") ?? undefined, tab: params.get("t") ?? "sessions" }
}

function writeRoute(route: Route) {
  const params = new URLSearchParams()
  if (route.folder) params.set("f", route.folder)
  if (route.session) params.set("s", route.session)
  if (route.file) params.set("file", route.file)
  if (route.tab !== "sessions") params.set("t", route.tab)
  const hash = `#${params.toString()}`
  if (hash !== window.location.hash) window.history.pushState(null, "", hash)
}

function useRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener("popstate", onPop)
    window.addEventListener("hashchange", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
      window.removeEventListener("hashchange", onPop)
    }
  }, [])
  const update = useCallback((change: Partial<Route>) => {
    setRoute((current) => {
      const next = { ...current, ...change }
      writeRoute(next)
      return next
    })
  }, [])
  return [route, update] as const
}

/** Sessions running anywhere that the user can see: work keeps going in the background. */
function ActiveSessions({ onOpen }: { onOpen: (s: SessionSummary) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  useEffect(() => {
    const load = () => api.activeSessions().then(({ sessions }) => setSessions(sessions), () => {})
    void load()
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [])
  const running = sessions.filter((s) => s.running)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Active sessions">
          <Activity className={running.length ? "text-green-500" : undefined} />
          <span className="tabular-nums">{running.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Open sessions</DropdownMenuLabel>
        {sessions.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">Nothing running.</div>}
        {sessions.map((s) => (
          <DropdownMenuItem key={s.key} onSelect={() => onOpen(s)} className="flex-col items-start gap-0">
            <span className="flex w-full items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${s.running ? "animate-pulse bg-green-500" : "bg-sky-500"}`} />
              <span className="truncate">{s.name || s.firstMessage || "Untitled"}</span>
            </span>
            <span className="pl-3.5 text-[11px] text-muted-foreground">
              /{s.path} · {s.harness} {s.running ? "· running" : "· idle"}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Workspace() {
  const { user, logout } = useAuth()
  const [theme, setTheme] = useTheme()
  const [route, setRoute] = useRoute()
  const [rootName, setRootName] = useState("root")
  const [sheet, setSheet] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [usersOpen, setUsersOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    api.fsInfo().then(({ rootName }) => setRootName(rootName), () => {})
  }, [])

  // On phones the sidebar is a sheet; start with it open when nothing is selected.
  useEffect(() => {
    if (!route.session && !route.file && window.matchMedia("(max-width: 767px)").matches) setSheet(true)
  }, [])

  const openSession = (key: string) => {
    setRoute({ session: key, file: undefined })
    setSheet(false)
  }
  const openFile = (path: string) => {
    setRoute({ file: path, session: undefined })
    setSheet(false)
  }

  const quickCreate = async () => {
    if (creating) return
    if (!user?.sessionDefaults) { setNewOpen(true); return }
    setCreating(true)
    try {
      const { session } = await api.createSession({ harness: user.sessionDefaults.harness, path: route.folder })
      setVersion((v) => v + 1)
      openSession(session.key)
    } catch (error) { toast.error((error as Error).message) }
    finally { setCreating(false) }
  }

  const sidebar = (
    <Sidebar
      rootName={rootName}
      folder={route.folder}
      tab={route.tab}
      onTab={(tab) => setRoute({ tab })}
      selectedSession={route.session}
      selectedFile={route.file}
      onFolder={(folder) => setRoute({ folder })}
      onSession={openSession}
      onFile={openFile}
      onNewSession={() => void quickCreate()}
      creating={creating}
      version={version}
    />
  )

  const menuButton = (
    <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setSheet(true)} aria-label="Open navigation">
      <Menu />
    </Button>
  )

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        {!route.session && !route.file && menuButton}
        <span className="font-semibold">
          <span className="font-mono">π</span> group
        </span>
        <div className="flex-1" />
        <ActiveSessions
          onOpen={(s) => {
            setRoute({ folder: s.path, session: s.key, file: undefined, tab: "sessions" })
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="max-w-32">
              <span className="truncate">{user?.username}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {user?.username} · {user?.role}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light")}>
              {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Monitor />} Theme: {theme}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDefaultsOpen(true)}>
              <Bot /> Session defaults
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
              <KeyRound /> Change password
            </DropdownMenuItem>
            {user?.role === "admin" && (
              <DropdownMenuItem onSelect={() => setUsersOpen(true)}>
                <Users /> Manage users
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-80 shrink-0 border-r md:block">{sidebar}</aside>
        <main className="min-w-0 flex-1">
          {route.session ? (
            <SessionView key={route.session} sessionKey={route.session} header={menuButton} />
          ) : route.file ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-1 border-b px-2 py-1 md:hidden">
                {menuButton}
                <span className="truncate text-xs text-muted-foreground">/{route.file}</span>
              </div>
              <div className="min-h-0 flex-1">
                <FileViewer path={route.file} />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              <p>Pick a session or a file, or start a new session in /{route.folder}.</p>
              <div className="flex gap-2">
                <Button disabled={creating} onClick={() => void quickCreate()}>New session</Button>
                <Button variant="outline" className="md:hidden" onClick={() => setSheet(true)}>
                  Browse
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" className="gap-0 p-0 pt-8">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Folders, sessions and files</SheetDescription>
          {sidebar}
        </SheetContent>
      </Sheet>

      <NewSessionDialog
        folder={route.folder}
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(s) => {
          setVersion((v) => v + 1)
          openSession(s.key)
        }}
      />
      <NewSessionDialog folder={route.folder} open={defaultsOpen} onOpenChange={setDefaultsOpen} onCreated={() => {}} defaultsOnly />
      <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    )
  return user ? <Workspace /> : <Login />
}

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Gate />
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </AuthProvider>
  )
}
