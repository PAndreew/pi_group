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
        root.style.setProperty("--app-height", `${viewport?.height ?? window.innerHeight}px`)
        root.style.setProperty("--app-top", `${viewport?.offsetTop ?? 0}px`)
      })
    }
    const settle = () => {
      update()
      timers.forEach(clearTimeout)
      timers = [100, 300, 700, 1200].map(delay => setTimeout(update, delay))
    }
    /** Leaving the app with the keyboard up keeps the shrunken viewport on return (iOS fires no
     * resize then): drop focus on the way out so the keyboard closes, and re-measure on the way back. */
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        const active = document.activeElement
        if (active instanceof HTMLElement && active.matches("textarea, input")) active.blur()
      } else settle()
    }
    settle()
    viewport?.addEventListener("resize", settle)
    viewport?.addEventListener("scroll", update)
    window.addEventListener("resize", settle)
    window.addEventListener("focusin", settle)
    window.addEventListener("focusout", settle)
    window.addEventListener("pageshow", settle)
    window.addEventListener("focus", settle)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach(clearTimeout)
      viewport?.removeEventListener("resize", settle)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", settle)
      window.removeEventListener("focusin", settle)
      window.removeEventListener("focusout", settle)
      window.removeEventListener("pageshow", settle)
      window.removeEventListener("focus", settle)
      document.removeEventListener("visibilitychange", visibility)
      root.style.removeProperty("--app-height")
      root.style.removeProperty("--app-top")
    }
  }, [])
}
