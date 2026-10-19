const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const DRIVE = /^[a-z]:[/]/i

/**
 * The shared-root path a markdown link points at, or undefined for web links and anchors.
 * Relative targets resolve against `base` (the chat or session folder); absolute ones must sit under `root`.
 */
export function fileLinkPath(href: string | undefined, base: string, root?: string): string | undefined {
  if (!href || href.startsWith("#") || href.startsWith("//")) return undefined
  let target = href.replace(/\\/g, "/")
  if (target.toLowerCase().startsWith("file://")) target = target.slice("file://".length)
  else if (SCHEME.test(target) && !DRIVE.test(target)) return undefined
  try { target = decodeURI(target) } catch { /* keep as written */ }
  target = target.replace(/[?#].*$/, "")
  if (target.startsWith("/") || DRIVE.test(target)) {
    if (!root) return undefined
    const prefix = root.replace(/\\/g, "/").replace(/[/]+$/, "")
    const abs = DRIVE.test(target.slice(1)) ? target.slice(1) : target
    const windows = DRIVE.test(prefix)
    const inside = windows ? abs.toLowerCase().startsWith(`${prefix.toLowerCase()}/`) : abs.startsWith(`${prefix}/`)
    if (!inside) return undefined
    target = abs.slice(prefix.length + 1)
    base = ""
  }
  const parts = base.split("/").filter(Boolean)
  for (const part of target.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.length ? parts.join("/") : undefined
}
