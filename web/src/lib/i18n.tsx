import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import english from "@/locales/en.json"

export type MessageKey = keyof typeof english.messages
type Messages = Partial<Record<MessageKey, string>>
type Catalog = { name: string; messages: Messages }
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

const catalogs = Object.fromEntries(Object.entries(import.meta.glob<Catalog>("../locales/*.json", { eager: true, import: "default" }))
  .map(([path, catalog]) => [path.split("/").at(-1)!.slice(0, -5), catalog]))
export const languages = Object.entries(catalogs).map(([code, { name }]) => ({ code, name }))
const storageKey = "pi-group:language"

function translate(messages: Messages): Translate {
  return (key, values) => (messages[key] ?? english.messages[key]).replace(/\{(\w+)\}/g, (token, name: string) => {
    const value = values?.[name]
    return value === undefined ? token : String(value)
  })
}

const LocaleContext = createContext({ language: "en", setLanguage: (_code: string) => {}, t: translate(english.messages) })

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved && Object.hasOwn(catalogs, saved) ? saved : "en"
  })
  const locale = useMemo(() => ({ language, setLanguage, t: translate(catalogs[language].messages) }), [language])
  useEffect(() => {
    document.documentElement.lang = language
    localStorage.setItem(storageKey, language)
  }, [language])
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export const useLocale = () => useContext(LocaleContext)
