import { cn } from "@/lib/utils"

const colors = ["bg-blue-100 text-blue-900", "bg-emerald-100 text-emerald-900", "bg-violet-100 text-violet-900", "bg-amber-100 text-amber-900", "bg-rose-100 text-rose-900"]

/** Local, deterministic avatars: no external image requests or personal-data leakage. */
export function AuthorAvatar({ id, name }: { id: string; name: string }) {
  const hash = Array.from(id).reduce((value, character) => (value * 31 + character.codePointAt(0)!) >>> 0, 0)
  const initials = name.trim().split(/[\s._-]+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase()
  return <span aria-hidden="true" className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold", colors[hash % colors.length])}>{initials || "?"}</span>
}
