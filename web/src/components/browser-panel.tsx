import { ArrowLeft, ArrowRight, Crosshair, Keyboard, Loader2, Monitor, Power, RotateCw, Smartphone, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { ElementRef } from "@/lib/element-refs"
import { cn } from "@/lib/utils"

type Box = { x: number; y: number; width: number; height: number }
type Status = { state: "connecting" | "open" } | { state: "closed"; reason: string }

const DESKTOP = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max))

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
const BUTTONS = ["left", "middle", "right"] as const

/**
 * The session's shared browser: everyone viewing the session sees the same page, people with write
 * access drive it, and anyone can pick elements (click one, or drag around several) to reference them
 * in their message.
 */
export function BrowserPanel({ sessionKey, picks, onPick, onClose }: { sessionKey: string; picks: number; onPick: (ref: ElementRef) => void; onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ state: "connecting" })
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState({ url: "", title: "", viewport: DESKTOP, canInput: false })
  const [address, setAddress] = useState("")
  const [picking, setPicking] = useState(false)
  const [hover, setHover] = useState<{ box: Box; label: string }>()
  const [drag, setDrag] = useState<Box>()
  const [pending, setPending] = useState(0)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState("")
  const [scale, setScale] = useState(1)
  const ws = useRef<WebSocket>(undefined)
  const canvas = useRef<HTMLCanvasElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number; clientX: number; clientY: number; moved: boolean; shift: boolean }>(undefined)
  const lastDown = useRef({ at: 0, x: 0, y: 0, count: 1 })
  const lastInspect = useRef(0)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const pageRef = useRef(page)
  pageRef.current = page

  const send = (message: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(message))
  /** The page at the panel's size, so it is shown 1:1. */
  const fitPanel = () => {
    const host = area.current
    if (host) send({ type: "viewport", width: clamp(host.clientWidth, 320, 1920), height: clamp(host.clientHeight, 320, 1600) })
  }

  useEffect(() => {
    setStatus({ state: "connecting" })
    const socket = new WebSocket(api.browserUrl(sessionKey))
    socket.binaryType = "blob"
    ws.current = socket
    socket.onopen = () => setStatus({ state: "open" })
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        void createImageBitmap(event.data as Blob).then((frame) => {
          const target = canvas.current
          if (target) {
            if (target.width !== frame.width || target.height !== frame.height) Object.assign(target, { width: frame.width, height: frame.height })
            target.getContext("2d")?.drawImage(frame, 0, 0)
          }
          frame.close()
        })
        return
      }
      const message = JSON.parse(event.data)
      if (message.type === "state") {
        // Whoever opens a fresh browser sizes it to their panel.
        if (message.canInput && message.url === "about:blank" && !pageRef.current.url) fitPanel()
        setPage((p) => ({ url: message.url, title: message.title, viewport: message.viewport, canInput: message.canInput ?? p.canInput }))
        setAddress((a) => (document.activeElement?.id === "browser-address" ? a : message.url === "about:blank" ? "" : message.url))
      } else if (message.type === "hover") {
        setHover(message.box ? { box: message.box, label: message.label } : undefined)
      } else if (message.type === "picked") {
        setPending((n) => Math.max(0, n - 1))
        onPickRef.current({ id: message.id, url: message.url, title: message.title, elements: message.elements, image: message.image })
      } else if (message.type === "error") {
        setPending(0)
        toast.error(message.message)
      }
    }
    socket.onclose = (event) => setStatus({ state: "closed", reason: event.reason || (event.code === 1006 ? "Connection lost" : `Closed (${event.code})`) })
    return () => socket.close()
  }, [sessionKey, attempt])

  // Fit the page into the panel, keeping its aspect ratio.
  useEffect(() => {
    const host = area.current
    if (!host) return
    const fit = () => setScale(Math.min(host.clientWidth / page.viewport.width, host.clientHeight / page.viewport.height))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    return () => observer.disconnect()
  }, [page.viewport.width, page.viewport.height])

  const toPage = (e: { clientX: number; clientY: number }) => {
    const rect = surface.current!.getBoundingClientRect()
    const { width, height } = pageRef.current.viewport
    return { x: Math.round(((e.clientX - rect.left) / rect.width) * width), y: Math.round(((e.clientY - rect.top) / rect.height) * height) }
  }

  // Wheel needs a non-passive listener to keep the panel itself from scrolling.
  useEffect(() => {
    const el = surface.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!pageRef.current.canInput) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      send({ type: "mouse", action: "wheel", ...toPage(e), deltaX: e.deltaX * unit, deltaY: e.deltaY * unit, modifiers: modifiers(e) })
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [status.state])

  const pick = (target: object) => {
    setPending((n) => n + 1)
    send({ type: "pick", id: crypto.randomUUID(), ...target })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    surface.current?.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = toPage(e)
    pointer.current = { ...at, clientX: e.clientX, clientY: e.clientY, moved: false, shift: e.shiftKey }
    if (picking || e.pointerType === "touch" || !page.canInput) return
    const last = lastDown.current
    const count = Date.now() - last.at < 400 && Math.abs(last.x - at.x) < 5 && Math.abs(last.y - at.y) < 5 ? Math.min(last.count + 1, 3) : 1
    lastDown.current = { at: Date.now(), ...at, count }
    send({ type: "mouse", action: "down", ...at, button: BUTTONS[e.button] ?? "left", buttons: e.buttons, clickCount: count, modifiers: modifiers(e) })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const at = toPage(e)
    const down = pointer.current
    if (down && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 8) down.moved = true
    if (picking) {
      if (down?.moved) {
        setHover(undefined)
        setDrag({ x: Math.min(down.x, at.x), y: Math.min(down.y, at.y), width: Math.abs(at.x - down.x), height: Math.abs(at.y - down.y) })
      } else if (!down && Date.now() - lastInspect.current > 80) {
        lastInspect.current = Date.now()
        send({ type: "inspect", ...at })
      }
      return
    }
    if (!page.canInput) return
    if (e.pointerType === "touch") {
      // Dragging a finger scrolls the page.
      if (down?.moved) {
        const ratio = page.viewport.width / surface.current!.getBoundingClientRect().width
        send({ type: "mouse", action: "wheel", ...at, deltaX: (down.clientX - e.clientX) * ratio, deltaY: (down.clientY - e.clientY) * ratio })
        Object.assign(down, { clientX: e.clientX, clientY: e.clientY })
      }
      return
    }
    send({ type: "mouse", action: "move", ...at, buttons: e.buttons, modifiers: modifiers(e) })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const down = pointer.current
    pointer.current = undefined
    const at = toPage(e)
    if (picking) {
      setDrag(undefined)
      setHover(undefined)
      if (down?.moved) {
        const rect = { x: Math.min(down.x, at.x), y: Math.min(down.y, at.y), width: Math.abs(at.x - down.x), height: Math.abs(at.y - down.y) }
        if (rect.width > 2 && rect.height > 2) pick({ rect })
      } else pick(at)
      // Shift keeps picking, for several separate elements.
      if (!down?.shift && !e.shiftKey) setPicking(false)
      return
    }
    if (!page.canInput) return
    if (e.pointerType === "touch") {
      if (down && !down.moved) {
        send({ type: "mouse", action: "move", ...at })
        send({ type: "mouse", action: "down", ...at, button: "left", buttons: 1, clickCount: 1 })
        send({ type: "mouse", action: "up", ...at, button: "left", buttons: 0, clickCount: 1 })
      }
      return
    }
    send({ type: "mouse", action: "up", ...at, button: BUTTONS[e.button] ?? "left", buttons: e.buttons, clickCount: lastDown.current.count, modifiers: modifiers(e) })
  }

  const onKey = (e: React.KeyboardEvent, action: "down" | "up") => {
    if (e.key === "Escape" && picking) {
      setPicking(false)
      setHover(undefined)
      return
    }
    if (!page.canInput || e.nativeEvent.isComposing || e.key === "Unidentified" || e.key === "Process") return
    // Let the paste event bring the clipboard text.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return
    e.preventDefault()
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (action === "down") send({ type: "text", text: e.key })
    } else send({ type: "key", action, key: e.key })
  }

  const navigate = (e: React.FormEvent) => {
    e.preventDefault()
    if (address.trim()) send({ type: "navigate", url: address.trim() })
    surface.current?.focus()
  }

  const phone = page.viewport.width < 600
  const blank = status.state === "open" && (!page.url || page.url === "about:blank")

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-1 border-b p-1.5">
        <Button variant="ghost" size="icon-sm" disabled={!page.canInput} onClick={() => send({ type: "back" })} aria-label="Back" title="Back">
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!page.canInput} onClick={() => send({ type: "forward" })} aria-label="Forward" title="Forward">
          <ArrowRight />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!page.canInput} onClick={() => send({ type: "reload" })} aria-label="Reload" title="Reload">
          <RotateCw />
        </Button>
        <form onSubmit={navigate} className="min-w-0 flex-1">
          <Input id="browser-address" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!page.canInput} placeholder="localhost:5173 or any URL" className="h-8 text-sm" title={page.title} />
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!page.canInput}
          onClick={() => (phone ? fitPanel() : send({ type: "viewport", ...PHONE }))}
          aria-label={phone ? "Fit to panel" : "Phone size"}
          title={phone ? "Fit to panel" : "Phone size"}
        >
          {phone ? <Monitor /> : <Smartphone />}
        </Button>
        {page.canInput && (
          <Button variant="ghost" size="icon-sm" className="sm:hidden" data-active={typing} onClick={() => setTyping((t) => !t)} aria-label="Type into the page" title="Type into the page">
            <Keyboard />
          </Button>
        )}
        <Button
          variant={picking ? "default" : "ghost"}
          size="icon-sm"
          disabled={status.state !== "open"}
          onClick={() => {
            setPicking((p) => !p)
            setHover(undefined)
          }}
          aria-label="Pick elements to reference"
          title="Pick elements: click one, or drag around several (Shift keeps picking)"
        >
          {pending ? <Loader2 className="animate-spin" /> : <Crosshair />}
        </Button>
        {page.canInput && (
          <Button variant="ghost" size="icon-sm" onClick={() => send({ type: "close" })} aria-label="Close the browser for everyone" title="Close the browser for everyone">
            <Power />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Hide browser" title="Hide browser">
          <X />
        </Button>
      </div>
      {typing && page.canInput && (
        <form
          className="flex gap-1 border-b p-1.5 sm:hidden"
          onSubmit={(e) => {
            e.preventDefault()
            if (text) send({ type: "text", text })
            else {
              send({ type: "key", action: "down", key: "Enter" })
              send({ type: "key", action: "up", key: "Enter" })
            }
            setText("")
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text for the focused field (empty sends Enter)" className="h-8 text-sm" />
          <Button size="sm" type="submit">
            Send
          </Button>
        </form>
      )}
      <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/40">
        {status.state === "closed" ? (
          <div className="grid justify-items-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <p>{status.reason}</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>
              <RotateCw /> {status.reason === "Browser closed" ? "Start the browser" : "Reconnect"}
            </Button>
          </div>
        ) : (
          <div
            ref={surface}
            tabIndex={0}
            className={cn("relative touch-none bg-white outline-none select-none", picking && "cursor-crosshair")}
            style={{ width: page.viewport.width * scale, height: page.viewport.height * scale }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => picking && !pointer.current && setHover(undefined)}
            onKeyDown={(e) => onKey(e, "down")}
            onKeyUp={(e) => onKey(e, "up")}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text")
              if (pasted && page.canInput) send({ type: "text", text: pasted })
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <canvas ref={canvas} className="block h-full w-full" />
            {hover && picking && <Outline box={hover.box} scale={scale} label={hover.label} />}
            {drag && <Outline box={drag} scale={scale} />}
            {status.state === "connecting" && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Starting the browser…
              </div>
            )}
            {blank && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-neutral-500">
                {page.canInput ? "Enter a URL above, or ask @pi to start your app and open it here." : "Nothing open yet."}
              </div>
            )}
          </div>
        )}
        {picks > 0 && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow lg:hidden">
            {picks} picked, added to your message
          </span>
        )}
      </div>
    </div>
  )
}

function Outline({ box, scale, label }: { box: Box; scale: number; label?: string }) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/15"
      style={{ left: box.x * scale, top: box.y * scale, width: box.width * scale, height: box.height * scale }}
    >
      {label && <span className="absolute -top-5 left-0 rounded bg-sky-500 px-1 font-mono text-[10px] whitespace-nowrap text-white">{label}</span>}
    </div>
  )
}
