import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { api, type SessionTools } from "@/lib/api"

/** Skill suggestions for the direct-session composer; dismissal never changes the draft. */
export function SkillDropup({ value, sessionKey, onChange }: { value: string; sessionKey: string; onChange: (value: string) => void }) {
  const [resources, setResources] = useState<SessionTools["resources"]>([])
  const [dismissed, setDismissed] = useState<string>()

  useEffect(() => {
    let alive = true
    void api.tools(sessionKey).then((r) => {
      if (alive) setResources(r.resources)
    }, () => {})
    return () => { alive = false }
  }, [sessionKey])

  const match = /(^|\s)\/([^\s/]*)$/.exec(value)
  const query = match?.[2].replace(/^skill:/, "").toLowerCase() ?? ""
  const skills = match ? resources.filter((r) => r.kind === "skill" && r.name.toLowerCase().includes(query)) : []
  if (!match || dismissed === value || !skills.length) return null

  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-1 flex max-h-64 w-full flex-col rounded-md border bg-popover shadow-md"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          setDismissed(value)
        }
      }}
    >
      <div className="flex shrink-0 justify-end px-1 pt-1">
        <button type="button" aria-label="Dismiss skill suggestions" className="rounded p-1.5 hover:bg-accent" onClick={() => setDismissed(value)}>
          <X className="size-4" />
        </button>
      </div>
      <div className="chat-scroll-fade min-h-0 flex-1 overflow-y-auto px-1 py-2">
      {skills.map((skill) => (
        <button
          type="button"
          key={skill.path ?? skill.name}
          title={skill.description}
          className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          onClick={() => onChange(value.slice(0, value.length - match[2].length - 1) + `/skill:${skill.name} `)}
        >
          /skill:{skill.name}
        </button>
      ))}
      </div>
    </div>
  )
}
