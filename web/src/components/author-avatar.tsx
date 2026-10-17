import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const colors = ["bg-blue-100 text-blue-900", "bg-emerald-100 text-emerald-900", "bg-violet-100 text-violet-900", "bg-amber-100 text-amber-900", "bg-rose-100 text-rose-900"]

/** Local, deterministic avatars: no external image requests or personal-data leakage. */
export function AuthorAvatar({ id, name }: { id: string; name: string }) {
  const [version, setVersion] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const refresh = () => { setFailed(false); setVersion((v) => v + 1) }
    window.addEventListener("beezy:avatar", refresh)
    return () => window.removeEventListener("beezy:avatar", refresh)
  }, [])
  useEffect(() => setFailed(false), [id])
  const hash = Array.from(id).reduce((value, character) => (value * 31 + character.codePointAt(0)!) >>> 0, 0)
  const initials = name.trim().split(/[\s._-]+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase()
  if (!failed) return <img key={`${id}:${version}`} src={`/api/users/${encodeURIComponent(id)}/avatar?v=${version}`} alt={`${name} avatar`} title={name} className="size-8 shrink-0 rounded-full object-cover" onError={() => setFailed(true)} />
  return <span role="img" aria-label={`${name} avatar`} title={name} className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-xs font-bold shadow-sm", colors[hash % colors.length])}>{initials || "?"}</span>
}
