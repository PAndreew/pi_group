import { MessageTime } from "@/components/message-time"

/** The line above every bubble, human or agent: name, send time, then extras (an agent's run details). */
export function MessageHeader({ name, at, edited, children }: { name: string; at?: string | number; edited?: boolean; children?: React.ReactNode }) {
  return (
    <div className="mb-1 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="min-w-0 wrap-anywhere font-semibold text-gray-500 dark:text-gray-300">{name}</span>
      <MessageTime at={at} edited={edited} />
      {children}
    </div>
  )
}
