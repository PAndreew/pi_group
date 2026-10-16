import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Termux-style extra keys for phone keyboards, which have no Esc, Tab, Ctrl or arrows. */
const KEYS: { label: string; data?: string; ctrl?: true }[] = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "Ctrl", ctrl: true },
  { label: "←", data: "\x1b[D" },
  { label: "↓", data: "\x1b[B" },
  { label: "↑", data: "\x1b[A" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
]

type Status = { state: "connecting" | "open" } | { state: "closed"; reason: string }

/** A shell on the server in the session's folder; closing the dialog ends it. Loaded on demand. */
export default function TerminalDialog({ sessionKey, title, open, onOpenChange }: { sessionKey: string; title: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<Status>({ state: "connecting" })
  const [ctrl, setCtrl] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const ctrlRef = useRef(false)
  ctrlRef.current = ctrl
  const session = useRef<{ term: Terminal; send: (data: string) => void }>(undefined)

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
    const ws = new WebSocket(api.terminalUrl(sessionKey, term.cols, term.rows))
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
    term.onData((data) => {
      // A sticky Ctrl from the key bar turns the next letter into its control character.
      if (ctrlRef.current && data.length === 1) {
        setCtrl(false)
        const code = data.toUpperCase().charCodeAt(0)
        if (code >= 64 && code <= 95) return send(String.fromCharCode(code - 64))
      }
      send(data)
    })
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
  }, [open, host, sessionKey, attempt])

  const press = (key: (typeof KEYS)[number]) => {
    if (key.ctrl) setCtrl((c) => !c)
    else if (key.data) session.current?.send(key.data)
    session.current?.term.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85dvh] max-w-[calc(100%-1rem)] flex-col gap-2 p-3 sm:max-w-4xl sm:p-4">
        <DialogHeader>
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
        <div ref={setHost} className="min-h-0 flex-1 overflow-hidden rounded-md border bg-white p-1 dark:bg-[#0a0a0a]" />
        <div className="flex gap-1 overflow-x-auto pb-1">
          {KEYS.map((key) => (
            <Button
              key={key.label}
              variant={key.ctrl && ctrl ? "default" : "outline"}
              size="sm"
              className="h-8 min-w-9 shrink-0 px-2 font-mono text-xs"
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
