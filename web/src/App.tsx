import { Activity, ArrowLeft, Bell, BellOff, Brain, KeyRound, Loader2, LogOut, Monitor, Moon, Settings, Sun, Users, Vault } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Toaster, toast } from "sonner"
import { AppletView } from "@/components/applet-view"
import { ChatList } from "@/components/chat-list"
import { TenantPicker } from "@/components/tenant-picker"
import { ChatView } from "@/components/chat-view"
import { FileViewer } from "@/components/file-viewer"
import { Home } from "@/components/home"
import { Login } from "@/components/login"
import { NewSessionDialog } from "@/components/new-session-dialog"
import { ChatSearchBox } from "@/components/chat-search-box"
import { FilePreviewPanel } from "@/components/file-preview-panel"
import { ProjectSwitcher } from "@/components/project-bar"
import { WorkspaceSidebar } from "@/components/workspace-sidebar"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ChatSearchProvider } from "@/lib/chat-search"
import { SettingsDialog } from "@/components/settings-dialog"
import { SessionView } from "@/components/session-view"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProfilePictureDialog } from "@/components/profile-picture-dialog"
import { AuthorAvatar } from "@/components/author-avatar"
import { PasswordDialog, UsersDialog } from "@/components/users-dialog"
import { AssistanceDialog } from "@/components/assistance-dialog"
import { VaultDialog } from "@/components/vault-dialog"
import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { useAppViewport } from "@/hooks/use-app-viewport"
import { notificationsUnavailable, useRunNotifications } from "@/hooks/use-run-notifications"
import { api, type SessionSummary } from "@/lib/api"
import { type Nav, NavContext } from "@/lib/nav"
import { ProjectsProvider, useProjects } from "@/lib/projects"
import { cn } from "@/lib/utils"

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
  chat?: string
  session?: string
  file?: string
  /** An applet's slug; /apps/<slug> links land here too. */
  app?: string
}

function readRoute(): Route {
  const slug = /^\/apps\/([a-z0-9-]+)\/?$/.exec(window.location.pathname)?.[1]
  if (slug) window.history.replaceState(null, "", `/#app=${slug}`)
  const params = new URLSearchParams(window.location.hash.slice(1))
  return { folder: params.get("f") ?? "", chat: params.get("c") ?? undefined, session: params.get("s") ?? undefined, file: params.get("file") ?? undefined, app: params.get("app") ?? undefined }
}

function writeRoute(route: Route) {
  const params = new URLSearchParams()
  if (route.folder) params.set("f", route.folder)
  if (route.chat) params.set("c", route.chat)
  if (route.session) params.set("s", route.session)
  if (route.file) params.set("file", route.file)
  if (route.app) params.set("app", route.app)
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
  const { active: project } = useProjects()
  const notifications = useRunNotifications(route.session, route.chat)
  const [newFolder, setNewFolder] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [usersOpen, setUsersOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [assistanceOpen, setAssistanceOpen] = useState(false)

  const nav: Nav = useMemo(
    () => ({
      home: () => setRoute({ chat: undefined, session: undefined, file: undefined, app: undefined }),
      openChat: (id) => setRoute({ chat: id, session: undefined, file: undefined, app: undefined }),
      openSession: (key, folder) => setRoute({ session: key, chat: undefined, file: undefined, app: undefined, ...(folder !== undefined ? { folder } : {}) }),
      openFile: (path) => setRoute({ file: path, chat: undefined, session: undefined, app: undefined }),
      openApplet: (slug) => setRoute({ app: slug, chat: undefined, session: undefined, file: undefined }),
      newSession: (folder) => setNewFolder(folder),
    }),
    [setRoute],
  )

  /** Explorer → New session: create with the saved defaults, or ask for them first. */
  useEffect(() => {
    if (newFolder === undefined || !user?.sessionDefaults || creating) return
    const folder = newFolder
    setNewFolder(undefined)
    setCreating(true)
    api
      .createSession({ harness: user.sessionDefaults.harness, path: folder, projectId: project?.id })
      .then(({ session }) => nav.openSession(session.key, folder), (error) => toast.error(error.message))
      .finally(() => setCreating(false))
  }, [newFolder, user, creating, nav, project])

  const consolidate = async () => {
    try {
      const r = await api.consolidateMemory()
      toast.info(r.started ? `Consolidating ${r.pending} conversation${r.pending === 1 ? "" : "s"} into memory…` : (r.reason ?? "Nothing new to consolidate."))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const back = (
    <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={nav.home} aria-label="Back to chats">
      <ArrowLeft />
    </Button>
  )
  const inside = Boolean(route.chat || route.session || route.file || route.app)
  // Large screens: files on the left, the last edited file on the right.
  const wide = useMediaQuery("(min-width: 1280px)")

  return (
    <NavContext.Provider value={nav}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className={cn("relative h-11 shrink-0 items-center gap-1 border-b px-1.5 sm:gap-2 sm:px-3", inside ? "hidden md:flex" : "flex")}>
          <TenantPicker />
          <ProjectSwitcher className="flex-1" onSelect={nav.home} />
          <ChatSearchBox onSearch={() => inside && (innerWidth < 768 || (innerWidth >= 1280 && innerWidth < 1536)) && nav.home()} />
          <ActiveSessions onOpen={(s) => nav.openSession(s.key, s.path)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="max-w-32 shrink-0 px-1.5" aria-label="Profile and settings">
                {user && <AuthorAvatar id={user.id} name={user.username} />}
                <span className="hidden truncate sm:inline">{user?.username}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {user?.username} · {user?.role}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light")}>
                {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Monitor />} Theme: {theme}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!notifications.supported}
                onSelect={(e) => {
                  e.preventDefault()
                  void notifications.toggle()
                }}
              >
                {notifications.enabled ? <Bell /> : <BellOff />}
                {notifications.supported ? `Notifications: ${notifications.enabled ? "on" : "off"}` : notificationsUnavailable()}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                <Users /> Profile picture
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAssistanceOpen(true)}>
                <Brain /> Cloudflare assistance
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setVaultOpen(true)}>
                <Vault /> Secret vault
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                <KeyRound /> Change password
              </DropdownMenuItem>
              {user?.role === "admin" && (
                <>
                  <DropdownMenuItem onSelect={() => setUsersOpen(true)}>
                    <Users /> Manage users
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void consolidate()}>
                    <Brain /> Consolidate memory now
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex min-h-0 flex-1">
          {wide && <WorkspaceSidebar folder={route.folder || project?.folder || ""} sessionKey={route.session} selectedFile={route.file} className="w-64 shrink-0" />}
          {inside && <ChatList key={project?.id} selected={route.chat ?? route.session} className="hidden w-80 shrink-0 border-r md:flex xl:hidden 2xl:flex 2xl:w-72" />}
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {route.chat ? (
              <ChatView key={route.chat} chatId={route.chat} />
            ) : route.session ? (
              <SessionView key={route.session} sessionKey={route.session} header={back} onDeleted={nav.home} />
            ) : route.file ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-1 border-b px-2 py-1">
                  {back}
                  <span className="truncate text-xs text-muted-foreground">/{route.file}</span>
                </div>
                <div className="min-h-0 flex-1">
                  <FileViewer path={route.file} />
                </div>
              </div>
            ) : route.app ? (
              <AppletView key={route.app} slug={route.app} header={back} />
            ) : (
              <Home />
            )}
          </main>
          {wide && <FilePreviewPanel sessionKey={route.session} projectId={project?.id} className="w-96 shrink-0" />}
        </div>

        <NewSessionDialog
          folder={newFolder ?? route.folder}
          projectId={project?.id}
          open={newFolder !== undefined && !user?.sessionDefaults}
          onOpenChange={(open) => !open && setNewFolder(undefined)}
          onCreated={(s) => {
            setNewFolder(undefined)
            nav.openSession(s.key, s.path)
          }}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} />
        <ProfilePictureDialog open={profileOpen} onOpenChange={setProfileOpen} />
        <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
        <VaultDialog open={vaultOpen} onOpenChange={setVaultOpen} />
        <AssistanceDialog open={assistanceOpen} onOpenChange={setAssistanceOpen} />
      </div>
    </NavContext.Provider>
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
  return user ? (
    <ProjectsProvider>
      <ChatSearchProvider>
        <Workspace />
      </ChatSearchProvider>
    </ProjectsProvider>
  ) : (
    <Login />
  )
}

export default function App() {
  useAppViewport()
  return (
    <AuthProvider>
      <TooltipProvider>
        <Gate />
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </AuthProvider>
  )
}
