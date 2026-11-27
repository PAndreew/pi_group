import { LayoutGrid, MessageSquare, MessagesSquare, Search, Terminal } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { SurfaceIcon } from "@/components/surface-actions"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { api, type Applet, type ChatListItem } from "@/lib/api"
import { useLocale } from "@/lib/i18n"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"
import { useSurfaces } from "@/lib/surface-context"
import { canOpen, matches, SURFACES } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

/** An extra entry from the workspace (search chats, theme…). */
export interface PaletteCommand {
  id: string
  label: string
  keywords?: string
  icon: ReactNode
  run: () => void
}

interface Entry {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  text: string
  run: () => void
}

/** How many conversations show before anything is typed, and at most while filtering. */
const RECENT = 5
const MAX_CONVERSATIONS = 8

/** Ctrl/⌘+K: jump to any part of the app, a chat, a session or an applet by typing. */
export function CommandPalette({ open, onOpenChange, commands }: { open: boolean; onOpenChange: (open: boolean) => void; commands: PaletteCommand[] }) {
  const { t } = useLocale()
  const { user } = useAuth()
  const nav = useNav()
  const surfaces = useSurfaces()
  const { active: project } = useProjects()
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const [conversations, setConversations] = useState<ChatListItem[]>([])
  const [applets, setApplets] = useState<Applet[]>([])
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setIndex(0)
    let alive = true
    api.chats(project?.id).then(({ chats }) => alive && setConversations(chats), () => {})
    api.applets().then(({ applets }) => alive && setApplets(applets.filter((a) => a.approved)), () => {})
    return () => { alive = false }
  }, [open, project?.id])

  const entries = useMemo(() => {
    const close = (run: () => void) => () => { onOpenChange(false); run() }
    const all: Entry[] = [
      ...SURFACES.filter((s) => canOpen(s, user?.role)).map((s) => ({ id: `surface:${s.id}`, group: t("palette.goTo"), label: t(s.label), icon: <SurfaceIcon id={s.id} />, text: `${t(s.label)} ${s.id} ${s.keywords}`, run: close(() => surfaces.open(s.id)) })),
      ...commands.map((c) => ({ id: `command:${c.id}`, group: t("palette.actions"), label: c.label, icon: c.icon, text: `${c.label} ${c.keywords ?? ""}`, run: close(c.run) })),
    ]
    const found = query.trim() ? all.filter((e) => matches(query, e.text)) : all
    const convs = conversations
      .filter((c) => !query.trim() || matches(query, `${c.title} ${c.folder}`))
      .slice(0, query.trim() ? MAX_CONVERSATIONS : RECENT)
      .map((c): Entry => ({
        id: `${c.kind}:${c.id}`,
        group: t("palette.conversations"),
        label: c.title || t("common.untitled"),
        hint: `/${c.folder}`,
        icon: c.kind === "chat" ? <MessagesSquare /> : c.running ? <Terminal className="text-green-600" /> : <MessageSquare />,
        text: c.title,
        run: close(() => (c.kind === "chat" ? nav.openChat(c.id) : nav.openSession(c.id, c.folder))),
      }))
    const apps = query.trim()
      ? applets.filter((a) => matches(query, `${a.title} ${a.slug} ${a.description}`)).slice(0, 5).map((a): Entry => ({ id: `applet:${a.slug}`, group: t("ui.applets-29dfcc"), label: a.title, hint: a.description, icon: <LayoutGrid />, text: a.title, run: close(() => nav.openApplet(a.slug)) }))
      : []
    // Conversations first (recent ones before anything is typed): they are what people look for most.
    return [...convs, ...found, ...apps]
  }, [query, conversations, applets, commands, user?.role, t, nav, surfaces, onOpenChange])

  useEffect(() => setIndex(0), [query])
  useEffect(() => { list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }) }, [index])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) { e.preventDefault(); setIndex((i) => Math.min(i + 1, entries.length - 1)) }
    else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)) }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); entries[index]?.run() }
  }

  let lastGroup = ""
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" onKeyDown={onKeyDown}>
        <DialogTitle className="sr-only">{t("palette.title")}</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={entries[index] ? `palette-${index}` : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">Esc</kbd>
        </div>
        <div ref={list} id="command-palette-list" role="listbox" className="max-h-[min(60dvh,26rem)] overflow-y-auto p-1.5">
          {entries.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("palette.nothing")}</p>}
          {entries.map((entry, i) => {
            const heading = entry.group !== lastGroup ? entry.group : undefined
            lastGroup = entry.group
            return (
              <div key={entry.id}>
                {heading && <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{heading}</div>}
                <div
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={entry.run}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0", i === index && "bg-accent text-accent-foreground")}
                >
                  {entry.icon}
                  <span className="min-w-0 truncate">{entry.label}</span>
                  {entry.hint && <span className="ml-auto min-w-0 truncate pl-2 text-xs text-muted-foreground">{entry.hint}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
