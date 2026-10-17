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
      className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          setDismissed(value)
        }
      }}
    >
      <div className="flex justify-end">
        <button type="button" aria-label="Dismiss skill suggestions" className="rounded p-1 hover:bg-accent" onClick={() => setDismissed(value)}>
          <X className="size-4" />
        </button>
      </div>
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
  )
}
