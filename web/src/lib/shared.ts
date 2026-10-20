export interface SharedMessage {
  label: string
  /** App route of the source (`#s=…` or `#c=…`); absent on messages shared before it was added. */
  href?: string
  body: string
}

/** Splits a message shared from another session or chat ("Shared from [label](#route):\n\nbody") into its parts. */
export function parseShared(text: string): SharedMessage | undefined {
  const match = /^Shared from (?:\[([^\]\n]+)\]\((#[^)\s]*)\)|([^\n]+?)):\n\n([\s\S]*)$/.exec(text)
  if (!match) return undefined
  return { label: match[1] ?? match[3], href: match[2], body: match[4] }
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const TRAILING = /[.,;:!?'"\]}>]+$/

/** Text split into plain runs and web links (http, https or www.), with sentence punctuation left out of links. */
export function linkify(text: string): ({ text: string } | { url: string; href: string })[] {
  const parts: ({ text: string } | { url: string; href: string })[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0].replace(TRAILING, "")
    // A closing parenthesis belongs to the link only if it opens one too, as in Wikipedia links.
    while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1).replace(TRAILING, "")
    const start = match.index
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ url, href: url.toLowerCase().startsWith("www.") ? `https://${url}` : url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
