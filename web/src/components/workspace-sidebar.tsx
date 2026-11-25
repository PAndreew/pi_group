import { FileText } from "lucide-react"
import { ComposerTools } from "@/components/composer-tools"
import { TenantPicker } from "@/components/tenant-picker"
import { useLocale } from "@/lib/i18n"
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
  const { t } = useLocale()
  return (
    <aside className={cn("flex min-h-0 flex-col overflow-y-auto border-r font-normal [&_.font-medium]:font-normal", className)} aria-label={t("nav.menu")}>
      <div className="p-2">
        <ComposerTools sessionKey={sessionKey} folder={folder} placement="sidebar" />
      </div>
      <div className="flex flex-col items-start gap-2 border-t p-3">
        <span className="text-xs font-medium text-muted-foreground">{t("nav.tenant")}</span>
        <TenantPicker />
        <span className="mt-2 text-xs font-medium text-muted-foreground">{t("nav.runningSessions")}</span>
        {children}
        {lastEdit && <>
          <span className="mt-2 text-xs font-medium text-muted-foreground">{t("nav.lastEdited")}</span>
          <button type="button" onClick={onLastEdit} title={lastEdit} className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent">
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{lastEdit.split("/").pop()}</span>
          </button>
        </>}
      </div>
    </aside>
  )
}
