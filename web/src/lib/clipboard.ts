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
