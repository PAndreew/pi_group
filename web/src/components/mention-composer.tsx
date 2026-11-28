import { useLocale } from "@/lib/i18n"
import { File, Folder, Trash2 } from "lucide-react"
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { AuthorAvatar } from "@/components/author-avatar"
import { MachineOption } from "@/components/machine-dropup"
import { ComposerBox } from "@/components/composer-box"
import { Markdown } from "@/components/markdown"
import { SuggestionHeader } from "@/components/suggestion-header"
import { Textarea } from "@/components/ui/textarea"
import { DraftVaultDialog } from "@/components/vault-dialog"
import { useDraftSecretGuard } from "@/hooks/use-draft-secret-guard"
import { useSilentDictation } from "@/hooks/use-silent-dictation"
import { api, type RemoteMachine } from "@/lib/api"
import { redactDraftSecrets } from "@/lib/draft-secrets"
import { matchMachines, remoteMachines } from "@/lib/remote-machines"
import { cn, relativePath } from "@/lib/utils"

export interface Person {
  id: string
  username: string
}

export interface ParsedMessage {
  /** What was typed, mentions included. */
  raw: string
  /** Without the recognized @mentions. */
  text: string
  pi: boolean
  people: Person[]
}

/** When unwrapping a folder pill, keep its spaces inside the editable token. */
const NBSP = "\u00a0"
const MENTION = /(^|\s)@([\w.-]+)/g

let directory: Promise<Person[]> | undefined
const people = () => (directory ??= api.directory().then((d) => d.users, () => { directory = undefined; return [] }))

export function parseMessage(raw: string, everyone: Person[]): ParsedMessage {
  const names = [...raw.matchAll(MENTION)].map((m) => m[2].toLowerCase())
  const mentioned = everyone.filter((p) => names.includes(p.username.toLowerCase()))
  const known = new Set(["pi", ...mentioned.map((p) => p.username.toLowerCase())])
  // Do not flatten Markdown indentation or intentional spacing while removing mentions.
  const text = raw.replace(/(?<!\S)@([\w.-]+)[ \t]*/g, (all, name) => known.has(String(name).toLowerCase()) ? "" : all).replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd()
  return { raw: raw.trim(), text, pi: names.includes("pi"), people: mentioned }
}

type Suggestion =
  | { kind: "pi" }
  | { kind: "person"; person: Person }
  | { kind: "folder"; path: string }
  | { kind: "path"; path: string; type: "dir" | "file" }
  | { kind: "skill"; name: string; description?: string }
  | { kind: "machine"; machine: RemoteMachine }

/** The token being typed at the caret, if it is a mention. */
function activeToken(value: string, caret: number) {
  const match = /(^|\s)([@/#$])((?:[^\s@#$]|\u00a0)*)$/.exec(value.slice(0, caret))
  return match ? { trigger: match[2] as "@" | "/" | "#" | "$", query: match[3], start: caret - match[3].length - 1 } : undefined
}

/**
 * A message box with @ (pi and people), $ (fuzzy folders or files), /skill: (skills) and # (remote machines) suggestions.
 * Enter sends, Shift+Enter adds a line; while suggestions are open, arrows pick and Enter/Tab inserts.
 */
export function MentionComposer({
  value,
  onChange,
  onSubmit,
  busy,
  selfId,
  hash = "folder",
  folder = "",
  folderSelection,
  sessionKey,
  controls,
  children,
  onFiles,
  onStop,
  attachmentsReady,
  editing,
  eligiblePeople,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (message: ParsedMessage) => void | Promise<void>
  busy?: boolean
  onStop?: () => void
  selfId?: string
  /**
   * What $ offers: "folder" picks the folder for a new chat, "paths" mentions files and
   * folders, inserted as `paths` relative to `folder` so pi can open them. "session" only handles
   * @, keeping the session's dedicated pickers and multiline Enter on touch screens.
   */
  hash?: "folder" | "paths" | "off" | "session"
  folder?: string
  folderSelection?: { value: string | undefined; onChange: (folder: string | undefined) => void }
  sessionKey?: string
  controls?: React.ReactNode
  children?: React.ReactNode
  attachmentsReady?: boolean
  editing?: boolean
  eligiblePeople?: (person: Person) => boolean
  /** Files or images pasted into the box. */
  onFiles?: (files: File[]) => void
}) {
  const { t: tr } = useLocale()
  const selectedFolder = folderSelection?.value
  const input = useRef<HTMLTextAreaElement>(null)
  const submitting = useRef(false)
  const renderedDraft = useDeferredValue(value)
  const guard = useDraftSecretGuard(value, onChange)
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
  useEffect(() => { if (busy || onStop || editing) dictation.cancel() }, [busy, onStop, editing, dictation.cancel])
  const [everyone, setEveryone] = useState<Person[]>([])
  const [token, setToken] = useState<ReturnType<typeof activeToken>>()
  const [options, setOptions] = useState<Suggestion[]>([])
  const [index, setIndex] = useState(0)
  const tokenAt = (next: string, caret: number) => {
    const found = activeToken(next, caret)
    if (hash === "session" && found?.trigger !== "@") return undefined
    if (found?.trigger === "/" && !found.query.startsWith("skill:")) return undefined
    if (found?.trigger === "$" && (hash === "off" || (hash === "folder" && !folderSelection))) return undefined
    return found
  }

  useEffect(() => {
    void people().then(setEveryone)
  }, [])

  useEffect(() => {
    setOptions([])
    setIndex(0)
    if (!token) return
    const q = token.query.toLowerCase()
    if (token.trigger === "@") {
      const matches = everyone.filter((p) => p.id !== selfId && p.username.toLowerCase().includes(q)).map((person) => ({ kind: "person" as const, person }))
      const agent = "pi".startsWith(q) || "beezy".startsWith(q)
      setOptions([...(agent ? [{ kind: "pi" as const }] : []), ...matches])
      setIndex(0)
      return
    }
    if (token.trigger === "#") {
      let alive = true
      void remoteMachines().then((list) => {
        if (!alive) return
        setOptions(matchMachines(list, token.query).map((machine) => ({ kind: "machine" as const, machine })))
        setIndex(0)
      })
      return () => { alive = false }
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
    if (hash === "off" || hash === "session") return setOptions([])
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
    setToken(tokenAt(next, caret))
  }

  const addMention = () => {
    const el = input.current
    if (!el) return
    const left = value.slice(0, el.selectionStart)
    const right = value.slice(el.selectionEnd)
    const before = left + (left && !/\s$/.test(left) ? " " : "") + "@"
    const next = before + (right && !/^\s/.test(right) ? " " : "") + right
    el.focus({ preventScroll: true })
    flushSync(() => sync(next, before.length))
    el.setSelectionRange(before.length, before.length)
  }

  const pick = (s: Suggestion) => {
    if (!token) return
    const caret = input.current?.selectionStart ?? value.length
    const insert =
      s.kind === "pi"
        ? "@pi "
        : s.kind === "person"
          ? `@${s.person.username} `
          : s.kind === "machine"
            ? `#${s.machine.name} `
          : s.kind === "skill"
            ? `/skill:${s.name} `
            : s.kind === "path"
              ? `\`${relativePath(folder, s.path)}${s.type === "dir" ? "/" : ""}\` `
              : ""
    const suffix = value.slice(caret)
    const next = value.slice(0, token.start) + insert + (token.trigger === "@" || s.kind === "folder" ? suffix.replace(/^ /, "") : suffix)
    const at = token.start + insert.length
    // Commit the new value before restoring the caret, within the original gesture.
    if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true })
    flushSync(() => {
      if (s.kind === "folder") folderSelection?.onChange(s.path)
      onChange(next)
      setToken(undefined)
    })
    input.current?.setSelectionRange(at, at)
  }

  const canSend = Boolean(value.trim()) || Boolean(attachmentsReady)
  const submit = async () => {
    if (busy || !canSend || submitting.current) return
    setToken(undefined)
    if (guard.blockSubmit()) {
      dictation.cancel()
      return
    }
    submitting.current = true
    try {
      const directory = value.includes("@") ? await people() : []
      await onSubmit(parseMessage(value, directory.filter((person) => person.id !== selfId)))
    } finally {
      submitting.current = false
    }
  }

  const suggestions = token?.trigger === "@" && eligiblePeople ? options.filter((s) => s.kind !== "person" || eligiblePeople(s.person)) : options
  const open = Boolean(token) && suggestions.length > 0

  return (
    <>
    <ComposerBox
      onMention={addMention}
      controls={controls}
      onDictate={editing ? undefined : dictation.click}
      dictationPhase={dictation.phase}
      dictationHint={value.trim() && dictation.phase === 'loading' ? undefined : dictation.hint}
      onFiles={onFiles}
      onStop={onStop}
      onSend={() => void submit()}
      canSend={canSend}
      sending={busy}
    >
      {open && (
        <div data-suggestions className="absolute bottom-full left-0 z-[100] mb-1 flex max-h-64 w-full max-w-sm flex-col rounded-md border bg-[var(--composer-background)] text-[var(--composer-foreground)] shadow-md" style={token?.trigger === "@" ? { maxHeight: "clamp(5rem, calc(var(--app-height, 100dvh) - 9rem), 16rem)" } : undefined} onPointerDown={(e) => e.preventDefault()}>
        <SuggestionHeader title={token?.trigger === "@" ? tr("composer.mentionSomeone") : token?.trigger === "$" ? tr("composer.chooseFolder") : undefined} dismissLabel={tr("ui.dismiss-suggestions-ce900c")} onDismiss={() => setToken(undefined)} />
        {/* Rows scrolled past the edges fade out, like the chat list. */}
        <ul className="chat-scroll-fade min-h-0 flex-1 overflow-y-auto px-1 py-2" role="listbox">
          {suggestions.map((s, i) => (
            <li key={s.kind === "pi" ? "pi" : s.kind === "person" ? s.person.id : s.kind === "skill" ? `skill:${s.name}` : s.kind === "machine" ? `machine:${s.machine.id}` : `${s.kind}:${s.path}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", i === index && "bg-accent")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setIndex(i)}
              >
                {s.kind === "pi" && (
                  <>
                    <PiAvatar small /> <span className="font-medium">Beezy</span> <span className="text-xs text-muted-foreground">{tr("ui.coding-agent-23d4a5")}</span>
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
                {s.kind === "machine" && <MachineOption machine={s.machine} />}
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
      {children}
      <div className="relative min-w-0 px-3">
      {selectedFolder && (
        <div ref={pill} className="absolute top-2 left-3 z-10 max-w-[50%]">
          <button type="button" aria-label={`Remove folder ${selectedFolder}`} title={`Remove folder /${selectedFolder}`} className="inline-flex max-w-full items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm hover:bg-accent" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => { folderSelection?.onChange(undefined); setToken(undefined); input.current?.focus() }}>
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">{selectedFolder}</span>
            <Trash2 className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      )}
      <Textarea
        ref={input}
        value={value}
        placeholder={selectedFolder ? "" : tr("composer.placeholder")}
        rows={1}
        spellCheck={false}
        autoComplete="off"
        style={indent ? { textIndent: indent } : undefined}
        className="max-h-48 min-h-12 w-full min-w-0 resize-none border-0 px-0 shadow-none focus-visible:ring-0 py-3"
        onChange={(e) => sync(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setToken(tokenAt(e.currentTarget.value, e.currentTarget.selectionStart))}
        onBlur={() => setToken(undefined)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === "Backspace" && selectedFolder && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
            e.preventDefault()
            const editable = `$${selectedFolder.replaceAll(" ", NBSP)}`.slice(0, -1)
            folderSelection?.onChange(undefined)
            onChange(`${editable} ${value}`)
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
              const next = (index + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length
              setIndex(next)
              e.currentTarget.closest("[data-composer-box]")?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: "nearest" })
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              pick(suggestions[index] ?? suggestions[0])
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setToken(undefined)
              return
            }
          }
          if (e.key === "Enter" && !e.shiftKey && (hash !== "session" || !window.matchMedia("(pointer: coarse)").matches)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {value.trim() && renderedDraft.trim() && (
        <Markdown mode="draft" text={redactDraftSecrets(renderedDraft)} className="max-h-[min(9rem,25dvh)] overflow-auto rounded-md border bg-background px-3 py-2 text-sm empty:hidden" />
      )}
      </div>
    </ComposerBox>
    {guard.candidate && <DraftVaultDialog candidate={guard.candidate} onClose={guard.close} onSaved={guard.saved} />}
    </>
  )
}

/** Beezy's avatar, beside people's. */
export function PiAvatar({ small }: { small?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full p-[3px]", small ? "size-[26px]" : "size-[34px]")}>
      <img src={`${import.meta.env.BASE_URL}beezy-logo.svg`} alt="Beezy" title="Beezy" className="size-full object-contain" />
    </span>
  )
}

