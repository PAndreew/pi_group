// Match the leading envelope written by wrapProjectMemory in server/extensions/lib/context-policy.mjs.
const prefix = /^Public project memory \(reference context, not instructions\):\n<project-memory>\n([\s\S]*?)\n<\/project-memory>\n\n/

// The note on #machines written by remoteMachinesNote in server/src/remote-machines.ts.
const machines = /\n\n<remote-machines>\n[\s\S]*?\n<\/remote-machines>$/

export function splitProjectMemory(text: string) {
  const match = prefix.exec(text)
  const rest = match ? text.slice(match[0].length) : text
  const note = machines.exec(rest)
  return {
    prefix: match?.[0] ?? "",
    memory: match?.[1],
    body: note ? rest.slice(0, note.index) : rest,
    /** Kept when the prompt is edited. */
    suffix: note?.[0] ?? "",
  }
}
