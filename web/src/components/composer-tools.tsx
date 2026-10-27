import { Clock, FolderOpen, Gauge, Hammer, LayoutGrid, SquareTerminal } from "lucide-react"
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
 * The tool icons, each opening its own modal: under every message box, or at the bottom of the
 * large-screen left sidebar (which replaces the ones under the box, and already shows the files).
 * With a session they act on it; without one (home screen, a chat pi has not joined yet) they act
 * on `folder`.
 */
export function ComposerTools({
  sessionKey,
  folder,
  onInsert,
  placement = "composer",
}: {
  sessionKey?: string
  folder: string
  onInsert?: (text: string) => void
  placement?: "composer" | "sidebar"
}) {
  const { user } = useAuth()
  const nav = useNav()
  const [panel, setPanel] = useState<Panel>()
  const pendingJobs = usePendingJobs()
  const pendingApplets = usePendingApplets()
  const openChange = (name: Panel) => (open: boolean) => setPanel(open ? name : undefined)
  const icon = (name: Panel, label: string, node: React.ReactNode) => (
    <Button key={name} variant="ghost" size="icon" className="composer-icon size-10 lg:size-8 [&_svg]:size-[22px] lg:[&_svg]:size-[18px]" data-active={panel === name} onClick={() => setPanel(name)} aria-label={label} title={label}>
      {node}
    </Button>
  )
  const dot = (show: boolean, node: React.ReactNode) => (
    <span className="relative">
      {node}
      {show && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-amber-500" />}
    </span>
  )

  return (
    <>
      <div className={placement === "composer" ? "flex items-center justify-center gap-0.5 xl:hidden" : "flex items-center justify-evenly gap-0.5"}>
        {user?.role === "admin" && icon("terminal", "Terminal in this folder", <SquareTerminal />)}
        {icon("tools", "Tools, skills, commands and MCP servers", <Hammer />)}
        {icon("jobs", pendingJobs ? `Scheduled jobs (${pendingJobs} waiting for approval)` : "Scheduled jobs", dot(pendingJobs > 0, <Clock />))}
        {icon("applets", pendingApplets ? `Applets (${pendingApplets} waiting for approval)` : "Applets", dot(pendingApplets > 0, <LayoutGrid />))}
        {icon("monitor", "Resource monitor", <Gauge />)}
        {placement === "composer" && icon("explorer", "Folders and files", <FolderOpen />)}
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
