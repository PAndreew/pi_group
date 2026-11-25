import { useLocale } from "@/lib/i18n"
import { Copy } from "lucide-react"
import type { ComponentProps } from "react"
import { toast } from "sonner"
import { SiteIcon } from "@/components/site-icon"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

/** Keep the copy action outside the anchor so copying never opens the link. */
export function WebLink({ href, children, className, ...props }: ComponentProps<"a">) {
  const { t: tr } = useLocale()
  return (
    <span className="inline items-baseline">
      <a {...props} href={href} target="_blank" rel="noreferrer noopener" className={cn("break-words", className)}>
        <SiteIcon href={href} className="mr-1" />
        {children}
      </a>
      <button
        type="button"
        aria-label={tr("ui.copy-link-2f84ee")}
        title={tr("ui.copy-link-2f84ee")}
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
