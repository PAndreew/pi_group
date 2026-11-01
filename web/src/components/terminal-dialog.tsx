import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Key = { label: string; data?: string; ctrl?: true; modifier?: "alt" | "shift" }
/** Terminal-only keys missing from the phone keyboard, arranged without horizontal scrolling. */
const KEYS: Key[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, data: ["\x1bOP", "\x1bOQ", "\x1bOR", "\x1bOS", "\x1b[15~", "\x1b[17~", "\x1b[18~", "\x1b[19~", "\x1b[20~", "\x1b[21~", "\x1b[23~", "\x1b[24~"][i] })),
  { label: "Shift", modifier: "shift" },
  { label: "Alt", modifier: "alt" },
  { label: "Enter", data: "\r" },
  { label: "Bksp", data: "\x7f" },
  { label: "Del", data: "\x1b[3~" },
  { label: "Home", data: "\x1b[H" },
  { label: "End", data: "\x1b[F" },
  { label: "PgUp", data: "\x1b[5~" },
  { label: "PgDn", data: "\x1b[6~" },
  { label: "Ins", data: "\x1b[2~" },

  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "Ctrl", ctrl: true },
  { label: "←", data: "\x1b[D" },
  { label: "↓", data: "\x1b[B" },
  { label: "↑", data: "\x1b[A" },
  { label: "→", data: "\x1b[C" },
]

type Status = { state: "connecting" | "open" } | { state: "closed"; reason: string }

/** A shell on the server in the session's folder; closing the dialog ends it. Loaded on demand. */
export default function TerminalDialog({ sessionKey, path, title, open, onOpenChange }: { sessionKey?: string; path?: string; title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<Status>({ state: "connecting" })
  const [ctrl, setCtrl] = useState(false)
  const [alt, setAlt] = useState(false)
  const [shift, setShift] = useState(false)
  const modifiers = useRef({ alt: false, shift: false })
  modifiers.current = { alt, shift }
  const [attempt, setAttempt] = useState(0)
  const [viewport, setViewport] = useState<{ top: number; height: number }>()
  useEffect(() => {
    if (!open) return
    const visible = window.visualViewport
    const update = () => setViewport({ top: visible?.offsetTop ?? 0, height: visible?.height ?? window.innerHeight })
    update()
    visible?.addEventListener("resize", update)
    visible?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      visible?.removeEventListener("resize", update)
      visible?.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [open])
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl
  const session = useRef<{ term: Terminal; send: (data: string) => void }>(undefined)

  const input = (data: string) => {
    const mods = modifiers.current
    if (data.length === 1) {
      if (mods.shift) {
        const plain = "1234567890`-=[]\\;',./"
        const shifted = "!@#$%^&*()~_+{}|:\"<>?"
        const index = plain.indexOf(data)
        data = index >= 0 ? shifted[index] : data.toUpperCase()
        setShift(false)
      }
      if (ctrlRef.current) {
        const code = data.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64)
        else if (data === " ") data = "\x00"
        else if (data === "?") data = "\x7f"
        setCtrl(false)
      }
    }
    if (mods.alt) { data = `\x1b${data}`; setAlt(false) }
    session.current?.send(data)
  }
  const inputRef = useRef(input)
  inputRef.current = input

  useEffect(() => {
    if (!open || !host) return
    const dark = document.documentElement.classList.contains("dark")
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: dark ? { background: "#0a0a0a" } : { background: "#ffffff", foreground: "#171717", cursor: "#171717", selectionBackground: "#d4d4d4" },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    setStatus({ state: "connecting" })
    const ws = new WebSocket(api.terminalUrl({ key: sessionKey, path }, term.cols, term.rows))
    const send = (data: string) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "input", data }))
    session.current = { term, send }
    ws.onopen = () => {
      setStatus({ state: "open" })
      term.focus()
    }
    ws.onmessage = (event) => term.write(event.data)
    ws.onclose = (event) => {
      const reason = event.reason || (event.code === 1006 ? "Connection refused or lost (admins only)" : `Closed (${event.code})`)
      setStatus({ state: "closed", reason })
      term.write(`\r\n\x1b[2m[${reason}]\x1b[0m\r\n`)
    }
    term.onData((data) => inputRef.current(data))
    const observer = new ResizeObserver(() => {
      fit.fit()
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }))
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      ws.close()
      term.dispose()
      session.current = undefined
    }
  }, [open, host, sessionKey, path, attempt])

  const press = (key: (typeof KEYS)[number]) => {
    if (key.ctrl) setCtrl((c) => !c)
    else if (key.modifier === "alt") setAlt((value) => !value)
    else if (key.modifier === "shift") setShift((value) => !value)
    else if (key.data) input(key.data)
    session.current?.term.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={viewport ? { top: viewport.top + viewport.height / 2, height: Math.max(0, viewport.height - 16), maxHeight: Math.max(0, viewport.height - 16) } : undefined} className="flex h-[85dvh] min-h-0 max-w-[calc(100%-1rem)] flex-col gap-2 overflow-hidden p-3 sm:max-w-4xl sm:p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base">Terminal</DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-xs">
            <span className={cn("inline-block size-1.5 rounded-full", status.state === "open" ? "bg-green-500" : status.state === "connecting" ? "animate-pulse bg-amber-500" : "bg-muted-foreground/40")} />
            <span className="truncate">{status.state === "closed" ? status.reason : status.state === "open" ? title : "Connecting…"}</span>
            {status.state === "closed" && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAttempt((a) => a + 1)}>
                <RotateCw /> Reconnect
              </Button>
            )}
          </DialogDescription>
        </DialogHeader>
        <div ref={setHost} className="mb-36 min-h-0 flex-1 overflow-hidden rounded-md border bg-white p-1 dark:bg-[#0a0a0a]" />
        <div className="absolute right-3 bottom-3 left-3 grid h-36 min-w-0 auto-rows-fr grid-cols-8 gap-1 rounded-lg bg-neutral-100 p-2 shadow-lg dark:bg-neutral-900 sm:right-4 sm:bottom-4 sm:left-4" role="group" aria-label="Terminal keyboard">
          {KEYS.map((key) => (
            <Button
              key={key.label}
              variant="ghost"
              aria-pressed={key.ctrl ? ctrl : key.modifier === "alt" ? alt : key.modifier === "shift" ? shift : undefined}
              size="sm"
              className={cn("h-full min-h-0 min-w-0 rounded-sm border-0 bg-white p-0 font-mono text-[10px] text-black hover:bg-neutral-200 dark:bg-black dark:text-white dark:hover:bg-neutral-800 sm:text-xs", ((key.ctrl && ctrl) || (key.modifier === "alt" && alt) || (key.modifier === "shift" && shift)) && "ring-2 ring-inset ring-current")}
              // Keep the terminal (and the phone keyboard) focused.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => press(key)}
            >
              {key.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
