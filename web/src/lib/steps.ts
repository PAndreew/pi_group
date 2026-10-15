import type { AgentMessage } from "./api"

export type StepKind = "thinking" | "text" | "bash" | "read" | "edit" | "write" | "search" | "tool" | "summary" | "error"

export interface Step {
  key: string
  kind: StepKind
  /** 1-based position inside its run. */
  index: number
  title: string
  status: "running" | "done" | "error"
  text?: string
  toolCall?: { id: string; name: string; arguments: Record<string, any>; partialArgs?: string }
  result?: AgentMessage
  liveOutput?: string
  message?: AgentMessage
  timestamp?: number
}

export interface Run {
  key: string
  user?: AgentMessage
  steps: Step[]
  /** Text of the run's last step when it is a plain answer: shown under the strip. */
  answer?: string
  answerStreaming: boolean
  running: boolean
}

export function toolKind(name: string): StepKind {
  const n = name.toLowerCase()
  if (n === "bash" || n === "shell" || n === "powershell") return "bash"
  if (n === "read" || n === "read_file") return "read"
  if (n === "edit" || n === "multiedit" || n === "apply_patch") return "edit"
  if (n === "write" || n === "write_file") return "write"
  if (["grep", "find", "ls", "glob", "search", "tool_search"].includes(n)) return "search"
  return "tool"
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((c: any) => (c?.type === "text" ? c.text ?? "" : "")).join("")
}

export function toolTitle(name: string, args: Record<string, any> | undefined): string {
  const a = args ?? {}
  const path = a.path ?? a.file_path ?? a.filePath
  if (a.command) return String(a.command).split("\n")[0]
  if (path) return String(path)
  if (a.pattern) return String(a.pattern)
  if (a.query) return String(a.query)
  return name
}

interface Live {
  partial: AgentMessage | null
  toolOutputs: Record<string, string>
  runningTools: string[]
  running: boolean
}

/** Group messages into runs (one per user prompt) made of small steps for the horizontal strip. */
export function buildRuns(messages: AgentMessage[], live: Live): Run[] {
  const runs: Run[] = []
  const byCall = new Map<string, Step>()
  let current: Run | undefined

  const run = () => {
    if (!current) {
      current = { key: `run-${runs.length}`, steps: [], answerStreaming: false, running: false }
      runs.push(current)
    }
    return current
  }

  const add = (step: Omit<Step, "index" | "key">) => {
    const r = run()
    const full: Step = { ...step, index: r.steps.length + 1, key: `${r.key}-${r.steps.length}` }
    r.steps.push(full)
    return full
  }

  const addAssistant = (m: AgentMessage, streaming: boolean) => {
    const blocks: any[] = Array.isArray(m.content) ? m.content : []
    blocks.forEach((b, i) => {
      if (!b) return
      const last = streaming && i === blocks.length - 1
      if (b.type === "thinking") {
        if (!b.thinking && !last) return
        add({ kind: "thinking", title: "Reasoning", status: last ? "running" : "done", text: b.redacted ? "(redacted reasoning)" : b.thinking, message: m, timestamp: m.timestamp })
      } else if (b.type === "text") {
        if (!b.text?.trim() && !last) return
        add({ kind: "text", title: "Answer", status: last ? "running" : "done", text: b.text, message: m, timestamp: m.timestamp })
      } else if (b.type === "toolCall") {
        const step = add({
          kind: toolKind(b.name ?? ""),
          title: toolTitle(b.name, b.arguments),
          status: "running",
          toolCall: { id: b.id, name: b.name, arguments: b.arguments ?? {}, partialArgs: b.partialArgs },
          message: m,
          timestamp: m.timestamp,
        })
        if (b.id) byCall.set(b.id, step)
      }
    })
    if (!streaming && (m.stopReason === "error" || m.stopReason === "aborted")) {
      add({
        kind: "error",
        title: m.stopReason === "aborted" ? "Interrupted" : "Error",
        status: "error",
        text: m.errorMessage ?? (m.stopReason === "aborted" ? "The run was interrupted." : "The model returned an error."),
        message: m,
        timestamp: m.timestamp,
      })
    }
  }

  for (const m of messages) {
    switch (m.role) {
      case "user":
        current = { key: `run-${runs.length}`, user: m, steps: [], answerStreaming: false, running: false }
        runs.push(current)
        break
      case "assistant":
        addAssistant(m, false)
        break
      case "toolResult": {
        const step = byCall.get(m.toolCallId)
        if (step) {
          step.result = m
          step.status = m.isError ? "error" : "done"
        } else {
          add({ kind: toolKind(m.toolName ?? ""), title: m.toolName ?? "tool", status: m.isError ? "error" : "done", result: m, timestamp: m.timestamp })
        }
        break
      }
      case "bashExecution":
        add({
          kind: "bash",
          title: m.command,
          status: m.exitCode && m.exitCode !== 0 ? "error" : "done",
          toolCall: { id: `bash-${m.timestamp}`, name: "bash", arguments: { command: m.command } },
          result: { role: "toolResult", content: [{ type: "text", text: m.output }], isError: Boolean(m.exitCode) },
          timestamp: m.timestamp,
        })
        break
      case "compactionSummary":
      case "branchSummary":
        add({ kind: "summary", title: m.role === "compactionSummary" ? "Context compacted" : "Branch summary", status: "done", text: m.summary, timestamp: m.timestamp })
        break
      case "custom":
        add({ kind: "text", title: m.customType ?? "Note", status: "done", text: messageText(m.content), timestamp: m.timestamp })
        break
    }
  }

  if (live.partial) addAssistant(live.partial, true)

  // Tool calls without results are running, or were cut off if the run is over.
  for (const step of byCall.values()) {
    if (step.result) continue
    const id = step.toolCall!.id
    if (live.toolOutputs[id] !== undefined) step.liveOutput = live.toolOutputs[id]
    step.status = live.running ? "running" : "error"
    if (!live.running && !live.runningTools.includes(id)) step.liveOutput ??= "(no result: the run ended before this tool finished)"
  }

  const last = runs.at(-1)
  if (last) last.running = live.running
  for (const r of runs) {
    const tail = r.steps.at(-1)
    if (tail?.kind === "text" && tail.text) {
      r.answer = tail.text
      r.answerStreaming = tail.status === "running"
    }
  }
  return runs
}
