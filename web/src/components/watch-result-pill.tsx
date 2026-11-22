import { Clock } from "lucide-react"

// Recognize the prompt envelope from wakeText in server/src/watches.ts, including batched results.
const watchHeader = /^⏱ Watch “[^\r\n]+” fired · [^\r\n]+\r?\n\r?\n/
const watchFooter = /\r?\n\r?\nContinue with the task this was waiting for\.$/

export function isWatchResult(text: string) {
  const trimmed = text.trimEnd()
  return watchHeader.test(trimmed) && watchFooter.test(trimmed)
}

export function WatchResultPill({ text }: { text: string }) {
  return (
    <details className="mb-1.5 min-w-0">
      <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-1.5 rounded-full border border-sky-500/60 bg-[linear-gradient(165deg,#aec9e0_0%,#edf8ff_38%,#88afd2_64%,#c7e1f4_100%)] px-2.5 py-1 text-xs font-medium text-sky-950 shadow-xs hover:brightness-105 focus-visible:outline-2 focus-visible:outline-sky-700 [&::-webkit-details-marker]:hidden">
        <Clock className="size-3.5 shrink-0" aria-hidden="true" /> Watch results
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-sky-300 bg-white/70 p-2 text-xs whitespace-pre-wrap wrap-anywhere">{text}</pre>
    </details>
  )
}
