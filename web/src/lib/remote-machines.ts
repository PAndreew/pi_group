import { api, type RemoteMachine } from "@/lib/api"

let cached: { at: number; list: Promise<RemoteMachine[]> } | undefined

/** The machines # suggests, fetched at most every 30 seconds. */
export function remoteMachines(): Promise<RemoteMachine[]> {
  if (!cached || Date.now() - cached.at > 30_000) cached = { at: Date.now(), list: api.remoteMachines().then((r) => r.machines, () => []) }
  return cached.list
}

/** Machines whose name contains `query`, those starting with it first. */
export function matchMachines(list: RemoteMachine[], query: string) {
  const q = query.toLowerCase()
  return list
    .filter((m) => m.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, 8)
}
