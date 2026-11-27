import type { MessageKey } from "@/lib/i18n"

/*
 * The parts of the app that agent buttons (```beezy-action blocks) and the command palette open.
 * The ids match server/extensions/lib/app-guide.mjs, which tells agents about them (test/surfaces.test.mjs
 * checks both lists agree). `admin` ones are hidden from everyone else.
 */

export type SurfaceId =
  | "remote-machines"
  | "scheduled-jobs"
  | "applets"
  | "vault"
  | "model-settings"
  | "tools"
  | "resource-monitor"
  | "files"
  | "links"
  | "new-session"
  | "terminal"
  | "users"

export interface Surface {
  id: SurfaceId
  /** Locale key of its name. */
  label: MessageKey
  admin?: boolean
  /** Extra words the command palette matches. */
  keywords: string
}

export const SURFACES: Surface[] = [
  { id: "scheduled-jobs", label: "ui.scheduled-jobs-3fea94", keywords: "cron schedule recurring reminder later every" },
  { id: "applets", label: "ui.applets-29dfcc", keywords: "apps forms buttons" },
  { id: "links", label: "ui.links-014bcd", keywords: "urls bookmarks" },
  { id: "new-session", label: "surfaces.newSession", keywords: "start agent pi browser" },
  { id: "files", label: "tools.explorer", keywords: "folders explorer upload browse" },
  { id: "remote-machines", label: "tools.machines", keywords: "ssh servers hosts gpu" },
  { id: "vault", label: "tools.vault", keywords: "secrets passwords keys tokens" },
  { id: "model-settings", label: "tools.models", keywords: "models providers defaults memory context" },
  { id: "tools", label: "tools.tools", keywords: "skills extensions mcp" },
  { id: "resource-monitor", label: "tools.monitor", keywords: "cpu memory disk usage cost" },
  { id: "terminal", label: "tools.terminal", admin: true, keywords: "shell console bash" },
  { id: "users", label: "profile.users", admin: true, keywords: "people accounts roles" },
]

const byId = new Map(SURFACES.map((s) => [s.id, s]))
export const surface = (id: string) => byId.get(id as SurfaceId)
export const canOpen = (s: Surface | undefined, role?: string): s is Surface => Boolean(s && (!s.admin || role === "admin"))

export type SurfaceParams = Record<string, string | boolean | number>

export interface SurfaceAction {
  open: SurfaceId
  label?: string
  params: SurfaceParams
}

/** A ```beezy-action block: one object or an array of up to 3. Unknown ids and bad entries are dropped. */
export function parseActions(source: string): SurfaceAction[] {
  let raw: unknown
  try { raw = JSON.parse(source) } catch { return [] }
  const items = Array.isArray(raw) ? raw : [raw]
  return items.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const { open, label, params } = item as { open?: unknown; label?: unknown; params?: unknown }
    if (typeof open !== "string" || !surface(open)) return []
    const clean: SurfaceParams = {}
    if (params && typeof params === "object" && !Array.isArray(params))
      for (const [k, v] of Object.entries(params)) if (["string", "boolean", "number"].includes(typeof v)) clean[k] = typeof v === "string" ? v.slice(0, 500) : (v as boolean | number)
    return [{ open: open as SurfaceId, label: typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : undefined, params: clean }]
  }).slice(0, 3)
}

/** Words of `query` all found in `text` (case-insensitive), for the palette's filter. */
export function matches(query: string, text: string) {
  const hay = text.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word))
}
