import { ChevronRight, Loader2, RotateCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type McpServer } from "@/lib/api"
import { cn } from "@/lib/utils"

/** The Model Context Protocol logo. */
export function McpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={cn("size-4", className)} aria-hidden="true">
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
    </svg>
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
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{server.name}</span>
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
      {server.target && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={server.target}>{server.target}</p>}
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

/** MCP servers this session's agent can use, with their live connection state when pi can report it. */
export function McpDialog({ sessionKey, open, onOpenChange }: { sessionKey: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<{ servers: McpServer[]; live: boolean; note?: string }>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(undefined)
    api
      .mcp(sessionKey)
      .then(setData, (e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionKey])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <McpIcon /> MCP servers
            <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading} aria-label="Refresh">
              {loading ? <Loader2 className="animate-spin" /> : <RotateCw />}
            </Button>
          </DialogTitle>
          <DialogDescription>
            From <code className="text-xs">~/.pi/agent/mcp.json</code> and the project's <code className="text-xs">.pi/mcp.json</code>. Manage them with <code className="text-xs">pi mcp add|remove</code> in the terminal.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 grid min-h-0 gap-3 overflow-y-auto px-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!data && loading && (
            <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" /> Connecting to servers…
            </p>
          )}
          {data && data.servers.length === 0 && !data.note && <p className="py-4 text-center text-sm text-muted-foreground">No MCP servers configured.</p>}
          {data && data.servers.length > 0 && (
            <ul className="grid gap-2">
              {data.servers.map((s) => (
                <ServerRow key={s.name} server={s} />
              ))}
            </ul>
          )}
          {data?.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
