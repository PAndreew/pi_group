import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { useEffect } from "react"
import { CodeBlock, languageFor } from "@/components/code-block"
import { Markdown } from "@/components/markdown"
import { STEP_ICON, STEP_LABEL } from "@/components/step-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { messageText, type Step } from "@/lib/steps"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      {children}
    </div>
  )
}

function ResultImages({ step }: { step: Step }) {
  const images = (Array.isArray(step.result?.content) ? step.result!.content : []).filter((c: any) => c?.type === "image")
  if (images.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img: any, i: number) => (
        <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="max-h-80 rounded border" />
      ))}
    </div>
  )
}

function output(step: Step) {
  if (step.result) return messageText(step.result.content)
  return step.liveOutput ?? ""
}

function Diff({ oldText, newText }: { oldText?: string; newText?: string }) {
  return (
    <div className="overflow-hidden rounded-md border font-mono text-xs">
      {oldText !== undefined && (
        <pre className="scrollbar-thin overflow-x-auto bg-red-500/10 p-2 whitespace-pre text-red-700 dark:text-red-300">
          {oldText
            .split("\n")
            .map((l) => `- ${l}`)
            .join("\n")}
        </pre>
      )}
      {newText !== undefined && (
        <pre className="scrollbar-thin overflow-x-auto bg-green-500/10 p-2 whitespace-pre text-green-700 dark:text-green-300">
          {newText
            .split("\n")
            .map((l) => `+ ${l}`)
            .join("\n")}
        </pre>
      )}
    </div>
  )
}

function StepBody({ step }: { step: Step }) {
  const args = step.toolCall?.arguments ?? {}
  const path: string | undefined = args.path ?? args.file_path ?? args.filePath
  const out = output(step)
  const isError = step.status === "error"
  const outBlock = (title = "Output") =>
    step.status === "running" && !out ? (
      <Section title={title}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> running…
        </div>
      </Section>
    ) : (
      <Section title={isError ? "Error" : title}>
        <CodeBlock code={out || "(empty)"} wrap className={isError ? "text-destructive" : undefined} />
      </Section>
    )

  switch (step.kind) {
    case "thinking":
      return <div className="text-sm whitespace-pre-wrap text-muted-foreground italic">{step.text || "…"}</div>
    case "text":
    case "summary":
      return <Markdown text={step.text ?? ""} />
    case "error":
      return <div className="text-sm whitespace-pre-wrap text-destructive">{step.text}</div>
    case "bash":
      return (
        <div className="space-y-4">
          <Section title="Command">
            <CodeBlock code={String(args.command ?? step.toolCall?.partialArgs ?? "")} language="bash" wrap />
          </Section>
          {args.timeout && <div className="text-xs text-muted-foreground">timeout: {args.timeout}s</div>}
          {outBlock()}
        </div>
      )
    case "read":
      return (
        <div className="space-y-4">
          <Section title="File">
            <code className="text-sm break-all">{path}</code>
            {(args.offset || args.limit) && (
              <div className="text-xs text-muted-foreground">
                lines {args.offset ?? 1}
                {args.limit ? `–${(args.offset ?? 1) + args.limit - 1}` : "+"}
              </div>
            )}
          </Section>
          <ResultImages step={step} />
          {step.result && !isError ? (
            <Section title="Content">
              <CodeBlock code={out} language={path ? languageFor(path) : undefined} />
            </Section>
          ) : (
            outBlock()
          )}
        </div>
      )
    case "edit": {
      const edits: { oldText?: string; newText?: string }[] = Array.isArray(args.edits) ? args.edits : [{ oldText: args.oldText ?? args.old_string, newText: args.newText ?? args.new_string }]
      return (
        <div className="space-y-4">
          <Section title="File">
            <code className="text-sm break-all">{path}</code>
          </Section>
          <Section title={edits.length > 1 ? `${edits.length} changes` : "Change"}>
            <div className="space-y-2">
              {edits.map((e, i) => (
                <Diff key={i} oldText={e.oldText} newText={e.newText} />
              ))}
            </div>
          </Section>
          {(step.result || step.status === "running") && outBlock("Result")}
        </div>
      )
    }
    case "write":
      return (
        <div className="space-y-4">
          <Section title="File">
            <code className="text-sm break-all">{path}</code>
          </Section>
          <Section title="Content">
            <CodeBlock code={String(args.content ?? step.toolCall?.partialArgs ?? "")} language={path ? languageFor(path) : undefined} />
          </Section>
          {(step.result || step.status === "running") && outBlock("Result")}
        </div>
      )
    default:
      return (
        <div className="space-y-4">
          <Section title={`Arguments · ${step.toolCall?.name ?? step.result?.toolName ?? "tool"}`}>
            <CodeBlock code={step.toolCall?.partialArgs && !Object.keys(args).length ? step.toolCall.partialArgs : JSON.stringify(args, null, 2)} language="json" wrap />
          </Section>
          <ResultImages step={step} />
          {outBlock("Result")}
        </div>
      )
  }
}

export function StepDialog({ steps, index, onIndex }: { steps: Step[]; index: number | null; onIndex: (index: number | null) => void }) {
  const step = index === null ? undefined : steps[index]

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1)
      if (e.key === "ArrowRight" && index < steps.length - 1) onIndex(index + 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, steps.length, onIndex])

  const Icon = step ? STEP_ICON[step.kind] : null
  const usage = step?.message?.usage
  return (
    <Dialog open={Boolean(step)} onOpenChange={(open) => !open && onIndex(null)}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-3 p-4 sm:max-w-3xl sm:p-5">
        {step && Icon && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Icon className="size-4 shrink-0" />
                <span className="shrink-0">
                  {step.index}. {step.kind === "tool" ? (step.toolCall?.name ?? "Tool") : STEP_LABEL[step.kind]}
                </span>
                {step.status === "running" && <Badge variant="secondary">running</Badge>}
                {step.status === "error" && <Badge variant="destructive">error</Badge>}
              </DialogTitle>
              <DialogDescription className="truncate font-mono text-xs">
                {step.kind === "thinking" || step.kind === "text" ? (step.message?.model ? `${step.message.provider}/${step.message.model}` : "") : step.title}
              </DialogDescription>
            </DialogHeader>
            <div className="scrollbar-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <StepBody step={step} />
            </div>
            <div className="flex items-center gap-2 border-t pt-3">
              <Button variant="outline" size="sm" disabled={index === 0} onClick={() => onIndex(index! - 1)}>
                <ChevronLeft /> Prev
              </Button>
              <span className="flex-1 truncate text-center text-xs text-muted-foreground">
                {step.index} / {steps.length}
                {usage?.totalTokens ? ` · ${usage.totalTokens.toLocaleString()} tok` : ""}
                {step.timestamp ? ` · ${new Date(step.timestamp).toLocaleTimeString()}` : ""}
              </span>
              <Button variant="outline" size="sm" disabled={index === steps.length - 1} onClick={() => onIndex(index! + 1)}>
                Next <ChevronRight />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
