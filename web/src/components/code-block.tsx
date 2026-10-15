import hljs from "highlight.js/lib/common"
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"

const EXT_LANG: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  json: "json", jsonl: "json", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", cfg: "ini",
  conf: "ini", env: "bash", md: "markdown", html: "xml", htm: "xml", xml: "xml", svg: "xml", css: "css", scss: "scss", less: "less",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift", rb: "ruby",
  php: "php", pl: "perl", lua: "lua", r: "r", sql: "sql", cs: "csharp", vb: "vbnet", diff: "diff", patch: "diff", makefile: "makefile",
  dockerfile: "dockerfile", graphql: "graphql", m: "objectivec", wasm: "wasm",
}

export function languageFor(path: string): string | undefined {
  const name = path.split("/").pop()?.toLowerCase() ?? ""
  if (name === "makefile") return "makefile"
  if (name === "dockerfile") return "dockerfile"
  const ext = name.includes(".") ? name.split(".").pop()! : ""
  return EXT_LANG[ext]
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  className,
  wrap = false,
}: {
  code: string
  language?: string
  className?: string
  wrap?: boolean
}) {
  const html = useMemo(() => {
    if (code.length > 400_000) return undefined
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      // fall through to plain text
    }
    return undefined
  }, [code, language])
  return (
    <pre className={cn("scrollbar-thin overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre", className)}>
      {html !== undefined ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
    </pre>
  )
})
