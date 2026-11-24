import { useState } from "react"
import { Cpu } from "lucide-react"
import { DefaultsSettings } from "@/components/defaults-settings"
import { PiProfileSettings } from "@/components/pi-profile-settings"
import { ProjectMemorySettings } from "@/components/project-memory-settings"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Section } from "@/components/ui/section"

/** Model settings as accordions: defaults with the providers they pick from, then project memory's parts. */
export function ModelSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // A newly connected provider brings new models; remount the defaults so they list them.
  const [providers, setProviders] = useState(0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cpu className="size-5" /> Model settings</DialogTitle>
          <DialogDescription className="sr-only">Session defaults, providers and project memory.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <Section title="Defaults & providers" hint="Runtime, model and reasoning for new sessions" icon={<Cpu />} defaultOpen>
            <DefaultsSettings key={providers} onClose={() => onOpenChange(false)} />
            <div className="border-t pt-3">
              <PiProfileSettings onConnected={() => setProviders((n) => n + 1)} />
            </div>
          </Section>
          <ProjectMemorySettings />
        </div>
      </DialogContent>
    </Dialog>
  )
}
