import { ChevronRight, Loader2, RotateCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type McpServer, type SessionTools } from "@/lib/api"
import { cn } from "@/lib/utils"

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
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="whitespace-normal font-mono text-[13px]">{name}</span>
        {badge && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            {badge}
          </Badge>
        )}
      </span>
      {description && <span className="whitespace-normal text-xs text-muted-foreground">{description}</span>}
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

function stateColor(server: McpServer) {
  if (!server.enabled) return "bg-muted-foreground/40"
  if (server.error || /fail|error/i.test(server.state ?? "")) return "bg-red-500"
  if (/connect(ed)?$|ready|ok/i.test(server.state ?? "")) return "bg-green-500"
  return "bg-amber-500"
}

function ServerRow({ server }: { server: McpServer }) {
  const [expanded, setExpanded] = useState(false)
  const tools = server.tools ?? []
  return (
    <li className="rounded-md border px-3 py-2">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded((e) => !e)} disabled={!tools.length}>
        <span className={cn("size-2 shrink-0 rounded-full", stateColor(server))} />
        <span className="min-w-0 flex-1 whitespace-normal font-mono text-[13px]">{server.name}</span>
        {server.scope && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            {server.scope}
          </Badge>
        )}
        {server.transport && <span className="text-[11px] text-muted-foreground">{server.transport}</span>}
        <span className="text-[11px] text-muted-foreground tabular-nums">{server.enabled ? (server.tools ? `${tools.length} tools` : server.state) : "disabled"}</span>
        {tools.length > 0 && <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} />}
      </button>
      {server.error && <p className="mt-1 text-xs break-words text-destructive">{server.error}</p>}
      {server.target && <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground" title={server.target}>{server.target}</p>}
      {expanded && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {tools.map((tool) => (
            <li key={tool}>
              <Badge variant="secondary" className="font-mono text-[11px] font-normal">
                {tool}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Tools the session's agent can call, its slash commands and skills, MCP servers, and what pi has installed. */
export function ToolsDialog({ sessionKey, path, open, onOpenChange, onInsert }: { sessionKey?: string; path?: string; open: boolean; onOpenChange: (open: boolean) => void; onInsert?: (text: string) => void }) {
  const [data, setData] = useState<SessionTools>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const [mcp, setMcp] = useState<{ servers: McpServer[]; live: boolean; note?: string }>()
  const [mcpError, setMcpError] = useState<string>()
  const [mcpLoading, setMcpLoading] = useState(false)

  // MCP servers are probed separately: connecting to them can take a while and should not hold up the rest.
  const load = useCallback(() => {
    setLoading(true)
    setError(undefined)
    ;(sessionKey ? api.tools(sessionKey) : api.toolsAt(path ?? ""))
      .then(setData, (e: Error) => setError(e.message))
      .finally(() => setLoading(false))
    setMcpLoading(true)
    setMcpError(undefined)
    ;(sessionKey ? api.mcp(sessionKey) : api.mcpAt(path ?? ""))
      .then(setMcp, (e: Error) => setMcpError(e.message))
      .finally(() => setMcpLoading(false))
  }, [sessionKey, path])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const commandGroups = [...new Set((data?.commands ?? []).map((c) => c.source))].map((source) => [source, data!.commands!.filter((c) => c.source === source)] as const)
  const resourceGroups = (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((kind) => [kind, (data?.resources ?? []).filter((r) => r.kind === kind)] as const).filter(([, items]) => items.length)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tools-dialog flex max-h-[85dvh] min-w-0 flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Tools
            <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading || mcpLoading} aria-label="Refresh">
              {loading || mcpLoading ? <Loader2 className="animate-spin" /> : <RotateCw />}
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
              <section className="grid gap-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">MCP servers{mcp ? ` (${mcp.servers.length})` : ""}</h3>
                {mcpError && <p className="text-sm text-destructive">{mcpError}</p>}
                {!mcp && mcpLoading && (
                  <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Connecting to servers…
                  </p>
                )}
                {mcp && mcp.servers.length === 0 && !mcp.note && <p className="px-2 text-xs text-muted-foreground">No MCP servers configured.</p>}
                {mcp && mcp.servers.length > 0 && (
                  <ul className="grid gap-2">
                    {mcp.servers.map((server) => (
                      <ServerRow key={server.name} server={server} />
                    ))}
                  </ul>
                )}
                {mcp?.note && <p className="text-xs text-muted-foreground">{mcp.note}</p>}
                <p className="text-xs text-muted-foreground">
                  From <code>~/.pi/agent/mcp.json</code> and the project's <code>.pi/mcp.json</code>; manage them with <code>pi mcp add|remove</code> in the terminal.
                </p>
              </section>
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
