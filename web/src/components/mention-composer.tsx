import { ArrowUp, Folder, Loader2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { AuthorAvatar } from "@/components/author-avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface Person {
  id: string
  username: string
}

export interface ParsedMessage {
  /** What was typed, mentions included. */
  raw: string
  /** Without the @ and # mentions. */
  text: string
  pi: boolean
  people: Person[]
  folder?: string
}

/** Folder mentions keep spaces as no-break spaces so a #path stays one token. */
const NBSP = "\u00a0"
const MENTION = /(^|\s)@([\w.-]+)/g
const FOLDER = /(^|\s)#(\S+)/g

let directory: Promise<Person[]> | undefined
const people = () => (directory ??= api.directory().then((d) => d.users, () => []))

export function parseMessage(raw: string, everyone: Person[]): ParsedMessage {
  const names = [...raw.matchAll(MENTION)].map((m) => m[2].toLowerCase())
  const mentioned = everyone.filter((p) => names.includes(p.username.toLowerCase()))
  const folders = [...raw.matchAll(FOLDER)].map((m) => m[2].replaceAll(NBSP, " "))
  const known = new Set(["pi", ...mentioned.map((p) => p.username.toLowerCase())])
  const text = raw
    .replace(MENTION, (all, lead, name) => (known.has(String(name).toLowerCase()) ? lead : all))
    .replace(FOLDER, (_all, lead) => lead)
    .replace(/[ \t]+/g, " ")
    .trim()
  return { raw: raw.trim(), text, pi: names.includes("pi"), people: mentioned, folder: folders.at(-1) }
}

type Suggestion = { kind: "pi" } | { kind: "person"; person: Person } | { kind: "folder"; path: string } | { kind: "skill"; name: string; description?: string }

/** The token being typed at the caret, if it is a mention. */
function activeToken(value: string, caret: number) {
  const match = /(^|\s)([@#/])([^\s@#]*)$/.exec(value.slice(0, caret))
  return match ? { trigger: match[2] as "@" | "#" | "/", query: match[3], start: caret - match[3].length - 1 } : undefined
}

/**
 * A message box with @ (pi and people) and # (folders, fuzzy) suggestions. Enter sends,
 * Shift+Enter adds a line; while suggestions are open, arrows pick and Enter/Tab inserts.
 */
export function MentionComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  busy,
  selfId,
  folders = true,
  folder = "",
  sessionKey,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (message: ParsedMessage) => void | Promise<void>
  placeholder: string
  busy?: boolean
  selfId?: string
  /** Offer #folder suggestions (off once a chat's folder is fixed). */
  folders?: boolean
  folder?: string
  sessionKey?: string
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [everyone, setEveryone] = useState<Person[]>([])
  const [token, setToken] = useState<ReturnType<typeof activeToken>>()
  const [options, setOptions] = useState<Suggestion[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    void people().then(setEveryone)
  }, [])

  useEffect(() => {
    if (!token) return setOptions([])
    const q = token.query.toLowerCase()
    if (token.trigger === "@") {
      const matches = everyone.filter((p) => p.id !== selfId && p.username.toLowerCase().includes(q)).map((person) => ({ kind: "person" as const, person }))
      setOptions([...("pi".startsWith(q) ? [{ kind: "pi" as const }] : []), ...matches].slice(0, 8))
      setIndex(0)
      return
    }
    if (token.trigger === "/") {
      let alive = true
      const request = sessionKey ? api.tools(sessionKey) : api.toolsAt(folder)
      void request.then((r) => {
        if (!alive) return
        setOptions(r.resources.filter((r) => r.kind === "skill" && r.name.toLowerCase().includes(q.replace(/^skill:/, ""))).map((r) => ({ kind: "skill" as const, name: r.name, description: r.description })))
        setIndex(0)
      }, () => { if (alive) setOptions([]) })
      return () => { alive = false }
    }
    if (!folders) return setOptions([])
    let alive = true
    const timer = setTimeout(() => {
      api.searchFolders(token.query.replaceAll(NBSP, " ")).then(
        (r) => {
          if (!alive) return
          setOptions(r.folders.map((path) => ({ kind: "folder" as const, path })))
          setIndex(0)
        },
        () => {},
      )
    }, 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [token, everyone, folders, selfId, folder, sessionKey])

  const sync = (next: string, caret: number) => {
    onChange(next)
    setToken(activeToken(next, caret))
  }

  const pick = (s: Suggestion) => {
    if (!token) return
    const caret = input.current?.selectionStart ?? value.length
    const insert = s.kind === "pi" ? "@pi " : s.kind === "person" ? `@${s.person.username} ` : s.kind === "skill" ? `/skill:${s.name} ` : `#${s.path.replaceAll(" ", NBSP)} `
    const next = value.slice(0, token.start) + insert + value.slice(caret)
    const at = token.start + insert.length
    onChange(next)
    setToken(undefined)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(at, at)
    })
  }

  const submit = async () => {
    if (busy || !value.trim()) return
    await onSubmit(parseMessage(value, everyone))
  }

  const open = Boolean(token) && options.length > 0

  return (
    <div className="relative flex items-end gap-2">
      {open && (
        <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full max-w-sm overflow-y-auto rounded-md border bg-popover p-1 shadow-md" role="listbox">
          <li className="flex justify-end"><button type="button" aria-label="Dismiss suggestions" className="rounded p-1 hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => setToken(undefined)}><X className="size-4" /></button></li>
          {options.map((s, i) => (
            <li key={s.kind === "pi" ? "pi" : s.kind === "person" ? s.person.id : s.kind === "skill" ? `skill:${s.name}` : s.path} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", i === index && "bg-accent")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setIndex(i)}
              >
                {s.kind === "pi" && (
                  <>
                    <PiAvatar small /> <span className="font-medium">pi</span> <span className="text-xs text-muted-foreground">coding agent</span>
                  </>
                )}
                {s.kind === "person" && (
                  <>
                    <span className="scale-75">
                      <AuthorAvatar id={s.person.id} name={s.person.username} />
                    </span>
                    {s.person.username}
                  </>
                )}
                {s.kind === "skill" && <span className="min-w-0 truncate" title={s.description}>/skill:{s.name}</span>}
                {s.kind === "folder" && (
                  <>
                    <Folder className="size-4 shrink-0 text-sky-600 dark:text-sky-400" /> <span className="truncate">/{s.path}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={input}
        value={value}
        placeholder={placeholder}
        rows={1}
        className="max-h-48 min-h-10 resize-none py-2"
        onChange={(e) => sync(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setToken(activeToken(value, e.currentTarget.selectionStart))}
        onBlur={() => setTimeout(() => setToken(undefined), 100)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length)
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              pick(options[index])
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setToken(undefined)
              return
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <Button size="icon" onClick={() => void submit()} disabled={busy || !value.trim()} aria-label="Send">
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
      </Button>
    </div>
  )
}

/** pi's avatar, beside people's. */
export function PiAvatar({ small }: { small?: boolean }) {
  return (
    <span
      role="img"
      aria-label="pi"
      title="pi"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-900 font-mono font-bold text-white dark:bg-white dark:text-neutral-900", small ? "size-6 text-xs" : "size-8 text-sm")}
    >
      π
    </span>
  )
}

