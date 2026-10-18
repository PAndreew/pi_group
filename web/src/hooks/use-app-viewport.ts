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
      timers = [100, 300, 700].map(delay => setTimeout(update, delay))
    }
    settle()
    viewport?.addEventListener("resize", settle)
    viewport?.addEventListener("scroll", update)
    window.addEventListener("resize", settle)
    window.addEventListener("focusin", settle)
    window.addEventListener("focusout", settle)
    window.addEventListener("pageshow", settle)
    return () => {
      cancelAnimationFrame(frame)
      timers.forEach(clearTimeout)
      viewport?.removeEventListener("resize", settle)
      viewport?.removeEventListener("scroll", update)
      window.removeEventListener("resize", settle)
      window.removeEventListener("focusin", settle)
      window.removeEventListener("focusout", settle)
      window.removeEventListener("pageshow", settle)
      root.style.removeProperty("--app-height")
      root.style.removeProperty("--app-top")
    }
  }, [])
}
