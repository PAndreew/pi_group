import { lazy, Suspense } from "react"
import { AppletsDialog } from "@/components/applets-dialog"
import { JobsDialog } from "@/components/jobs-dialog"
import { LinksDialog } from "@/components/links-dialog"
import { ModelSettingsDialog } from "@/components/model-settings-dialog"
import { RemoteMachinesDialog } from "@/components/remote-machines-dialog"
import { ResourceMonitorDialog } from "@/components/resource-monitor-dialog"
import { ToolsDialog } from "@/components/tools-dialog"
import { VaultDialog } from "@/components/vault-dialog"
import { useNav } from "@/lib/nav"
import type { SurfaceId, SurfaceParams } from "@/lib/surfaces"

/** xterm.js is large; load it only when someone opens a terminal. */
const TerminalDialog = lazy(() => import("@/components/terminal-dialog"))

export interface OpenSurface {
  id: SurfaceId
  params: SurfaceParams
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/** The modals behind the app's surfaces; one is open at a time. Files, new session and users open elsewhere. */
export function SurfaceDialogs({ current, onClose, sessionKey, folder }: { current?: OpenSurface; onClose: () => void; sessionKey?: string; folder: string }) {
  const nav = useNav()
  const is = (id: SurfaceId) => current?.id === id
  const change = (open: boolean) => !open && onClose()
  const params = current?.params ?? {}
  return (
    <>
      <ToolsDialog sessionKey={sessionKey} path={folder} open={is("tools")} onOpenChange={change} />
      <LinksDialog open={is("links")} onOpenChange={change} />
      <JobsDialog open={is("scheduled-jobs")} onOpenChange={change} />
      <AppletsDialog open={is("applets")} onOpenChange={change} />
      <ResourceMonitorDialog open={is("resource-monitor")} onOpenChange={change} onOpenSession={(s) => nav.openSession(s.key, s.path)} />
      <VaultDialog open={is("vault")} onOpenChange={change} prefill={is("vault") && text(params.key) ? { key: text(params.key)!, description: text(params.description) } : undefined} />
      <ModelSettingsDialog open={is("model-settings")} onOpenChange={change} />
      <RemoteMachinesDialog open={is("remote-machines")} onOpenChange={change} prefill={is("remote-machines") && text(params.host) ? { host: text(params.host)!, name: text(params.name) } : undefined} />
      {is("terminal") && (
        <Suspense>
          <TerminalDialog sessionKey={sessionKey} path={folder} title={`/${folder}`} open onOpenChange={change} />
        </Suspense>
      )}
    </>
  )
}
