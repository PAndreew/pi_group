import { createContext, useContext } from "react"

/** App-level navigation, for components (modals especially) that open chats, sessions and files. */
export interface Nav {
  home: () => void
  openChat: (id: string) => void
  openSession: (key: string, folder?: string) => void
  openFile: (path: string) => void
  /** The folders-and-files modal, starting at `folder`; it comes back when a file opened from it is closed. */
  openExplorer: (folder: string) => void
  openApplet: (slug: string) => void
  /** Start a session in a folder with the saved defaults (or ask for them first). */
  newSession: (folder: string, options?: { browser?: boolean; model?: { provider: string; id: string }; thinkingLevel?: string }) => void
}

export const NavContext = createContext<Nav | null>(null)

export function useNav() {
  const nav = useContext(NavContext)
  if (!nav) throw new Error("useNav outside NavContext")
  return nav
}
