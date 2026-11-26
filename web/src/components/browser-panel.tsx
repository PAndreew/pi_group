import { useLocale } from "@/lib/i18n"
import { ArrowLeft, ArrowRight, ClipboardPaste, Copy, Crosshair, Keyboard, Maximize2, Minimize2, Quote, Loader2, Monitor, Power, RotateCw, Scan, Search, Smartphone, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { BrowserAsk, type BrowserAnswer } from "@/components/browser-ask"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { copyText, copyTextLater } from "@/lib/clipboard"
import { api } from "@/lib/api"
import type { ElementRef } from "@/lib/element-refs"
import { cn } from "@/lib/utils"

type Box = { x: number; y: number; width: number; height: number }
type Status = { state: "connecting" | "open" } | { state: "closed"; reason: string }

const DESKTOP = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }
const PHONE_SCREEN = "(max-width: 639px), (pointer: coarse) and (max-width: 959px)"
type ViewportMode = "auto" | "phone" | "panel"
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max))

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
const BUTTONS = ["left", "middle", "right"] as const

/**
 * The session's shared browser: everyone viewing the session sees the same page, people with write
 * access drive it, and anyone can pick elements (click one, or drag around several) to reference them
 * in their message.
 */
/** Asking about the page from the floating button: send, and the answer to show. */
export type BrowserAskProps = {
  onSend: (text: string, picks: ElementRef[], page: { url: string; title: string }) => Promise<void>
  /** Why sending is not possible right now (e.g. the agent is running). */
  disabled?: string
  replies: BrowserAnswer[]
  folder?: string
}

export function BrowserPanel({ sessionKey, picks, onPick, onClose, onShutDown, fullscreen, onFullscreen, ask }: {
  sessionKey: string
  picks: number
  onPick: (ref: ElementRef) => void
  onClose: () => void
  /** The user closed the browser for everyone. */
  onShutDown?: () => void
  /** Desktop only: the panel covers the whole workspace below the header. */
  fullscreen?: boolean
  onFullscreen?: (full: boolean) => void
  ask?: BrowserAskProps
}) {
  const { t: tr } = useLocale()
  const [status, setStatus] = useState<Status>({ state: "connecting" })
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState({ url: "", title: "", viewport: DESKTOP, canInput: false, canResize: false })
  const [address, setAddress] = useState("")
  const [picking, setPicking] = useState(false)
  const [hover, setHover] = useState<{ box: Box; label: string; depth: number; count: number }>()
  const [drag, setDrag] = useState<Box>()
  const [pending, setPending] = useState(0)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [remoteFocus, setRemoteFocus] = useState<RemoteFocus>({ editable: false })
  const [scale, setScale] = useState(1)
  const [viewportMode, setViewportMode] = useState<ViewportMode>("auto")
  const [quote, setQuote] = useState("")
  const [selectingText, setSelectingText] = useState(false)
  const [asking, setAsking] = useState(false)
  const [askPicks, setAskPicks] = useState<ElementRef[]>([])
  const ws = useRef<WebSocket>(undefined)
  const canvas = useRef<HTMLCanvasElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number; clientX: number; clientY: number; moved: boolean; shift: boolean }>(undefined)
  const lastDown = useRef({ at: 0, x: 0, y: 0, count: 1 })
  const lastInspect = useRef(0)
  // While picking, which element of the stack under the pointer (0 = topmost), and where it was chosen.
  const depth = useRef(0)
  const inspected = useRef<{ x: number; y: number }>(undefined)
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const wheelSum = useRef(0)
  const floatingPicks = useRef(new Set<string>())
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const pageRef = useRef(page)
  pageRef.current = page
  // The native keyboard on touch screens types into a hidden field over the page.
  const ime = useRef<HTMLTextAreaElement>(null)
  const imeValue = useRef(SENTINEL)
  const composing = useRef(false)
  const editables = useRef<Box[]>([])
  const copies = useRef(new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>())

  const send = (message: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(message))

  useEffect(() => {
    setStatus({ state: "connecting" })
    const socket = new WebSocket(api.browserUrl(sessionKey))
    socket.binaryType = "blob"
    ws.current = socket
    const host = area.current
    let active = true
    let generation = 0
    let decoding = false
    let pending: Blob | undefined
    let lastPresentation = ""
    const present = () => {
      if (socket.readyState !== WebSocket.OPEN) return
      const visible = !document.hidden
      const width = host?.clientWidth ?? 0
      const height = host?.clientHeight ?? 0
      const dpr = window.devicePixelRatio || 1
      // Round up to avoid restarting capture for every pixel during a layout resize.
      const size = width && height ? {
        width: Math.min(3840, Math.ceil(width * dpr / 64) * 64),
        height: Math.min(3200, Math.ceil(height * dpr / 64) * 64),
      } : undefined
      const message = JSON.stringify({ type: "presentation", visible, size })
      if (message !== lastPresentation) {
        socket.send(message)
        lastPresentation = message
      }
    }
    const onVisibility = () => {
      generation++
      pending = undefined
      present()
    }
    const observer = new ResizeObserver(present)
    if (host) observer.observe(host)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("resize", present)
    socket.onopen = present

    const decode = async () => {
      if (decoding) return
      decoding = true
      try {
        while (active && !document.hidden && pending) {
          const blob = pending
          const current = generation
          pending = undefined
          try {
            const frame = await createImageBitmap(blob)
            try {
              const target = canvas.current
              if (active && !document.hidden && current === generation && target) {
                if (target.width !== frame.width || target.height !== frame.height) Object.assign(target, { width: frame.width, height: frame.height })
                target.getContext("2d")?.drawImage(frame, 0, 0)
              }
            } finally {
              frame.close()
            }
          } catch {
            // Drop undecodable frames; the stream can recover on the next one.
          }
        }
      } finally {
        decoding = false
      }
    }
    socket.onmessage = (event) => {
      if (!active) return
      if (typeof event.data !== "string") {
        if (!document.hidden) {
          pending = event.data as Blob
          void decode()
        }
        return
      }
      const message = JSON.parse(event.data)
      if (message.type === "state") {
        setPage((p) => ({ url: message.url, title: message.title, viewport: message.viewport, canInput: message.canInput ?? p.canInput, canResize: message.canResize ?? (message.canInput === undefined ? p.canResize : message.canInput) }))
        setStatus((s) => s.state === "open" ? s : { state: "open" })
        setAddress((a) => (document.activeElement?.id === "browser-address" ? a : message.url === "about:blank" ? "" : message.url))
      } else if (message.type === "focus") {
        setRemoteFocus(message)
        // The tap that opened the keyboard did not land in a text field after all.
        if (!message.editable && document.activeElement === ime.current) ime.current?.blur()
      } else if (message.type === "editables") {
        editables.current = message.boxes
      } else if (message.type === "copied") {
        copies.current.get(message.id)?.resolve(message.text)
        copies.current.delete(message.id)
      } else if (message.type === "clipboard") {
        const text = message.text as string
        copyText(text).then(
          () => toast.success(tr("browser.pageCopied")),
          () => toast(tr("browser.pageCopied"), { action: { label: tr("ui.copy-af74f7"), onClick: () => void copyText(text).catch((error) => toast.error((error as Error).message)) } }),
        )
      } else if (message.type === "viewport-control") {
        setPage((p) => ({ ...p, canResize: message.canResize }))
      } else if (message.type === "hover") {
        if (message.box) depth.current = message.depth ?? 0
        setHover(message.box ? { box: message.box, label: message.label, depth: message.depth ?? 0, count: message.count ?? 1 } : undefined)
      } else if (message.type === "quoted") {
        setQuote(message.text)
        setAsking(true)
      } else if (message.type === "picked") {
        setPending((n) => Math.max(0, n - 1))
        const ref: ElementRef = { id: message.id, url: message.url, title: message.title, elements: message.elements, image: message.image }
        if (floatingPicks.current.delete(ref.id)) {
          setAskPicks((list) => [...list, ref])
          setAsking(true)
        } else {
          onPickRef.current(ref)
        }
      } else if (message.type === "error") {
        setPending(0)
        // A failed copy reports through its own request.
        if (copies.current.size) {
          for (const copy of copies.current.values()) copy.reject(new Error(message.message))
          copies.current.clear()
        } else toast.error(message.message)
      }
    }
    socket.onclose = (event) => setStatus({ state: "closed", reason: event.reason || (event.code === 1006 ? "Connection lost" : `Closed (${event.code})`) })
    return () => {
      active = false
      pending = undefined
      observer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("resize", present)
      socket.onclose = null
      socket.close()
    }
  }, [sessionKey, attempt])

  // Resize Chromium itself so responsive pages reflow, not just the canvas.
  useEffect(() => {
    const host = area.current
    const socket = ws.current
    if (!host || !socket || !page.canResize || status.state !== "open") return
    const phone = window.matchMedia(PHONE_SCREEN)
    let timer: number | undefined
    const resize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!host.clientWidth || !host.clientHeight || socket.readyState !== WebSocket.OPEN) return
        const size = viewportMode === "phone" ? PHONE : {
          width: clamp(host.clientWidth, 320, viewportMode === "auto" && phone.matches ? PHONE.width : 1920),
          height: clamp(host.clientHeight, 320, 1600),
        }
        const current = pageRef.current.viewport
        if (size.width !== current.width || size.height !== current.height) {
          socket.send(JSON.stringify({ type: "viewport", ...size }))
        }
      }, 150)
    }
    resize()
    const observer = new ResizeObserver(resize)
    if (viewportMode !== "phone") observer.observe(host)
    if (viewportMode === "auto") phone.addEventListener("change", resize)
    return () => {
      observer.disconnect()
      phone.removeEventListener("change", resize)
      window.clearTimeout(timer)
    }
  }, [page.canResize, status.state, viewportMode, sessionKey])

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
      // While picking, the wheel goes down (or up) through the elements stacked under the pointer.
      if (pickingRef.current) {
        wheelSum.current += e.deltaY
        if (Math.abs(wheelSum.current) < 40) return
        layer(Math.sign(wheelSum.current))
        wheelSum.current = 0
        return
      }
      if (!pageRef.current.canInput) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      send({ type: "mouse", action: "wheel", ...toPage(e), deltaX: e.deltaX * unit, deltaY: e.deltaY * unit, modifiers: modifiers(e) })
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [status.state])

  // Taps on a touch screen must not move focus, or they would close the native keyboard.
  useEffect(() => {
    const el = surface.current
    if (!el) return
    const touch = (e: TouchEvent) => e.preventDefault()
    el.addEventListener("touchstart", touch, { passive: false })
    return () => el.removeEventListener("touchstart", touch)
  }, [status.state])

  /** Copy (or cut) the page's selection to this device's clipboard. */
  const copyFromPage = (cut = false, announce = false) => {
    const id = Math.random().toString(36).slice(2)
    const text = new Promise<string>((resolve, reject) => {
      copies.current.set(id, { resolve, reject })
      window.setTimeout(() => copies.current.delete(id) && reject(new Error(tr("browser.copyTimeout"))), 4000)
    })
    send({ type: "copy", id, cut })
    copyTextLater(text).then(
      () => announce && toast.success(tr("browser.copied")),
      (error) => toast.error((error as Error).message),
    )
  }
  const pasteIntoPage = () => {
    if (!navigator.clipboard?.readText) return void toast.error(tr("browser.pasteUnavailable"))
    navigator.clipboard.readText().then(
      (text) => text && send({ type: "text", text }),
      () => toast.error(tr("browser.pasteUnavailable")),
    )
  }

  const resetIme = () => {
    const el = ime.current
    if (!el) return
    el.value = SENTINEL
    imeValue.current = SENTINEL
    el.setSelectionRange(SENTINEL.length, SENTINEL.length)
  }
  /** Open the native keyboard over the field at `at` (page pixels), or the focused one. Must run inside a tap. */
  const openKeyboard = (at?: { x: number; y: number }) => {
    const el = ime.current
    if (!el) return
    const box = (at && editables.current.find((b) => inside(b, at))) ?? remoteFocus.box
    // Over the field, so the phone scrolls it into view above the keyboard.
    const { width, height } = pageRef.current.viewport
    const place = box ?? { x: width / 2, y: height / 3, width: 1, height: 20 }
    Object.assign(el.style, { left: `${place.x * scale}px`, top: `${place.y * scale}px`, width: `${Math.max(1, place.width * scale)}px`, height: `${Math.max(16, place.height * scale)}px` })
    resetIme()
    el.focus({ preventScroll: !box })
    setKeyboardOpen(true)
  }
  /** What the keyboard changed in the hidden field since last time, as backspaces and text. */
  const onImeInput = () => {
    const el = ime.current
    if (!el) return
    const before = Array.from(imeValue.current)
    const after = Array.from(el.value)
    let same = 0
    while (same < before.length && same < after.length && before[same] === after[same]) same++
    for (let i = same; i < before.length; i++) send({ type: "press", key: "Backspace" })
    const added = after.slice(same).join("").replaceAll(SENTINEL, "")
    if (added) send({ type: "text", text: added })
    imeValue.current = el.value
    if (!composing.current && (!el.value.startsWith(SENTINEL) || el.value.length > 64 || el.selectionStart !== el.value.length)) resetIme()
  }
  const onImeKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.key === "Unidentified" || e.key === "Process" || e.keyCode === 229) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && (e.key === "c" || e.key === "x")) {
      e.preventDefault()
      return copyFromPage(e.key === "x")
    }
    // Text, Backspace and pasting arrive as changes to the field.
    if ((mod && e.key.toLowerCase() === "v") || (e.key === "Backspace" && !mod)) return
    if (e.key.length === 1 && !mod) return
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return
    e.preventDefault()
    send({ type: "press", key: [e.ctrlKey && "Control", e.altKey && "Alt", e.metaKey && "Meta", e.shiftKey && "Shift", e.key].filter(Boolean).join("+") })
    resetIme()
  }

  const pick = (target: object) => {
    const id = crypto.randomUUID()
    // Below lg the browser covers the session composer, so picks go to the floating draft.
    if (ask && (asking || !matchMedia("(min-width: 64rem)").matches)) floatingPicks.current.add(id)
    setPending((n) => n + 1)
    send({ type: "pick", id, ...target })
  }
  /** Highlight the element `step` layers deeper (or, negative, higher) under the pointer. */
  const layer = (step: number) => {
    if (!inspected.current) return
    send({ type: "inspect", ...inspected.current, depth: Math.max(0, depth.current + step) })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!picking) setAsking(false)
    if (e.pointerType !== "touch") surface.current?.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = toPage(e)
    pointer.current = { ...at, clientX: e.clientX, clientY: e.clientY, moved: false, shift: e.shiftKey }
    if (selectingText || picking || e.pointerType === "touch" || !page.canInput) return
    const last = lastDown.current
    const count = Date.now() - last.at < 400 && Math.abs(last.x - at.x) < 5 && Math.abs(last.y - at.y) < 5 ? Math.min(last.count + 1, 3) : 1
    lastDown.current = { at: Date.now(), ...at, count }
    send({ type: "mouse", action: "down", ...at, button: BUTTONS[e.button] ?? "left", buttons: e.buttons, clickCount: count, modifiers: modifiers(e) })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const at = toPage(e)
    const down = pointer.current
    if (down && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 8) down.moved = true
    if (selectingText) {
      if (down?.moved) setDrag({ x: Math.min(down.x, at.x), y: Math.min(down.y, at.y), width: Math.abs(at.x - down.x), height: Math.max(2, Math.abs(at.y - down.y)) })
      return
    }
    if (picking) {
      if (down?.moved) {
        setHover(undefined)
        setDrag({ x: Math.min(down.x, at.x), y: Math.min(down.y, at.y), width: Math.abs(at.x - down.x), height: Math.abs(at.y - down.y) })
      } else if (!down && Date.now() - lastInspect.current > 80) {
        lastInspect.current = Date.now()
        // Moving on starts again from the topmost element.
        const last = inspected.current
        if (!last || Math.hypot(at.x - last.x, at.y - last.y) > 4) {
          inspected.current = at
          depth.current = 0
        }
        send({ type: "inspect", ...inspected.current, depth: depth.current })
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
    if (selectingText) {
      setDrag(undefined)
      if (down?.moved) {
        send({ type: "select-text", start: { x: down.x, y: down.y }, end: at })
        setSelectingText(false)
      }
      return
    }
    if (picking) {
      setDrag(undefined)
      setHover(undefined)
      if (down?.moved) {
        const rect = { x: Math.min(down.x, at.x), y: Math.min(down.y, at.y), width: Math.abs(at.x - down.x), height: Math.abs(at.y - down.y) }
        if (rect.width > 2 && rect.height > 2) pick({ rect })
      } else {
        // The highlighted layer, if it is the one under the click.
        const last = inspected.current
        pick(last && Math.hypot(at.x - last.x, at.y - last.y) <= 4 ? { ...last, depth: depth.current } : at)
      }
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
        if (editables.current.some((b) => inside(b, at))) openKeyboard(at)
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
    if (picking && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault()
      if (action === "down") layer(e.key === "ArrowDown" ? 1 : -1)
      return
    }
    if (!page.canInput || e.nativeEvent.isComposing || e.key === "Unidentified" || e.key === "Process") return
    // Let the paste event bring the clipboard text.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "x")) {
      e.preventDefault()
      if (action === "down") copyFromPage(e.key === "x")
      return
    }
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

  const blank = status.state === "open" && (!page.url || page.url === "about:blank")

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <nav aria-label={tr("ui.browser-tools-87338b")} className="flex shrink-0 items-center justify-around border-b p-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!page.canResize || status.state !== "open"} aria-label={tr("browser.viewport")} title={tr("browser.viewport")}>
              {viewportMode === "auto" ? <Scan /> : viewportMode === "phone" ? <Smartphone /> : <Monitor />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={viewportMode} onValueChange={(mode) => setViewportMode(mode as ViewportMode)}>
              <DropdownMenuRadioItem value="auto">{tr("browser.viewportAuto")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="phone">{tr("browser.viewportPhone")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="panel">{tr("browser.viewportPanel")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {page.canInput && (
          <Button
            variant={keyboardOpen ? "default" : "ghost"}
            size="icon-sm"
            className={cn("[@media(hover:hover)]:hidden", remoteFocus.editable && !keyboardOpen && "text-primary")}
            disabled={status.state !== "open"}
            aria-pressed={keyboardOpen}
            onClick={() => (keyboardOpen ? ime.current?.blur() : openKeyboard())}
            aria-label={tr("ui.type-into-the-page-ac55de")}
            title={tr("ui.type-into-the-page-ac55de")}
          >
            <Keyboard />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" className="[@media(hover:hover)]:hidden" disabled={status.state !== "open"} onClick={() => copyFromPage(false, true)} aria-label={tr("browser.copy")} title={tr("browser.copy")}>
          <Copy />
        </Button>
        {page.canInput && (
          <Button variant="ghost" size="icon-sm" className="[@media(hover:hover)]:hidden" disabled={status.state !== "open"} onClick={pasteIntoPage} aria-label={tr("browser.paste")} title={tr("browser.paste")}>
            <ClipboardPaste />
          </Button>
        )}
        <Button
          variant={picking ? "default" : "ghost"}
          size="icon-sm"
          disabled={status.state !== "open"}
          onClick={() => {
            setSelectingText(false)
            setPicking((p) => !p)
            setHover(undefined)
          }}
          aria-label={tr("ui.pick-elements-to-reference-c4acbe")}
          title={tr("ui.pick-elements-click-one-or-drag-aro-a7a0f5")}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Crosshair />}
        </Button>
        {page.canInput && (
          <Button variant="ghost" size="icon-sm" onClick={() => { send({ type: "close" }); onShutDown?.() }} aria-label={tr("ui.close-the-browser-for-everyone-0e00e2")} title={tr("ui.close-the-browser-for-everyone-0e00e2")}>
            <Power />
          </Button>
        )}
        {onFullscreen && (
          <Button variant="ghost" size="icon-sm" className="max-lg:hidden" aria-pressed={Boolean(fullscreen)} onClick={() => onFullscreen(!fullscreen)} aria-label={tr(fullscreen ? "browser.exitFullscreen" : "browser.fullscreen")} title={tr(fullscreen ? "browser.exitFullscreen" : "browser.fullscreen")}>
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={tr("ui.hide-browser-5368bd")} title={tr("ui.hide-browser-5368bd")}>
          <X />
        </Button>
      </nav>
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
            className={cn("relative touch-none bg-white outline-none select-none", picking && "cursor-crosshair", selectingText && "cursor-text")}
            style={{ width: page.viewport.width * scale, height: page.viewport.height * scale }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { pointer.current = undefined; setDrag(undefined) }}
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
            {page.canInput && (
              <textarea
                ref={ime}
                aria-label={tr("ui.type-into-the-page-ac55de")}
                tabIndex={-1}
                rows={1}
                defaultValue={SENTINEL}
                inputMode={(remoteFocus.inputMode as React.HTMLAttributes<HTMLTextAreaElement>["inputMode"]) || "text"}
                enterKeyHint={(remoteFocus.enterKeyHint as React.HTMLAttributes<HTMLTextAreaElement>["enterKeyHint"]) || undefined}
                autoCapitalize={remoteFocus.password || ["email", "url"].includes(remoteFocus.inputMode ?? "") ? "off" : "sentences"}
                autoCorrect={remoteFocus.password || ["email", "url"].includes(remoteFocus.inputMode ?? "") ? "off" : "on"}
                autoComplete="off"
                spellCheck={false}
                // 16px keeps iOS from zooming in on focus.
                className="pointer-events-none absolute top-0 left-0 resize-none overflow-hidden border-0 bg-transparent p-0 text-[16px] text-transparent caret-transparent opacity-0 outline-none"
                onInput={onImeInput}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => {
                  composing.current = false
                  onImeInput()
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  onImeKey(e)
                }}
                onKeyUp={(e) => e.stopPropagation()}
                onPaste={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const pasted = e.clipboardData.getData("text")
                  if (pasted) send({ type: "text", text: pasted })
                }}
                onBlur={() => setKeyboardOpen(false)}
              />
            )}
            {hover && picking && <Outline box={hover.box} scale={scale} label={hover.count > 1 ? `${hover.depth + 1}/${hover.count} ${hover.label}` : hover.label} />}
            {drag && <Outline box={drag} scale={scale} />}
            {status.state === "connecting" && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {tr("ui.starting-the-browser-d9df2c")}
              </div>
            )}
            {blank && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-neutral-500">
                {tr("ui.please-open-a-site-or-search-for-a--1f2c13")}
              </div>
            )}
          </div>
        )}
        {ask && status.state === "open" && (
          <BrowserAsk
            open={asking}
            onOpenChange={setAsking}
            picks={askPicks}
            quote={quote}
            onRemoveQuote={() => setQuote("")}
            onRemovePick={(id) => setAskPicks((list) => list.filter((r) => r.id !== id))}
            onSend={async (text) => {
              const question = quote ? `${text}\n\nSelected text:\n${quote.split("\n").map((line) => `> ${line}`).join("\n")}` : text
              await ask.onSend(question, askPicks, { url: page.url, title: page.title })
              setQuote("")
              setAskPicks([])
            }}
            disabled={ask.disabled}
            replies={ask.replies}
            folder={ask.folder}
          />
        )}
        {selectingText && <span className="pointer-events-none absolute top-2 rounded-full bg-background px-3 py-1 text-xs shadow">{tr("ui.drag-from-the-start-to-the-end-of-t-8aa54f")}</span>}
        {picks > 0 && (
          <span className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow lg:hidden">
            {picks} {tr("ui.picked-added-to-your-message-b9f356")}
          </span>
        )}
      </div>
      <footer className="sticky bottom-0 flex shrink-0 items-center gap-1 border-t bg-background px-2 py-2">
        <Button variant="ghost" size="icon-sm" disabled={!page.canInput} onClick={() => send({ type: "back" })} aria-label={tr("ui.back-b52b36")} title={tr("ui.back-b52b36")}>
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!page.canInput} onClick={() => send({ type: "forward" })} aria-label={tr("ui.forward-ba4e72")} title={tr("ui.forward-ba4e72")}>
          <ArrowRight />
        </Button>
        <form onSubmit={navigate} className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="browser-address" aria-label={tr("ui.url-or-search-keyword-7f72d7")} value={address} onChange={(e) => setAddress(e.target.value)} disabled={!page.canInput} placeholder={tr("ui.search-the-web-or-enter-a-url-3d058b")} className="h-8 pl-8 text-sm" title={page.title} />
        </form>
        {ask && <Button variant={selectingText ? "default" : "ghost"} size="icon-sm" disabled={!page.canInput || blank} aria-pressed={selectingText} onClick={() => { setPicking(false); setHover(undefined); setSelectingText((active) => !active) }} aria-label={tr("ui.select-text-9d4921")} title={tr("ui.select-text-9d4921")}><Quote /></Button>}
        <Button variant="ghost" size="icon-sm" disabled={!page.canInput} onClick={() => send({ type: "reload" })} aria-label={tr("ui.refresh-56e3ba")} title={tr("ui.refresh-56e3ba")}>
          <RotateCw />
        </Button>
      </footer>
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

type RemoteFocus = { editable: boolean; box?: Box; inputMode?: string; enterKeyHint?: string; multiline?: boolean; password?: boolean }

/** Kept in the hidden keyboard field, so a backspace in an otherwise empty field still shows up. */
const SENTINEL = "\u200b"

const inside = (box: Box, at: { x: number; y: number }) => at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height
