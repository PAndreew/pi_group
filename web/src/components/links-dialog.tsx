import { FileIcon } from "@react-symbols/icons/utils"
import { Folder, Globe, Library, Loader2, Search } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, type ProjectLink } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { useProjects } from "@/lib/projects"

const host = (url: string) => { try { return new URL(url).host } catch { return url } }
const base = (file: string) => file.split("/").pop() || file

function Row({ icon, title, detail, onClick, href }: { icon: ReactNode; title: string; detail?: string; onClick?: () => void; href?: string }) {
  const className = "flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
  const body = <>
    <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
    <span className="grid min-w-0 flex-1">
      <span className="truncate">{title}</span>
      {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
    </span>
  </>
  return <li>{href ? <a className={className} href={href} target="_blank" rel="noreferrer noopener" onClick={onClick}>{body}</a> : <button type="button" className={className} onClick={onClick}>{body}</button>}</li>
}

function Section({ title, children, count }: { title: string; children: ReactNode; count: number }) {
  if (!count) return null
  return <section className="grid gap-1">
    <h3 className="px-2 text-xs font-medium text-muted-foreground">{title} ({count})</h3>
    <ul className="grid min-w-0 grid-cols-1">{children}</ul>
  </section>
}

/**
 * Everything the active project points at, searchable: its folders and the files and web pages referred to in its
 * conversations (which the home page already lists). Folders are listed, not their contents; links are only those someone gave.
 */
export function LinksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const nav = useNav()
  const { active: project } = useProjects()
  const [query, setQuery] = useState("")
  const [links, setLinks] = useState<ProjectLink[]>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open || !project) return
    let alive = true
    setQuery(""); setError(undefined)
    api.projectLinks(project.id).then(l => {
      if (alive) setLinks(l.links)
    }, (e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [open, project])

  const needle = query.trim().toLowerCase()
  const match = (...texts: (string | undefined)[]) => !needle || texts.some(t => t?.toLowerCase().includes(needle))
  const folders = useMemo(() => project ? [...new Set([project.folder, ...project.links])].filter(Boolean) : [], [project])
  const shownFolders = folders.filter(f => match(f, base(f)))
  const files = (links ?? []).filter(l => l.kind === "file" && match(l.target, l.label, l.source.title))
  const web = (links ?? []).filter(l => l.kind === "web" && match(l.target, l.label, l.source.title))
  const go = (fn: () => void) => () => { onOpenChange(false); fn() }
  const from = (l: ProjectLink) => `${l.source.title}${l.count > 1 ? ` · ${l.count}×` : ""}`
  const loading = !error && !links
  const empty = !loading && !shownFolders.length && !files.length && !web.length

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Library className="size-4" /> Links{project ? ` · ${project.name}` : ""}</DialogTitle>
          <DialogDescription>This project's folders, and the files and web pages mentioned in its conversations.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-8" placeholder="Search links" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search links" />
        </div>
        <div className="-mx-2 grid min-h-0 min-w-0 grid-cols-1 content-start gap-3 overflow-y-auto px-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {empty && <p className="py-6 text-center text-sm text-muted-foreground">{needle ? "Nothing matches." : "No links yet."}</p>}
          <Section title="Folders" count={shownFolders.length}>
            {shownFolders.map(f => <Row key={f} icon={<Folder />} title={base(f)} detail={f === project?.folder ? `${f} · project folder` : f} onClick={go(() => nav.openExplorer(f))} />)}
          </Section>
          <Section title="Files" count={files.length}>
            {files.map(l => <Row key={l.target} icon={<FileIcon fileName={base(l.target)} autoAssign width={16} height={16} aria-hidden="true" />} title={l.label && l.label !== base(l.target) ? `${l.label} — ${base(l.target)}` : base(l.target)} detail={`${l.target} · ${from(l)}`} onClick={go(() => nav.openFile(l.target))} />)}
          </Section>
          <Section title="Web" count={web.length}>
            {web.map(l => <Row key={l.target} icon={<Globe />} title={l.label ?? l.target.replace(/^https?:\/\//, "")} detail={`${host(l.target)} · ${from(l)}`} href={l.target} />)}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
