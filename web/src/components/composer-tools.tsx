import { useLocale } from "@/lib/i18n"
import { ChevronDown, Clock, Cpu, FolderOpen, Gauge, Hammer, LayoutGrid, Library, MoreHorizontal, Server, SquareTerminal, Vault } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { usePendingApplets } from "@/hooks/use-pending-applets"
import { usePendingJobs } from "@/hooks/use-pending-jobs"
import { useSurfaces } from "@/lib/surface-context"
import type { SurfaceId } from "@/lib/surfaces"

const drawerRow = "h-auto min-h-10 gap-3 px-3 py-2"

/**
 * The menu items of the left sidebar and mobile drawer: links, jobs and applets directly, everything
 * else under "More". Each opens its surface (the modals live in SurfaceDialogs, one for the app).
 */
export function ComposerTools({
  placement = "composer",
}: {
  sessionKey?: string
  folder?: string
  onInsert?: (text: string) => void
  placement?: "composer" | "sidebar"
}) {
  const { t: tr } = useLocale()
  const { user } = useAuth()
  const surfaces = useSurfaces()
  const pendingJobs = usePendingJobs()
  const pendingApplets = usePendingApplets()
  const icon = (name: SurfaceId, label: string, node: React.ReactNode) => (
    <Button key={name} variant="ghost" size="icon" className={`${drawerRow} w-full justify-start whitespace-normal text-left font-normal [&_svg]:size-4`} onClick={() => surfaces.open(name)} aria-label={label} title={label}>
      {node}<span>{label}</span>
    </Button>
  )
  const item = (name: SurfaceId, label: string, node: React.ReactNode) => (
    <DropdownMenuItem key={name} className={drawerRow} onSelect={() => surfaces.open(name)}>
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
        {icon("scheduled-jobs", pendingJobs ? tr("tools.jobsPending", { count: pendingJobs }) : tr("ui.scheduled-jobs-3fea94"), dot(pendingJobs > 0, <Clock />))}
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
            {item("resource-monitor", tr("tools.monitor"), <Gauge />)}
            {item("files", tr("tools.explorer"), <FolderOpen />)}
            {item("remote-machines", tr("tools.machines"), <Server />)}
            {item("vault", tr("tools.vault"), <Vault />)}
            {item("model-settings", tr("tools.models"), <Cpu />)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
