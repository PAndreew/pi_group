import { useLocale } from "@/lib/i18n"
import { ChevronDown, Clock, Cpu, FolderOpen, Gauge, Hammer, LayoutGrid, Library, MoreHorizontal, Server, SquareTerminal, Vault } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { AppletsDialog } from "@/components/applets-dialog"
import { JobsDialog } from "@/components/jobs-dialog"
import { LinksDialog } from "@/components/links-dialog"
import { ModelSettingsDialog } from "@/components/model-settings-dialog"
import { RemoteMachinesDialog } from "@/components/remote-machines-dialog"
import { ResourceMonitorDialog } from "@/components/resource-monitor-dialog"
import { ToolsDialog } from "@/components/tools-dialog"
import { VaultDialog } from "@/components/vault-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { usePendingApplets } from "@/hooks/use-pending-applets"
import { usePendingJobs } from "@/hooks/use-pending-jobs"
import { useNav } from "@/lib/nav"

/** xterm.js is large; load it only when someone opens a terminal. */
const TerminalDialog = lazy(() => import("@/components/terminal-dialog"))

type Panel = "links" | "terminal" | "tools" | "jobs" | "applets" | "monitor" | "vault" | "models" | "machines"

const drawerRow = "h-auto min-h-10 gap-3 px-3 py-2"

/**
 * The menu items of the left sidebar and mobile drawer, each opening its own modal: links, jobs and
 * applets directly, everything else under "More".
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
  const { t: tr } = useLocale()
  const { user } = useAuth()
  const nav = useNav()
  const [panel, setPanel] = useState<Panel>()
  const pendingJobs = usePendingJobs()
  const pendingApplets = usePendingApplets()
  const openChange = (name: Panel) => (open: boolean) => setPanel(open ? name : undefined)
  const icon = (name: Panel | "explorer", label: string, node: React.ReactNode) => (
    <Button key={name} variant="ghost" size="icon" className={`${drawerRow} w-full justify-start whitespace-normal text-left font-normal [&_svg]:size-4`} data-active={panel === name} onClick={() => (name === "explorer" ? nav.openExplorer(folder) : setPanel(name))} aria-label={label} title={label}>
      {node}<span>{label}</span>
    </Button>
  )
  const item = (name: Panel | "explorer", label: string, node: React.ReactNode) => (
    <DropdownMenuItem key={name} className={drawerRow} onSelect={() => (name === "explorer" ? nav.openExplorer(folder) : setPanel(name))}>
      {node}
      {label}
    </DropdownMenuItem>
  )
  const dot = (show: boolean, node: React.ReactNode) => (
    <span className="relative">
      {node}
      {show && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-amber-500" />}
    </span>
  )

  if (placement === "composer") return null

  return (
    <>
      <div className="flex flex-col items-stretch gap-1">
        {icon("links", tr("ui.links-014bcd"), <Library />)}
        {icon("jobs", pendingJobs ? tr("tools.jobsPending", { count: pendingJobs }) : tr("ui.scheduled-jobs-3fea94"), dot(pendingJobs > 0, <Clock />))}
        {icon("applets", pendingApplets ? tr("tools.appletsPending", { count: pendingApplets }) : tr("ui.applets-29dfcc"), dot(pendingApplets > 0, <LayoutGrid />))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={`${drawerRow} w-full justify-start text-left font-normal [&_svg]:size-4`} aria-label={tr("ui.more-4bab2d")}>
              <MoreHorizontal />
              <span className="flex-1">{tr("ui.more-4bab2d")}</span>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56 space-y-1">
            {user?.role === "admin" && item("terminal", tr("tools.terminal"), <SquareTerminal />)}
            {item("tools", tr("tools.tools"), <Hammer />)}
            {item("monitor", tr("tools.monitor"), <Gauge />)}
            {item("explorer", tr("tools.explorer"), <FolderOpen />)}
            {item("machines", tr("tools.machines"), <Server />)}
            {item("vault", tr("tools.vault"), <Vault />)}
            {item("models", tr("tools.models"), <Cpu />)}
          </DropdownMenuContent>
        </DropdownMenu>
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
      <LinksDialog open={panel === "links"} onOpenChange={openChange("links")} />
      <JobsDialog open={panel === "jobs"} onOpenChange={openChange("jobs")} />
      <AppletsDialog open={panel === "applets"} onOpenChange={openChange("applets")} />
      <ResourceMonitorDialog open={panel === "monitor"} onOpenChange={openChange("monitor")} onOpenSession={(s) => nav.openSession(s.key, s.path)} />
      <VaultDialog open={panel === "vault"} onOpenChange={openChange("vault")} />
      <ModelSettingsDialog open={panel === "models"} onOpenChange={openChange("models")} />
      <RemoteMachinesDialog open={panel === "machines"} onOpenChange={openChange("machines")} />
      {panel === "terminal" && (
        <Suspense>
          <TerminalDialog sessionKey={sessionKey} path={folder} title={`/${folder}`} open onOpenChange={(o) => !o && setPanel(undefined)} />
        </Suspense>
      )}
    </>
  )
}
