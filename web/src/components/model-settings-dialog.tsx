import { Brain, Cloud, Cpu } from "lucide-react"
import { CloudflareSettings } from "@/components/cloudflare-settings"
import { DefaultsSettings } from "@/components/defaults-settings"
import { ProjectMemorySettings } from "@/components/project-memory-settings"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function ModelSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cpu className="size-5" /> Model settings</DialogTitle>
          <DialogDescription className="sr-only">Session defaults, Cloudflare assistance and project memory.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="defaults" className="min-w-0">
          <TabsList className="w-full">
            <TabsTrigger value="defaults"><Cpu /> Defaults</TabsTrigger>
            <TabsTrigger value="cloudflare"><Cloud /> Cloudflare</TabsTrigger>
            <TabsTrigger value="memory"><Brain /> Project memory</TabsTrigger>
          </TabsList>
          <TabsContent value="defaults" className="pt-2"><DefaultsSettings onClose={() => onOpenChange(false)} /></TabsContent>
          <TabsContent value="cloudflare" className="pt-2"><CloudflareSettings /></TabsContent>
          <TabsContent value="memory" className="pt-2"><ProjectMemorySettings /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
