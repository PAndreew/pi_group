import type { Job, JobStep } from "@/lib/api"

/** HTTP headers edited as "Name: value" lines. */
export function formatHeaders(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n")
}

export function parseHeaders(text: string) {
  const headers: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf(":")
    if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return headers
}

export function blankStep(type: JobStep["type"]): JobStep {
  if (type === "prompt") return { type, text: "" }
  if (type === "script") return { type, command: "", timeoutSec: 60 }
  return { type, method: "GET", url: "", headers: {}, timeoutSec: 30 }
}

export type JobStatus = "running" | "approval" | "paused" | "failing" | "active"

export function jobStatus(job: Job): JobStatus {
  if (job.running) return "running"
  if (!job.approved) return "approval"
  if (!job.enabled) return "paused"
  if (job.lastRun && !job.lastRun.ok) return "failing"
  return "active"
}
