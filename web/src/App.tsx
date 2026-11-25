import { Activity, ArrowLeft, Check, X, Bell, BellOff, Languages, KeyRound, LogOut, Monitor, Moon, PanelLeft, Sun, Users } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Toaster, toast } from "sonner"
import { AppletView } from "@/components/applet-view"
import { ChatList } from "@/components/chat-list"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { ChatView } from "@/components/chat-view"
import { ExplorerDialog, type ExplorerState } from "@/components/explorer-dialog"
import { FileViewer } from "@/components/file-viewer"
import { Home } from "@/components/home"
import { Login } from "@/components/login"
import { NewSessionDialog } from "@/components/new-session-dialog"
import { ChatSearchOverlay } from "@/components/chat-search-box"
import { FilePreviewDialog, FilePreviewPanel, useLastEdit } from "@/components/file-preview-panel"
import { ProjectSwitcher } from "@/components/project-bar"
import { WorkspaceSidebar } from "@/components/workspace-sidebar"
import { Splash } from "@/components/splash"
import { useMediaQuery } from "@/hooks/use-media-query"
import { languages, LocaleProvider, useLocale } from "@/lib/i18n"
import { ChatSearchProvider } from "@/lib/chat-search"
import { NavSlotContext } from "@/lib/nav-slot"
import { SessionView } from "@/components/session-view"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProfilePictureDialog } from "@/components/profile-picture-dialog"
import { AuthorAvatar } from "@/components/author-avatar"
import { PasswordDialog, UsersDialog } from "@/components/users-dialog"
import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { useAppViewport } from "@/hooks/use-app-viewport"
import { notificationsUnavailable, useRunNotifications } from "@/hooks/use-run-notifications"
import { api, type SessionSummary } from "@/lib/api"
import { type Nav, NavContext } from "@/lib/nav"
import { ProjectsProvider, useProjects } from "@/lib/projects"

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
  const { t } = useLocale()
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
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label={t("nav.activeSessions")}>
          <Activity className={running.length ? "text-green-500" : undefined} />
          <span className="tabular-nums">{t("nav.runningCount", { count: running.length })}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("nav.openSessions")}</DropdownMenuLabel>
        {sessions.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">{t("nav.nothingRunning")}</div>}
        {sessions.map((s) => (
          <DropdownMenuItem key={s.key} onSelect={() => onOpen(s)} className="flex-col items-start gap-0">
            <span className="flex w-full items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${s.running ? "animate-pulse bg-green-500" : "bg-sky-500"}`} />
              <span className="truncate">{s.name || s.firstMessage || t("common.untitled")}</span>
            </span>
            <span className="pl-3.5 text-[11px] text-muted-foreground">
              /{s.path} · {s.harness} · {t(s.running ? "nav.running" : "nav.idle")}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Workspace() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLocale()
  const [theme, setTheme] = useTheme()
  const [route, setRoute] = useRoute()
  const { active: project } = useProjects()
  const notifications = useRunNotifications(route.session, route.chat)
  const [newSession, setNewSession] = useState<{ folder: string; options?: Parameters<Nav["newSession"]>[1] }>()
  const [openBrowserFor, setOpenBrowserFor] = useState<string>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Desktop sidebar: open by default, the header icon hides it; remembered per browser.
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("pi-group:sidebar") !== "0")
  const toggleSidebar = () => setSidebarOpen((open) => { localStorage.setItem("pi-group:sidebar", open ? "0" : "1"); return !open })
  const [selectSessions, setSelectSessions] = useState(false)
  useEffect(() => setDrawerOpen(false), [route.chat, route.session, route.file, route.app])
  const [creating, setCreating] = useState(false)
  const [usersOpen, setUsersOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const [explorer, setExplorer] = useState<ExplorerState>({ open: false, folder: "", query: "" })
  /** Where closing the file preview goes back to, and whether the explorer it was opened from reopens. */
  const previewReturn = useRef<{ route: Route; explorer: boolean } | null>(null)
  const closePreview = () => {
    const back = previewReturn.current
    previewReturn.current = null
    setRoute(back?.route ?? { chat: undefined, session: undefined, file: undefined, app: undefined })
    if (back?.explorer) setExplorer((e) => ({ ...e, open: true }))
  }
  const go = (next: Partial<Route>, browser = false) => {
    setOpenBrowserFor(browser ? next.session : undefined)
    previewReturn.current = null
    setSelectSessions(false)
    setRoute({ chat: undefined, session: undefined, file: undefined, app: undefined, ...next })
  }
  const openFile = (path: string, fromExplorer = false) => {
    // From one file to another the way back stays the same; only reopening the explorer may change.
    const back = route.file && previewReturn.current ? previewReturn.current.route : { ...route, file: undefined }
    previewReturn.current = { route: back, explorer: fromExplorer || Boolean(route.file && previewReturn.current?.explorer) }
    setRoute({ file: path, chat: undefined, session: undefined, app: undefined })
  }

  const nav: Nav = useMemo(
    () => ({
      home: () => go({}),
      openChat: (id) => go({ chat: id }),
      openSession: (key, folder) => go({ session: key, ...(folder !== undefined ? { folder } : {}) }),
      openFile: (path) => openFile(path),
      openExplorer: (folder) => setExplorer({ open: true, folder, query: "" }),
      openApplet: (slug) => go({ app: slug }),
      newSession: (folder, options) => setNewSession({ folder, options }),
    }),
    [setRoute, route],
  )

  /** Create with the saved defaults, or ask for the runtime and model first. */
  useEffect(() => {
    if (!newSession || !user?.sessionDefaults || creating) return
    const { folder, options } = newSession
    setNewSession(undefined)
    setCreating(true)
    api
      .createSession({ harness: user.sessionDefaults.harness, path: folder, projectId: project?.id, model: options?.model, thinkingLevel: options?.thinkingLevel })
      .then(({ session }) => go({ session: session.key, folder }, options?.browser), (error) => toast.error(error.message))
      .finally(() => setCreating(false))
  }, [newSession, user, creating, project])

  const back = (
    <Button variant="ghost" size="icon-sm" onClick={nav.home} aria-label={t("nav.backToChats")}>
      <ArrowLeft />
    </Button>
  )
  const inside = Boolean(route.chat || route.session || route.file || route.app)
  // From 1024px: files and tool icons on the left. From 1536px, inside a conversation: the last
  // edited file on the right (otherwise it opens in a modal from the left sidebar).
  const wide = useMediaQuery("(min-width: 1024px)")
  const huge = useMediaQuery("(min-width: 1536px)")
  const lastEdit = useLastEdit(route.session, project?.id)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewPanel = huge && inside


  return (
    <NavContext.Provider value={nav}>
      <NavSlotContext.Provider value={null}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="relative flex h-12 shrink-0 items-center justify-between gap-1 px-2 text-base lg:border-b sm:px-3">
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={t(wide ? (sidebarOpen ? "nav.hideSidebar" : "nav.showSidebar") : "nav.open")} title={wide ? t(sidebarOpen ? "nav.hideSidebar" : "nav.showSidebar") : undefined} onClick={() => (wide ? toggleSidebar() : setDrawerOpen(true))}><PanelLeft /></Button>
          </div>
          <div className="absolute left-1/2 flex max-w-[50%] -translate-x-1/2 justify-center"><ProjectSwitcher className="min-w-0" onSelect={nav.home} onSearch={() => setSearchOpen(true)} /></div>
          <div className="ml-auto flex shrink-0 items-center gap-1">

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="max-w-32 shrink-0 px-1.5" aria-label={t("profile.settings")}>
                {user && <AuthorAvatar id={user.id} name={user.username} />}

              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {user?.username} · {t(user?.role === "admin" ? "profile.admin" : "profile.user")}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light")}>
                {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Monitor />} {t("profile.theme", { theme: t(`profile.theme.${theme}`) })}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Languages /> {t("profile.language")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={language} onValueChange={setLanguage}>
                    {languages.map(({ code, name }) => (
                      <DropdownMenuRadioItem key={code} lang={code} value={code}>
                        <Check aria-hidden="true" className={code === language ? "" : "invisible"} /> {name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                disabled={!notifications.supported}
                onSelect={(e) => {
                  e.preventDefault()
                  void notifications.toggle()
                }}
              >
                {notifications.enabled ? <Bell /> : <BellOff />}
                {t(notifications.supported ? (notifications.enabled ? "profile.notificationsOn" : "profile.notificationsOff") : notificationsUnavailable())}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                <Users /> {t("profile.picture")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
                <KeyRound /> {t("profile.password")}
              </DropdownMenuItem>
              {user?.role === "admin" && (
                <>
                  <DropdownMenuItem onSelect={() => setUsersOpen(true)}>
                    <Users /> {t("profile.users")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut /> {t("profile.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>
        <Sheet open={!wide && drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent className="gap-0" aria-describedby={undefined}>
            <SheetTitle className="border-b px-4 py-3 font-normal">{t("nav.menu")}</SheetTitle>
            <WorkspaceSidebar folder={route.folder || project?.folder || ""} sessionKey={route.session} selectedFile={route.file} className="min-h-0 flex-1"><ActiveSessions onOpen={(s) => nav.openSession(s.key, s.path)} /></WorkspaceSidebar>
          </SheetContent>
        </Sheet>

        <div className="flex min-h-0 flex-1">
          {wide && sidebarOpen && <WorkspaceSidebar folder={route.folder || project?.folder || ""} sessionKey={route.session} selectedFile={route.file} lastEdit={previewPanel ? undefined : lastEdit.file ?? undefined} onLastEdit={() => setPreviewOpen(true)} className="w-64 shrink-0"><ActiveSessions onOpen={(s) => nav.openSession(s.key, s.path)} /></WorkspaceSidebar>}
          {inside && <ChatList key={project?.id} selected={route.chat ?? route.session} className="hidden w-80 shrink-0 border-r md:flex lg:hidden 2xl:flex 2xl:w-72" />}
          <main className={`min-h-0 min-w-0 flex-1 ${inside ? "overflow-hidden" : "overflow-visible"}`}>
            {route.chat ? (
              <ChatView key={route.chat} chatId={route.chat} />
            ) : route.session ? (
              <SessionView key={route.session} sessionKey={route.session} initialBrowserShown={route.session === openBrowserFor} header={back} onDeleted={nav.home} onSelectSessions={() => { nav.home(); setSelectSessions(true) }} />
            ) : route.file ? (
              <FileViewer path={route.file} onClose={closePreview} />
            ) : route.app ? (
              <AppletView key={route.app} slug={route.app} header={back} />
            ) : (
              <Home selectSessions={selectSessions} creatingSession={creating} />
            )}
          </main>
          {previewPanel && <FilePreviewPanel lastEdit={lastEdit} className="w-96 shrink-0" />}
        </div>

        <NewSessionDialog
          folder={newSession?.folder ?? route.folder}
          projectId={project?.id}
          open={newSession !== undefined && !user?.sessionDefaults}
          onOpenChange={(open) => !open && setNewSession(undefined)}
          onCreated={(s) => {
            setNewSession(undefined)
            go({ session: s.key, folder: s.path }, newSession?.options?.browser)
          }}
        />
        <FilePreviewDialog lastEdit={lastEdit} open={previewOpen && !previewPanel} onOpenChange={setPreviewOpen} />
        <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} />
        <ProfilePictureDialog open={profileOpen} onOpenChange={setProfileOpen} />
        <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
        <ChatSearchOverlay open={searchOpen} onOpenChange={setSearchOpen} onSearch={() => inside && (innerWidth < 768 || (innerWidth >= 1024 && innerWidth < 1536)) && nav.home()} />
        <ExplorerDialog
          state={explorer}
          onChange={setExplorer}
          onFile={(path) => {
            setExplorer((e) => ({ ...e, open: false }))
            openFile(path, true)
          }}
        />
      </div>
      </NavSlotContext.Provider>
    </NavContext.Provider>
  )
}

function Gate() {
  const { user, loading, connection, retry } = useAuth()
  if (loading) return <Splash connection={connection} onRetry={retry} />
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
  return <LocaleProvider><LocalizedApp /></LocaleProvider>
}

function LocalizedApp() {
  const { t } = useLocale()
  return (
    <AuthProvider>
      <TooltipProvider>
        <Gate />
        <Toaster position="top-center" closeButton toastOptions={{ closeButtonAriaLabel: t("common.cancelNotification") }} icons={{ close: <span>{t("common.cancel")}</span>, success: <Check className="size-4 text-green-600" />, info: <Check className="size-4 text-green-600" />, warning: <X className="size-4 text-red-600" />, error: <X className="size-4 text-red-600" /> }} />
      </TooltipProvider>
    </AuthProvider>
  )
}
