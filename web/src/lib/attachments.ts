import { fileLinkPath } from "./file-link.ts"

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i
const VIDEO = /\.(mp4|m4v|mov|webm|ogv)$/i
const MEDIA = new RegExp(`${IMAGE.source}|${VIDEO.source}`, "i")
const ATTACHED = "Attached files (relative to the working directory):"

export const isVideo = (path: string) => VIDEO.test(path)

/** Where uploads of a chat or session go: an `uploads` folder inside the folder it works in. */
export const uploadDir = (folder: string) => (folder ? `${folder}/uploads` : "uploads")

/**
 * Shared-root paths of the images a message refers to: `path` tokens (root-relative, as the chat
 * composers insert them) and the attachment list of agent prompts (relative to the session `folder`).
 */
export function imageRefs(text: string, folder = ""): string[] {
  return refs(text, folder, IMAGE)
}

/** Like `imageRefs`, with videos too: everything a message shows as media under its text. */
export function mediaRefs(text: string, folder = ""): string[] {
  return refs(text, folder, MEDIA)
}

function refs(text: string, folder: string, kind: RegExp): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const path = fileLinkPath(match[1].trim(), "")
    if (path && kind.test(path)) found.push(path)
  }
  const list = text.indexOf(ATTACHED)
  if (list >= 0) {
    for (const line of text.slice(list + ATTACHED.length).split("\n")) {
      const item = /^- (.+)$/.exec(line.trim())
      const path = item && fileLinkPath(item[1].trim(), folder)
      if (path && kind.test(path)) found.push(path)
    }
  }
  return [...new Set(found)]
}

/** The text without the images and videos of the attachment list agent prompts carry for the model (they show as media). */
export function withoutAttachmentList(text: string) {
  const list = text.indexOf(ATTACHED)
  if (list < 0) return text
  const others = text.slice(list + ATTACHED.length).split("\n").filter((line) => line.trim() && !(/^- /.test(line.trim()) && MEDIA.test(line.trim())))
  const body = text.slice(0, list).trimEnd()
  return others.length ? `${body}\n\nAttached files:\n${others.join("\n")}`.trim() : body
}
