import { useEffect } from "react"

/** Safari keeps the layout viewport behind its software keyboard. Size the
 * app to the visible viewport, including its pan, without disabling zoom. */
export function useAppViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let frame = 0
    let timers: ReturnType<typeof setTimeout>[] = []
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
        const editing = document.activeElement instanceof HTMLElement && document.activeElement.matches('textarea, input, [contenteditable="true"]')
        root.style.setProperty("--app-height", `${editing ? (viewport?.height ?? window.innerHeight) : window.innerHeight}px`)
        root.style.setProperty("--app-top", `${editing ? (viewport?.offsetTop ?? 0) : 0}px`)
      })
    }
    const settle = () => {
      update()
      timers.forEach(clearTimeout)
      timers = [100, 300, 700, 1200].map(delay => setTimeout(update, delay))
    }
    /** Leaving the app with the keyboard up keeps the shrunken viewport on return (iOS fires no
     * resize then): drop focus on the way out so the keyboard closes, and re-measure on the way back. */
    const blurEditor = () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && active.matches('textarea, input, [contenteditable="true"]')) active.blur()
    }
    const resume = () => {
      blurEditor()
      settle()
    }
    const visibility = () => {
      blurEditor()
      if (document.visibilityState !== "hidden") settle()
    }
    settle()
    viewport?.addEventListener("resize", settle)
    viewport?.addEventListener("scroll", update)
    window.addEventListener("resize", settle)
    window.addEventListener("focusin", settle)
    window.addEventListener("focusout", settle)
    window.addEventListener("pagehide", blurEditor)
    window.addEventListener("pageshow", resume)
    window.addEventListener("focus", resume)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach(clearTimeout)
      viewport?.removeEventListener("resize", settle)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", settle)
      window.removeEventListener("focusin", settle)
      window.removeEventListener("focusout", settle)
      window.removeEventListener("pagehide", blurEditor)
      window.removeEventListener("pageshow", resume)
      window.removeEventListener("focus", resume)
      document.removeEventListener("visibilitychange", visibility)
      root.style.removeProperty("--app-height")
      root.style.removeProperty("--app-top")
    }
  }, [])
}
