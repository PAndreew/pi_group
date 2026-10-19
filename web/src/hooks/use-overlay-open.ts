import { useEffect, useState } from "react"

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]'

/** Whether any dialog, popup, menu or suggestion list is on screen, so lesser UI can step aside. */
export function useOverlayOpen() {
  const [open, setOpen] = useState(() => typeof document !== "undefined" && Boolean(document.querySelector(OVERLAY)))
  useEffect(() => {
    const check = () => setOpen(Boolean(document.querySelector(OVERLAY)))
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    check()
    return () => observer.disconnect()
  }, [])
  return open
}
