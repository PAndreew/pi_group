import { Bot, FolderOpen, Gauge, Hammer, Paperclip, SquareTerminal } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { ExplorerDialog } from "@/components/explorer-dialog"
import { McpDialog, McpIcon } from "@/components/mcp-dialog"
import { ResourceMonitorDialog } from "@/components/resource-monitor-dialog"
import { ToolsDialog } from "@/components/tools-dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useNav } from "@/lib/nav"

/** xterm.js is large; load it only when someone opens a terminal. */
const TerminalDialog = lazy(() => import("@/components/terminal-dialog"))

type Panel = "terminal" | "tools" | "mcp" | "monitor" | "explorer"

/**
 * The icons under every message box, each opening its own modal. With a session they act on it;
 * without one (home screen, a chat pi has not joined yet) they act on `folder`.
 */
export function ComposerTools({
  sessionKey,
  folder,
  onAttach,
  onModel,
  onInsert,
}: {
  sessionKey?: string
  folder: string
  onAttach?: () => void
  /** Defaults to the saved session defaults when there is no session. */
  onModel?: () => void
  onInsert?: (text: string) => void
}) {
  const { user } = useAuth()
  const nav = useNav()
  const [panel, setPanel] = useState<Panel>()
  const openChange = (name: Panel) => (open: boolean) => setPanel(open ? name : undefined)
  const icon = (name: Panel | "attach" | "model", label: string, node: React.ReactNode, onClick: () => void) => (
    <Button key={name} variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} title={label}>
      {node}
    </Button>
  )

  return (
    <>
      <div className="flex items-center justify-center gap-0.5">
        {onAttach && icon("attach", "Attach files", <Paperclip />, onAttach)}
        {icon("model", sessionKey ? "Provider, model and thinking" : "Defaults for new sessions", <Bot />, onModel ?? nav.openDefaults)}
        {user?.role === "admin" && icon("terminal", "Terminal in this folder", <SquareTerminal />, () => setPanel("terminal"))}
        {icon("tools", "pi tools, commands and skills", <Hammer />, () => setPanel("tools"))}
        {icon("mcp", "MCP servers", <McpIcon />, () => setPanel("mcp"))}
        {icon("monitor", "Resource monitor", <Gauge />, () => setPanel("monitor"))}
        {icon("explorer", "Folders and files", <FolderOpen />, () => setPanel("explorer"))}
      </div>
      <ToolsDialog
        sessionKey={sessionKey}
        path={folder}
        open={panel === "tools"}
        onOpenChange={openChange("tools")}
        onInsert={
          onInsert &&
          ((text) => {
            onInsert(text)
            setPanel(undefined)
          })
        }
      />
      <McpDialog sessionKey={sessionKey} path={folder} open={panel === "mcp"} onOpenChange={openChange("mcp")} />
      <ResourceMonitorDialog open={panel === "monitor"} onOpenChange={openChange("monitor")} onOpenSession={(s) => nav.openSession(s.key, s.path)} />
      <ExplorerDialog folder={folder} open={panel === "explorer"} onOpenChange={openChange("explorer")} />
      {panel === "terminal" && (
        <Suspense>
          <TerminalDialog sessionKey={sessionKey} path={folder} title={`/${folder}`} open onOpenChange={(o) => !o && setPanel(undefined)} />
        </Suspense>
      )}
    </>
  )
}
