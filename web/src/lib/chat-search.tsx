import { createContext, useContext, useMemo, useState } from "react"

/** The top bar's search box, which filters the chat list. */
interface ChatSearch {
  query: string
  setQuery: (query: string) => void
}

const ChatSearchContext = createContext<ChatSearch>({ query: "", setQuery: () => {} })

export function ChatSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("")
  const value = useMemo(() => ({ query, setQuery }), [query])
  return <ChatSearchContext.Provider value={value}>{children}</ChatSearchContext.Provider>
}

export const useChatSearch = () => useContext(ChatSearchContext)
