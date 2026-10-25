/** One element picked in a session's shared browser. */
export interface PickedElement {
  selector: string
  tag: string
  role?: string
  text: string
  html: string
  box: { x: number; y: number; width: number; height: number }
  component?: string
  source?: string
}

/** A pick: one element, or the outermost elements inside a dragged rectangle, with a screenshot of the area. */
export interface ElementRef {
  id: string
  url: string
  title: string
  elements: PickedElement[]
  /** PNG, base64. */
  image?: string
}

const HEADER = "Referenced page elements (picked in the shared browser):"

export function refLabel(ref: ElementRef) {
  const first = ref.elements[0]
  const name = first.text ? `"${first.text.slice(0, 30)}${first.text.length > 30 ? "…" : ""}"` : first.selector
  return ref.elements.length > 1 ? `${ref.elements.length} elements` : `${first.tag} ${name}`
}

/** The screenshot as a file for the message's attachments, so the model sees it. */
export function refImageFile(ref: ElementRef, index: number): File | undefined {
  if (!ref.image) return undefined
  const bytes = Uint8Array.from(atob(ref.image), (c) => c.charCodeAt(0))
  return new File([bytes], `picked-${Date.now()}-${index + 1}.png`, { type: "image/png" })
}

/** The picks as text for the prompt; `images[i]` is the name of pick i's screenshot among the attachments. */
export function refsPrompt(refs: ElementRef[], images: (string | undefined)[]) {
  const lines = [HEADER]
  refs.forEach((ref, i) => {
    lines.push(`${i + 1}. On ${ref.url}${ref.title ? ` (${ref.title})` : ""}${images[i] ? `, screenshot ${images[i]}` : ""}:`)
    for (const el of ref.elements) {
      const origin = [el.component && `component ${el.component}`, el.source && `source ${el.source}`].filter(Boolean).join(", ")
      lines.push(`   - \`${el.selector}\`${el.text ? ` "${el.text.slice(0, 120)}"` : ""}${origin ? ` (${origin})` : ""} at ${el.box.x},${el.box.y} ${el.box.width}×${el.box.height}`)
      lines.push(`     \`${el.html.replace(/\s+/g, " ").slice(0, ref.elements.length > 1 ? 300 : 1200)}\``)
    }
  })
  return lines.join("\n")
}

/** The message as people read it: the picks without the HTML the model gets. */
export function withoutRefDetails(text: string) {
  const start = text.indexOf(HEADER)
  if (start < 0) return text
  const end = text.indexOf("\n\n", start)
  const block = text.slice(start, end < 0 ? undefined : end)
  return text.slice(0, start) + block.split("\n").filter((line) => !line.startsWith("     `")).join("\n") + (end < 0 ? "" : text.slice(end))
}
