import { File, Folder, Trash2, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { AuthorAvatar } from "@/components/author-avatar"
import { ComposerBox } from "@/components/composer-box"
import { useSilentDictation } from "@/hooks/use-silent-dictation"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn, relativePath } from "@/lib/utils"

export interface Person {
  id: string
  username: string
}

export interface ParsedMessage {
  /** What was typed, mentions included. */
  raw: string
  /** Without the @ and /folder mentions. */
  text: string
  pi: boolean
  people: Person[]
  folder?: string
}

/** Folder mentions keep spaces as no-break spaces so a /path stays one token. */
const NBSP = "\u00a0"
const MENTION = /(^|\s)@([\w.-]+)/g
const FOLDER = /(^|\s)\/(?!skill:)((?:[^\s]|\u00a0)+)/g

let directory: Promise<Person[]> | undefined
const people = () => (directory ??= api.directory().then((d) => d.users, () => []))

/** `raw` with its /folder mention (if any) replaced by `folder`, placed first. */
export function withFolder(raw: string, folder: string): string {
  const rest = raw.replace(FOLDER, (_all, lead) => lead).replace(/^[ 	]+/, "")
  return `/${folder.replaceAll(" ", NBSP)} ${rest}`
}

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

type Suggestion =
  | { kind: "pi" }
  | { kind: "person"; person: Person }
  | { kind: "folder"; path: string }
  | { kind: "path"; path: string; type: "dir" | "file" }
  | { kind: "skill"; name: string; description?: string }

/** The token being typed at the caret, if it is a mention. */
function activeToken(value: string, caret: number) {
  const match = /(^|\s)([@/])((?:[^\s@]|\u00a0)*)$/.exec(value.slice(0, caret))
  return match ? { trigger: match[2] as "@" | "/", query: match[3], start: caret - match[3].length - 1 } : undefined
}

/**
 * A message box with @ (pi and people), / (fuzzy folders or files) and /skill: (skills) suggestions.
 * Enter sends, Shift+Enter adds a line; while suggestions are open, arrows pick and Enter/Tab inserts.
 */
export function MentionComposer({
  value: rawValue,
  onChange: onRawChange,
  onSubmit,
  placeholder,
  busy,
  selfId,
  hash = "folder",
  folder = "",
  sessionKey,
  agent,
  controls,
  onFiles,
  onStop,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (message: ParsedMessage) => void | Promise<void>
  placeholder: string
  busy?: boolean
  onStop?: () => void
  selfId?: string
  /**
   * What / offers: "folder" picks the folder for a new chat (/path token), "paths" mentions files and
   * folders, inserted as `paths` relative to `folder` so pi can open them.
   */
  hash?: "folder" | "paths" | "off"
  folder?: string
  sessionKey?: string
  agent?: React.ReactNode
  controls?: React.ReactNode
  /** Files or images pasted into the box. */
  onFiles?: (files: File[]) => void
}) {
  const [editingFolder, setEditingFolder] = useState(false)
  useEffect(() => { if (!rawValue) setEditingFolder(false) }, [rawValue])
  // Backspacing a pill unwraps it into ordinary text until another folder is picked.
  const folderToken = hash === "folder" && !editingFolder ? /(^|\s)\/(?!skill:)((?:[^\s]|\u00a0)+)[ \t\n]/.exec(rawValue) : null
  const selectedFolder = folderToken?.[2].replaceAll(NBSP, " ")
  const value = folderToken ? rawValue.slice(0, folderToken.index) + folderToken[1] + rawValue.slice(folderToken.index + folderToken[0].length) : rawValue
  const onChange = (next: string) => onRawChange(selectedFolder ? withFolder(next, selectedFolder) : next)
  const input = useRef<HTMLTextAreaElement>(null)
  // The folder pill sits over the start of the first line; only that line is indented, so text flows under it.
  const pill = useRef<HTMLDivElement>(null)
  const [indent, setIndent] = useState(0)
  useLayoutEffect(() => {
    const el = pill.current
    if (!el) return setIndent(0)
    const measure = () => setIndent(el.offsetWidth + 6)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [selectedFolder])
  const dictation = useSilentDictation((text) => {
    onChange(text)
    requestAnimationFrame(() => input.current?.focus())
  })
  useEffect(() => { if (busy || onStop) dictation.cancel() }, [busy, onStop, dictation.cancel])
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
    if (token.trigger === "/" && token.query.startsWith("skill:")) {
      let alive = true
      const request = sessionKey ? api.tools(sessionKey) : api.toolsAt(folder)
      void request.then((r) => {
        if (!alive) return
        setOptions(r.resources.filter((r) => r.kind === "skill" && r.name.toLowerCase().includes(q.replace(/^skill:/, ""))).map((r) => ({ kind: "skill" as const, name: r.name, description: r.description })))
        setIndex(0)
      }, () => { if (alive) setOptions([]) })
      return () => { alive = false }
    }
    if (hash === "off") return setOptions([])
    let alive = true
    const timer = setTimeout(() => {
      const query = token.query.replaceAll(NBSP, " ")
      const search: Promise<Suggestion[]> =
        hash === "paths"
          ? api.searchPaths(query).then((r) => r.entries.map((e) => ({ kind: "path" as const, path: e.path, type: e.type })))
          : api.searchFolders(query).then((r) => r.folders.map((path) => ({ kind: "folder" as const, path })))
      search.then(
        (found) => {
          if (!alive) return
          setOptions(found)
          setIndex(0)
        },
        () => {},
      )
    }, 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [token, everyone, hash, selfId, folder, sessionKey])

  const sync = (next: string, caret: number) => {
    dictation.cancel()
    onChange(next)
    setToken(activeToken(next, caret))
  }

  const pick = (s: Suggestion) => {
    if (!token) return
    const caret = input.current?.selectionStart ?? value.length
    const insert =
      s.kind === "pi"
        ? "@pi "
        : s.kind === "person"
          ? `@${s.person.username} `
          : s.kind === "skill"
            ? `/skill:${s.name} `
            : s.kind === "path"
              ? `\`${relativePath(folder, s.path)}${s.type === "dir" ? "/" : ""}\` `
              : `/${s.path.replaceAll(" ", NBSP)} `
    const next = value.slice(0, token.start) + insert + value.slice(caret)
    const at = s.kind === "folder" ? token.start : token.start + insert.length
    if (s.kind === "folder") {
      setEditingFolder(false)
      onRawChange(withFolder(value.slice(0, token.start) + value.slice(caret), s.path))
    }
    else onChange(next)
    setToken(undefined)
    // Keep mobile focus in the original user gesture, never blur/refocus on a later frame.
    if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true })
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at))
  }

  const submit = async () => {
    if (busy || !value.trim()) return
    await onSubmit(parseMessage(rawValue, everyone))
  }

  const open = Boolean(token) && options.length > 0

  return (
    <ComposerBox agent={agent} controls={controls} onDictate={dictation.click} dictationPhase={dictation.phase} dictationHint={value.trim() && dictation.phase === 'loading' ? undefined : dictation.hint} onFiles={onFiles} onStop={onStop} onSend={() => void submit()} canSend={Boolean(value.trim())} sending={busy}>
      {open && (
        <div data-suggestions className="absolute bottom-full left-0 z-[100] mb-1 flex max-h-64 w-full max-w-sm flex-col rounded-md border bg-[var(--composer-background)] text-[var(--composer-foreground)] shadow-md" onPointerDown={(e) => e.preventDefault()}>
        <div className="flex shrink-0 justify-end px-1 pt-1"><button type="button" aria-label="Dismiss suggestions" className="rounded p-1.5 hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => setToken(undefined)}><X className="size-4" /></button></div>
        {/* Rows scrolled past the edges fade out, like the chat list. */}
        <ul className="chat-scroll-fade min-h-0 flex-1 overflow-y-auto px-1 py-2" role="listbox">
          {options.map((s, i) => (
            <li key={s.kind === "pi" ? "pi" : s.kind === "person" ? s.person.id : s.kind === "skill" ? `skill:${s.name}` : `${s.kind}:${s.path}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", i === index && "bg-accent")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setIndex(i)}
              >
                {s.kind === "pi" && (
                  <>
                    <PiAvatar small /> <span className="font-medium">Beezy</span> <span className="text-xs text-muted-foreground">coding agent</span>
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
                {s.kind === "path" && (
                  <>
                    {s.type === "dir" ? <Folder className="size-4 shrink-0 text-sky-600 dark:text-sky-400" /> : <File className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">/{s.path}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
        </div>
      )}
      <div className="relative min-w-0 px-3">
      {selectedFolder && (
        <div ref={pill} className="absolute top-2 left-3 z-10 max-w-[50%]">
          <button type="button" aria-label={`Remove folder ${selectedFolder}`} title={`Remove folder /${selectedFolder}`} className="inline-flex max-w-full items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm hover:bg-accent" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => { onRawChange(value); setToken(undefined); input.current?.focus() }}>
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">{selectedFolder}</span>
            <Trash2 className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      )}
      <Textarea
        ref={input}
        value={value}
        placeholder={selectedFolder ? "" : placeholder}
        rows={1}
        style={indent ? { textIndent: indent } : undefined}
        className="max-h-48 min-h-12 w-full min-w-0 resize-none border-0 px-0 shadow-none focus-visible:ring-0 py-3"
        onChange={(e) => sync(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setToken(activeToken(value, e.currentTarget.selectionStart))}
        onBlur={() => setTimeout(() => setToken(undefined), 100)}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && selectedFolder && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
            e.preventDefault()
            const editable = `/${selectedFolder.replaceAll(" ", NBSP)}`.slice(0, -1)
            setEditingFolder(true)
            onRawChange(`${editable} ${value}`)
            setToken(activeToken(editable, editable.length))
            requestAnimationFrame(() => {
              input.current?.setSelectionRange(editable.length, editable.length)
              setToken(activeToken(editable, editable.length))
            })
            return
          }
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
      </div>
    </ComposerBox>
  )
}

/** Beezy's avatar, beside people's. */
export function PiAvatar({ small }: { small?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full p-[3px]", small ? "size-[26px]" : "size-[34px]")}>
      <img src="/beezy-logo.svg" alt="Beezy" title="Beezy" className="size-full object-contain" />
    </span>
  )
}

