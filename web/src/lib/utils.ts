import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** `to` relative to the folder `from` (both relative to the file root), e.g. "../other/x.ts". */
export function relativePath(from: string, to: string) {
  const a = from.split("/").filter(Boolean)
  const b = to.split("/").filter(Boolean)
  let same = 0
  while (same < a.length && same < b.length && a[same] === b[same]) same++
  return [...a.slice(same).map(() => ".."), ...b.slice(same)].join("/") || "."
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function timeAgo(input: string | number) {
  const then = typeof input === "number" ? input : Date.parse(input)
  const seconds = Math.round((Date.now() - then) / 1000)
  if (!Number.isFinite(seconds)) return ""
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}
