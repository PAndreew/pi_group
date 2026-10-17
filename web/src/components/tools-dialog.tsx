import { Loader2, RotateCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type SessionTools } from "@/lib/api"

const KIND_LABEL = { package: "Packages", extension: "Extensions", skill: "Skills", prompt: "Prompt templates" } as const
const SOURCE_LABEL: Record<string, string> = { extension: "Extension commands", skill: "Skills", prompt: "Prompt templates" }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="grid gap-1">{children}</ul>
    </section>
  )
}

function Row({ name, badge, description, title, onClick }: { name: string; badge?: string; description?: string; title?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <span className="truncate font-mono text-[13px]">{name}</span>
        {badge && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            {badge}
          </Badge>
        )}
      </span>
      {description && <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>}
    </>
  )
  return (
    <li title={title}>
      {onClick ? (
        <button type="button" onClick={onClick} className="grid w-full gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent">
          {body}
        </button>
      ) : (
        <div className="grid gap-0.5 px-2 py-1.5">{body}</div>
      )}
    </li>
  )
}

/** Tools the session's agent can call, its slash commands and skills, and what pi has installed. */
export function ToolsDialog({ sessionKey, path, open, onOpenChange, onInsert }: { sessionKey?: string; path?: string; open: boolean; onOpenChange: (open: boolean) => void; onInsert?: (text: string) => void }) {
  const [data, setData] = useState<SessionTools>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(undefined)
    ;(sessionKey ? api.tools(sessionKey) : api.toolsAt(path ?? ""))
      .then(setData, (e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionKey, path])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const commandGroups = [...new Set((data?.commands ?? []).map((c) => c.source))].map((source) => [source, data!.commands!.filter((c) => c.source === source)] as const)
  const resourceGroups = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((kind) => [kind, (data?.resources ?? []).filter((r) => r.kind === kind)] as const).filter(([, items]) => items.length)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            pi tools
            <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading} aria-label="Refresh">
              {loading ? <Loader2 className="animate-spin" /> : <RotateCw />}
            </Button>
          </DialogTitle>
          <DialogDescription>{sessionKey ? "What this session's agent can use. Tap a command to put it in the message box." : `What pi has in /${path ?? ""}.`}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!data && loading && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {data && (
            <>
              <Section title={`Tools (${data.tools.length})`}>
                {data.tools.map((t) => (
                  <Row key={t.name} name={t.name} badge={t.origin} description={t.description} />
                ))}
              </Section>
              {data.toolsNote && <p className="-mt-2 text-xs text-muted-foreground">{data.toolsNote}</p>}
              {commandGroups.map(([source, commands]) => (
                <Section key={source} title={SOURCE_LABEL[source] ?? source}>
                  {commands.map((c) => (
                    <Row key={c.name} name={`/${c.name}`} description={c.description} title={c.path} onClick={onInsert && (() => onInsert(`/${c.name} `))} />
                  ))}
                </Section>
              ))}
              {!data.commands && data.resources.length > 0 && <p className="text-xs text-muted-foreground">Start the session to list its slash commands; below is what is installed on disk.</p>}
              {resourceGroups.map(([kind, items]) => (
                <Section key={kind} title={`Installed ${KIND_LABEL[kind].toLowerCase()}`}>
                  {items.map((r) => (
                    <Row key={`${r.scope}:${r.path ?? r.name}`} name={r.name} badge={r.scope} description={r.description} title={r.path} />
                  ))}
                </Section>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
