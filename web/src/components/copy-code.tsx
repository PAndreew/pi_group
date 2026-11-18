import { Check, Copy } from "lucide-react"
import { createContext, useState, type ComponentProps } from "react"
import { toast } from "sonner"
import { copyText } from "@/lib/clipboard"

/** True inside a fenced block, whose `code` is not an inline value. */
export const InPre = createContext(false)

/**
 * Inline code with a copy button, for the passwords, tokens and commands the agent puts in
 * backticks. The button shows on hover with a mouse; on touch screens it always shows and a tap
 * on the value copies too.
 */
export function CopyCode({ children, ...props }: ComponentProps<"code">) {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) =>
    void copyText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      (error) => toast.error((error as Error).message),
    )
  const text = (node: HTMLElement) => node.closest("[data-copy-code]")?.querySelector("code")?.textContent ?? ""
  return (
    <span data-copy-code className="group/copy inline">
      <code {...props} onClick={(e) => matchMedia("(hover: none)").matches && copy(text(e.currentTarget))}>{children}</code>
      <button
        type="button"
        aria-label="Copy"
        title="Copy"
        className="ml-0.5 inline-flex cursor-pointer rounded p-0.5 align-[-0.2em] text-gray-400 hover:text-gray-600 focus-visible:opacity-100 focus-visible:outline-2 dark:text-gray-500 dark:hover:text-gray-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/copy:opacity-100"
        onClick={(e) => copy(text(e.currentTarget))}
      >
        {copied ? <Check aria-hidden="true" className="size-3 text-green-600" /> : <Copy aria-hidden="true" className="size-3" />}
      </button>
    </span>
  )
}
