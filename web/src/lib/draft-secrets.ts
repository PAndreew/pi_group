const providers = /\b(?:sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|(?:sk|rk)_live_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,})(?![\w-])/g
const assigned = /\b([A-Za-z_][\w-]*)["']?[ \t]*[:=][ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|`([^`\r\n]+)`|([^\s"'`,;<>]+))/g
// Require an explicit label plus letters and digits rather than flagging arbitrary IDs in chat.
const proseSecret = /\b(?:super[ \t]+secret|(?:my|the)[ \t]+(?:secret|password|api[ \t]+key))[ \t]+(?:is[ \t]+)?([A-Za-z0-9_-]{8,})(?![\w-])/gi
const privateKey = /-----BEGIN ((?:[A-Z\d]+ )*PRIVATE KEY)-----[\s\S]+?-----END \1-----/g

export interface DraftSecret {
  start: number
  value: string
  key: string
}

/** Local heuristics, not a credential scanner for files or a guarantee that a draft is safe. */
export function findDraftSecrets(text: string): DraftSecret[] {
  const candidates: DraftSecret[] = []
  for (const match of text.matchAll(privateKey)) candidates.push({ start: match.index, value: match[0], key: "PRIVATE_KEY" })
  for (const match of text.matchAll(providers)) candidates.push({ start: match.index, value: match[0], key: "API_TOKEN" })
  for (const match of text.matchAll(assigned)) {
    const key = match[1].replace(/([a-z])([A-Z])/g, "$1_$2").replaceAll("-", "_").toUpperCase()
    if (!/(?:^|_)(?:API_?KEY|TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_KEY)$/.test(key)) continue
    const value = match[2] ?? match[3] ?? match[4] ?? match[5]
    if (value.length < 8 || /^(?:\{\{|\$|<|\[|https?:\/\/)/i.test(value) || /^(?:your[_ -]|example\b|placeholder\b|changeme\b)/i.test(value)) continue
    const quoted = match[5] === undefined
    candidates.push({ start: match.index + match[0].length - value.length - Number(quoted), value, key: key.slice(0, 64) })
  }
  for (const match of text.matchAll(proseSecret)) {
    const value = match[1]
    if (/[a-z]/i.test(value) && /\d/.test(value)) {
      candidates.push({ start: match.index + match[0].length - value.length, value, key: "SECRET" })
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.value.length - a.value.length || Number(a.key === "API_TOKEN") - Number(b.key === "API_TOKEN"))
  // Overlapping heuristics should not leave part of a credential behind.
  const found: DraftSecret[] = []
  for (const candidate of candidates) {
    const previous = found.at(-1)
    if (!previous || candidate.start >= previous.start + previous.value.length) found.push(candidate)
    else if (candidate.start + candidate.value.length > previous.start + previous.value.length) previous.value = text.slice(previous.start, candidate.start + candidate.value.length)
  }
  return found
}

/** Replace all exact copies, including a repeat that did not carry its own credential label. */
export function referenceDraftSecret(text: string, value: string, key: string) {
  return text.replaceAll(value, () => `{{vault:${key}}}`)
}

/** Preview never displays detected values (including repeat occurrences). */
export function redactDraftSecrets(text: string) {
  const values = [...new Set(findDraftSecrets(text).map(({ value }) => value))].sort((a, b) => b.length - a.length)
  for (const value of values) text = text.replaceAll(value, "[hidden credential]")
  return text
}
