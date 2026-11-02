import { Copy, Globe } from "lucide-react"
import type { ComponentProps } from "react"
import { toast } from "sonner"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

/** Keep the copy action outside the anchor so copying never opens the link. */
export function WebLink({ href, children, className, ...props }: ComponentProps<"a">) {
  return (
    <span className="inline items-baseline">
      <a {...props} href={href} target="_blank" rel="noreferrer noopener" className={cn("break-words", className)}>
        <Globe aria-hidden="true" className="mr-1 inline size-3.5 align-[-0.125em]" />
        {children}
      </a>
      <button
        type="button"
        aria-label="Copy link"
        title="Copy link"
        className="ml-1 inline-flex cursor-pointer rounded p-0.5 align-[-0.2em] text-gray-400 hover:text-gray-600 focus-visible:outline-2 dark:text-gray-500 dark:hover:text-gray-300"
        onClick={() => {
          if (href) void copyText(href).then(() => toast.success("Link copied"), (error) => toast.error((error as Error).message))
        }}
      >
        <Copy aria-hidden="true" className="size-3" />
      </button>
    </span>
  )
}
