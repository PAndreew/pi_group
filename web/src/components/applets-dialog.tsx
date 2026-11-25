import { useLocale } from "@/lib/i18n"
import { ChevronRight, LayoutGrid, Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type Applet } from "@/lib/api"
import { useNav } from "@/lib/nav"
import { subscribeUserEvents } from "@/lib/user-stream"

/** The applets of this tenant (plus the user's own that wait for approval); each opens its page. */
export function AppletsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t: tr } = useLocale()
  const nav = useNav()
  const [applets, setApplets] = useState<Applet[]>()
  const [error, setError] = useState<string>()
  const [installing, setInstalling] = useState(false)

  const load = useCallback(() => api.applets().then(({ applets }) => (setApplets(applets), setError(undefined)), (e: Error) => setError(e.message)), [])
  useEffect(() => {
    if (!open) return
    void load()
    return subscribeUserEvents((event) => (event.type === "applets" || event.type === "stream_open") && void load())
  }, [open, load])

  const launch = (applet: Applet) => {
    onOpenChange(false)
    nav.openApplet(applet.slug)
  }

  const install = async () => {
    setInstalling(true)
    try {
      const { applet } = await api.installTodoDump()
      launch(applet)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("ui.applets-29dfcc")}</DialogTitle>
          <DialogDescription>{tr("ui.forms-and-dashboards-for-tasks-you--68e0a2")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 grid min-h-0 min-w-0 grid-cols-1 gap-2 overflow-y-auto px-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!applets && !error && <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
          {applets && !applets.some((a) => a.slug === "todo-dump") && (
            <Button type="button" variant="outline" disabled={installing} onClick={() => void install()}>{tr("ui.add-todo-dump-2deb54")}</Button>
          )}
          {applets?.length === 0 && (
            <div className="grid justify-items-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
              <LayoutGrid className="size-8 opacity-50" />
              <p>{tr("ui.no-applets-yet-78cc4d")}</p>
              <p className="text-xs">{tr("ui.ask-the-agent-for-example-make-me-a-33c8dc")}</p>
            </div>
          )}
          {applets && applets.length > 0 && (
            <ul className="grid min-w-0 grid-cols-1 gap-2">
              {applets.map((applet) => (
                <li key={applet.id}>
                  <button type="button" onClick={() => launch(applet)} className="flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-accent">
                    <LayoutGrid className="size-5 shrink-0 text-muted-foreground" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{applet.title}</span>
                        {!applet.approved && <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">{tr("ui.needs-approval-a3b425")}</Badge>}
                        {applet.approved && applet.hasDraft && applet.canManage && <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">{tr("ui.change-waiting-b3bd3a")}</Badge>}
                      </span>
                      {applet.description && <span className="line-clamp-2 text-xs text-muted-foreground">{applet.description}</span>}
                      <span className="truncate text-[11px] text-muted-foreground">/apps/{applet.slug} · by {applet.owner}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
