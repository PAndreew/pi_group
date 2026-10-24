export interface ReplyTarget {
  author: string
  text: string
  sourceId: string
  assistant?: boolean
}

/** Plain prompt text, never a session rewrite or a branch. Quoted mentions
 * must not invite people or trigger pi; only the new message may do that. */
export function replyPrompt(text: string, reply?: ReplyTarget, group = false): string {
  if (!reply) return text
  const quote = reply.text.replace(/@/g, "@\u200b").split("\n").map((line) => `> ${line}`).join("\n")
  const author = reply.author.replace(/[\r\n]/g, " ").replace(/@/g, "@\u200b")
  return `${group && reply.assistant ? "@pi " : ""}Replying to ${author}:\n${quote}\n\n${text}`
}

export interface ParsedReply { author: string; quote: string; body: string }

/** Reverses replyPrompt so a sent reply can show its quote apart from the new text. */
export function parseReply(text: string): ParsedReply | undefined {
  const match = /^(?:@pi )?Replying to ([^\n]*):\n((?:>[^\n]*(?:\n|$))+)\n?([\s\S]*)$/.exec(text)
  if (!match) return undefined
  const unescape = (s: string) => s.replace(/@\u200b/g, "@")
  const quote = match[2].replace(/\n$/, "").split("\n").map((line) => line.replace(/^> ?/, "")).join("\n")
  return { author: unescape(match[1]), quote: unescape(quote), body: match[3] }
}

/**
 * Which of the earlier messages (`sources`, oldest first) a reply quotes: the nearest one with the
 * same text, else the nearest one still containing the quote's first line (edited since). -1 if none.
 */
export function findReplySource(sources: string[], quote: string): number {
  const normal = (s: string) => s.replace(/\s+/g, " ").trim()
  const wanted = normal(quote)
  if (!wanted) return -1
  for (let i = sources.length - 1; i >= 0; i--) if (normal(sources[i]) === wanted) return i
  const head = normal(quote.split("\n").find((line) => line.trim()) ?? "").slice(0, 80)
  for (let i = sources.length - 1; i >= 0; i--) if (normal(sources[i]).includes(head)) return i
  return -1
}

/** `text` with its new part replaced by `body`, keeping the quote of a reply. */
export function replaceReplyBody(text: string, body: string): string {
  const reply = parseReply(text)
  return reply ? text.slice(0, text.length - reply.body.length) + body : body
}
