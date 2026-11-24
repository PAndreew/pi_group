import { Server, X } from "lucide-react"
import { useEffect, useState } from "react"
import { StatusDot } from "@/components/remote-machines-dialog"
import type { RemoteMachine } from "@/lib/api"
import { matchMachines, remoteMachines } from "@/lib/remote-machines"

/** #machine suggestions for the direct-session composer; picking one completes the #name being typed. */
export function MachineDropup({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [machines, setMachines] = useState<RemoteMachine[]>([])
  const [dismissed, setDismissed] = useState<string>()
  const match = /(^|\s)#([\w.-]*)$/.exec(value)
  const query = match?.[2]
  useEffect(() => {
    if (query === undefined) return
    let alive = true
    void remoteMachines().then((list) => alive && setMachines(list))
    return () => { alive = false }
  }, [query])
  const found = query === undefined ? [] : matchMachines(machines, query)
  if (!match || dismissed === value || !found.length) return null
  return (
    <div data-suggestions className="absolute bottom-full left-0 z-20 mb-1 flex max-h-64 w-full max-w-sm flex-col rounded-md border bg-[var(--composer-background)] text-[var(--composer-foreground)] shadow-md">
      <div className="flex shrink-0 justify-end px-1 pt-1">
        <button type="button" aria-label="Dismiss machine suggestions" className="rounded p-1.5 hover:bg-accent" onClick={() => setDismissed(value)}><X className="size-4" /></button>
      </div>
      <div className="chat-scroll-fade min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {found.map((m) => (
          <button type="button" key={m.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange(`${value.slice(0, value.length - match[2].length)}${m.name} `)}>
            <MachineOption machine={m} />
          </button>
        ))}
      </div>
    </div>
  )
}

export function MachineOption({ machine: m }: { machine: RemoteMachine }) {
  return <>
    <Server className="size-4 shrink-0 text-muted-foreground" />
    <span className="min-w-0 truncate font-medium">#{m.name}</span>
    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{m.user ? `${m.user}@` : ""}{m.host ?? m.alias}</span>
    <StatusDot machine={m} />
  </>
}
