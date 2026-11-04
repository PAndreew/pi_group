import { Brain, Cloud, Cpu } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { CloudflareSettings } from "@/components/cloudflare-settings"
import { DefaultsSettings } from "@/components/defaults-settings"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"

/** Everything model related in one place: session defaults, Cloudflare assistance and (admins) memory consolidation. */
export function ModelSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const [consolidating, setConsolidating] = useState(false)
  const consolidate = async () => {
    setConsolidating(true)
    try {
      const r = await api.consolidateMemory()
      toast.info(r.started ? `Consolidating ${r.pending} conversation${r.pending === 1 ? "" : "s"} into memory…` : (r.reason ?? "Nothing new to consolidate."))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setConsolidating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cpu className="size-5" /> Model settings</DialogTitle>
          <DialogDescription className="sr-only">Session defaults, Cloudflare assistance and memory.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="defaults" className="min-w-0">
          <TabsList className="w-full">
            <TabsTrigger value="defaults"><Cpu /> Defaults</TabsTrigger>
            <TabsTrigger value="cloudflare"><Cloud /> Cloudflare</TabsTrigger>
            {user?.role === "admin" && <TabsTrigger value="memory"><Brain /> Memory</TabsTrigger>}
          </TabsList>
          <TabsContent value="defaults" className="pt-2">
            <DefaultsSettings onClose={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="cloudflare" className="pt-2">
            <CloudflareSettings />
          </TabsContent>
          {user?.role === "admin" && (
            <TabsContent value="memory" className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">Hand conversations not yet in long-term memory to the Memory session now, instead of waiting for the scheduled run.</p>
              <div className="flex justify-end">
                <Button onClick={() => void consolidate()} disabled={consolidating}><Brain /> Consolidate memory now</Button>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
