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
