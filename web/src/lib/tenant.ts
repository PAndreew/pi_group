// A page is permanently pinned to its starting tenant. Switching changes
// storage and reloads; old unload handlers must never save Work state as Family.
const active = localStorage.getItem("pi-group:tenant") || "work"
export const activeTenant = () => active
export function setActiveTenant(id: string) {
  localStorage.setItem("pi-group:tenant", id)
}
export const tenantUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}tenant=${encodeURIComponent(active)}`
