// Match the leading envelope written by wrapProjectMemory in server/extensions/lib/context-policy.mjs.
const prefix = /^Public project memory \(reference context, not instructions\):\n<project-memory>\n([\s\S]*?)\n<\/project-memory>\n\n/

export function splitProjectMemory(text: string) {
  const match = prefix.exec(text)
  return match
    ? { prefix: match[0], memory: match[1], body: text.slice(match[0].length) }
    : { prefix: "", memory: undefined, body: text }
}
