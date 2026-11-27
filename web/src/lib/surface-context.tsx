import { createContext, useContext } from "react"
import type { SurfaceId, SurfaceParams } from "@/lib/surfaces"

/** Opens parts of the app (see lib/surfaces.ts) from anywhere: the sidebar, agent buttons, the command palette. */
export interface Surfaces {
  open: (id: SurfaceId, params?: SurfaceParams) => void
  openPalette: () => void
}

export const SurfaceContext = createContext<Surfaces | null>(null)

export function useSurfaces() {
  const surfaces = useContext(SurfaceContext)
  if (!surfaces) throw new Error("useSurfaces outside SurfaceContext")
  return surfaces
}
