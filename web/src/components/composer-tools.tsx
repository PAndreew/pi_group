import { Clock, FolderOpen, Gauge, Globe, Hammer, LayoutGrid, Paperclip, SquareTerminal } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { AppletsDialog } from "@/components/applets-dialog"
import { ExplorerDialog } from "@/components/explorer-dialog"
import { JobsDialog } from "@/components/jobs-dialog"
import { ResourceMonitorDialog } from "@/components/resource-monitor-dialog"
import { ToolsDialog } from "@/components/tools-dialog"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { usePendingApplets } from "@/hooks/use-pending-applets"
import { usePendingJobs } from "@/hooks/use-pending-jobs"
import { useNav } from "@/lib/nav"

/** xterm.js is large; load it only when someone opens a terminal. */
const TerminalDialog = lazy(() => import("@/components/terminal-dialog"))

type Panel = "terminal" | "tools" | "jobs" | "applets" | "monitor" | "explorer"

/**
 * The icons under every message box, each opening its own modal. With a session they act on it;
 * without one (home screen, a chat pi has not joined yet) they act on `folder`.
 */
export function ComposerTools({
  sessionKey,
  folder,
  onAttach,
  onInsert,
  browser,
}: {
  sessionKey?: string
  folder: string
  onAttach?: () => void
  onInsert?: (text: string) => void
  /** The session's shared browser: whether it runs, whether its panel shows, and showing or hiding it. */
  browser?: { live: boolean; shown: boolean; toggle: () => void }
}) {
  const { user } = useAuth()
  const nav = useNav()
  const [panel, setPanel] = useState<Panel>()
  const pendingJobs = usePendingJobs()
  const pendingApplets = usePendingApplets()
  const openChange = (name: Panel) => (open: boolean) => setPanel(open ? name : undefined)
  const icon = (name: Panel | "attach", label: string, node: React.ReactNode, onClick: () => void) => (
    <Button key={name} variant="ghost" size="icon" className="composer-icon size-10 [&_svg]:size-[22px]" data-active={panel === name} onClick={onClick} aria-label={label} title={label}>
      {node}
    </Button>
  )

  return (
    <>
      <div className="flex items-center justify-center gap-0.5">
        {onAttach && icon("attach", "Attach files", <Paperclip className="size-[22px]" />, onAttach)}
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
        {icon(
          "applets",
          pendingApplets ? `Applets (${pendingApplets} waiting for approval)` : "Applets",
          <span className="relative">
            <LayoutGrid className="size-[22px]" />
            {pendingApplets > 0 && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-amber-500" />}
          </span>,
          () => setPanel("applets"),
        )}
        {icon("monitor", "Resource monitor", <Gauge className="size-[22px]" />, () => setPanel("monitor"))}
        {icon("explorer", "Folders and files", <FolderOpen className="size-[22px]" />, () => setPanel("explorer"))}
        {browser && (
          <Button variant="ghost" size="icon" className="composer-icon size-10 [&_svg]:size-[22px]" data-active={browser.shown} onClick={browser.toggle} aria-label="Shared browser" title="Shared browser: open your app or any page, pick elements to reference">
            <span className="relative">
              <Globe className="size-[22px]" />
              {browser.live && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-green-500" />}
            </span>
          </Button>
        )}
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
      <AppletsDialog open={panel === "applets"} onOpenChange={openChange("applets")} />
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
