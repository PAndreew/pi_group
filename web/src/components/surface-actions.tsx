import { ArrowUpRight, Clock, Cpu, FolderOpen, Gauge, Hammer, LayoutGrid, Library, MessageSquarePlus, Server, SquareTerminal, Users, Vault } from "lucide-react"
import { useContext } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useLocale } from "@/lib/i18n"
import { SurfaceContext, type Surfaces } from "@/lib/surface-context"
import { canOpen, parseActions, surface, type SurfaceId } from "@/lib/surfaces"

const icons: Record<SurfaceId, typeof Clock> = {
  "scheduled-jobs": Clock,
  applets: LayoutGrid,
  links: Library,
  "new-session": MessageSquarePlus,
  files: FolderOpen,
  "remote-machines": Server,
  vault: Vault,
  "model-settings": Cpu,
  tools: Hammer,
  "resource-monitor": Gauge,
  terminal: SquareTerminal,
  users: Users,
}

export function SurfaceIcon({ id, className }: { id: SurfaceId; className?: string }) {
  const Icon = icons[id]
  return <Icon className={className} aria-hidden="true" />
}

/**
 * A ```beezy-action block in a message: buttons that open parts of the app, with the agent's prefills.
 * Ones the reader may not open (admin-only for non-admins) are left out; with none left, nothing shows.
 */
export function SurfaceActionBlock({ source }: { source: string }) {
  // Outside the workspace (no way to open anything) the block shows nothing.
  const surfaces = useContext(SurfaceContext)
  return surfaces ? <Actions source={source} surfaces={surfaces} /> : null
}

function Actions({ source, surfaces }: { source: string; surfaces: Surfaces }) {
  const { t } = useLocale()
  const { user } = useAuth()
  const actions = parseActions(source).filter((a) => canOpen(surface(a.open), user?.role))
  if (!actions.length) return null
  return (
    <div className="not-prose my-2 flex flex-wrap gap-2" data-surface-actions>
      {actions.map((action, i) => {
        const name = t(surface(action.open)!.label)
        return (
          <Button key={i} type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full gap-2 rounded-full bg-background/60 py-1.5 whitespace-normal text-left" title={name} onClick={() => surfaces.open(action.open, action.params)}>
            <SurfaceIcon id={action.open} className="size-4 shrink-0" />
            <span className="min-w-0 wrap-anywhere">{action.label ?? name}</span>
            <ArrowUpRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        )
      })}
    </div>
  )
}
