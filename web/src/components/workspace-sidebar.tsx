import { FileText } from "lucide-react"
import { ComposerTools } from "@/components/composer-tools"
import { TenantPicker } from "@/components/tenant-picker"
import { cn } from "@/lib/utils"

/** Shared navigation for the mobile drawer and permanent desktop menu. */
export function WorkspaceSidebar({ folder, sessionKey, lastEdit, onLastEdit, className, children }: {
  folder: string
  sessionKey?: string
  selectedFile?: string
  lastEdit?: string
  onLastEdit?: () => void
  className?: string
  children?: React.ReactNode
}) {
  return (
    <aside className={cn("flex min-h-0 flex-col overflow-y-auto border-r", className)} aria-label="Menu">
      <div className="p-2">
        <ComposerTools sessionKey={sessionKey} folder={folder} placement="sidebar" />
        {lastEdit && <button type="button" onClick={onLastEdit} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"><FileText className="size-4 shrink-0" /><span className="truncate">Last edited: {lastEdit.split("/").pop()}</span></button>}
      </div>
      <div className="flex flex-col items-start gap-2 border-t p-3">
        <span className="font-lato text-xs font-medium text-muted-foreground">Tenant</span>
        <TenantPicker />
        <span className="font-lato mt-2 text-xs font-medium text-muted-foreground">Running sessions</span>
        {children}
      </div>
    </aside>
  )
}
