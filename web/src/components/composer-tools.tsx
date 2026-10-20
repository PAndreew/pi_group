import { Bot, Clock, FolderOpen, Gauge, Hammer, Paperclip, SquareTerminal } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { ExplorerDialog } from "@/components/explorer-dialog"
import { JobsDialog } from "@/components/jobs-dialog"
import { ResourceMonitorDialog } from "@/components/resource-monitor-dialog"
import { ToolsDialog } from "@/components/tools-dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { usePendingJobs } from "@/hooks/use-pending-jobs"
import { useNav } from "@/lib/nav"

/** xterm.js is large; load it only when someone opens a terminal. */
const TerminalDialog = lazy(() => import("@/components/terminal-dialog"))

type Panel = "terminal" | "tools" | "jobs" | "monitor" | "explorer"

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
  const pendingJobs = usePendingJobs()
  const openChange = (name: Panel) => (open: boolean) => setPanel(open ? name : undefined)
  const icon = (name: Panel | "attach" | "model", label: string, node: React.ReactNode, onClick: () => void) => (
    <Button key={name} variant="ghost" size="icon" className="composer-icon size-10 [&_svg]:size-[22px]" data-active={panel === name} onClick={onClick} aria-label={label} title={label}>
      {node}
    </Button>
  )

  return (
    <>
      <div className="flex items-center justify-center gap-0.5">
        {onAttach && icon("attach", "Attach files", <Paperclip className="size-[22px]" />, onAttach)}
        {icon("model", sessionKey ? "Provider, model and thinking" : "Defaults for new sessions", <Bot className="size-[22px]" />, onModel ?? nav.openDefaults)}
        {user?.role === "admin" && icon("terminal", "Terminal in this folder", <SquareTerminal className="size-[22px]" />, () => setPanel("terminal"))}
        {icon("tools", "Tools, skills, commands and MCP servers", <Hammer className="size-[22px]" />, () => setPanel("tools"))}
        {icon(
          "jobs",
          pendingJobs ? `Scheduled jobs (${pendingJobs} waiting for approval)` : "Scheduled jobs",
          <span className="relative">
            <Clock className="size-[22px]" />
            {pendingJobs > 0 && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-amber-500" />}
          </span>,
          () => setPanel("jobs"),
        )}
        {icon("monitor", "Resource monitor", <Gauge className="size-[22px]" />, () => setPanel("monitor"))}
        {icon("explorer", "Folders and files", <FolderOpen className="size-[22px]" />, () => setPanel("explorer"))}
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
      <JobsDialog open={panel === "jobs"} onOpenChange={openChange("jobs")} />
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
