import { createContext, useContext } from "react"

/** App-level navigation, for components (modals especially) that open chats, sessions and files. */
export interface Nav {
  home: () => void
  openChat: (id: string) => void
  openSession: (key: string, folder?: string) => void
  openFile: (path: string) => void
  /** Start a session in a folder with the saved defaults (or ask for them first). */
  newSession: (folder: string) => void
  /** Saved provider, model and thinking for new sessions. */
  openDefaults: () => void
}

export const NavContext = createContext<Nav | null>(null)

export function useNav() {
  const nav = useContext(NavContext)
  if (!nav) throw new Error("useNav outside NavContext")
  return nav
}
