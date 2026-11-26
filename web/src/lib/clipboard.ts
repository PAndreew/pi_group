/** Clipboard API where allowed, with a fallback for plain-HTTP LAN use. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text, readOnly: true })
    area.style.cssText = "position:fixed;opacity:0"
    document.body.append(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    if (!ok) throw new Error("Copy is not available here")
  }
}

/**
 * Copies text that is still on its way (from the server), from within a click or key press.
 * Safari only lets a page write the clipboard during the gesture itself, which a promise in a
 * ClipboardItem allows; elsewhere, copy once the text is there.
 */
export async function copyTextLater(text: Promise<string>) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) })])
      return
    } catch {
      // Not supported here, or the text never came; settle below.
    }
  }
  await copyText(await text)
}
