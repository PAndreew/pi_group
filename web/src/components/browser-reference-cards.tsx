import { ChevronRight, ExternalLink, ImageIcon } from "lucide-react"
import { SiteIcon } from "@/components/site-icon"
import { api } from "@/lib/api"
import type { ReferencePage } from "@/lib/element-refs"

function webUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === "http:" || url.protocol === "https:") return url
  } catch { /* non-web browser pages get a plain heading */ }
}

export function BrowserReferenceCards({ pages, screenshots }: { pages: ReferencePage[]; screenshots: Map<string, string> }) {
  if (!pages.length) return null
  return (
    <div aria-label="Browser references" className="mt-1.5 grid min-w-0 gap-1.5">
      {pages.map((page) => {
        const url = webUrl(page.url)
        const name = page.title || url?.host || page.url
        return (
          <div key={page.url} className="grid min-w-0 gap-1.5 rounded-lg border border-current/15 bg-current/5 px-2.5 py-2">
            {url ? (
              <a href={url.href} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center gap-1.5 text-xs hover:underline">
                <SiteIcon href={url.href} />
                <span className="truncate font-semibold">{name}</span>
                {page.title && <span className="truncate opacity-70">{url.host}</span>}
                <ExternalLink aria-hidden="true" className="ml-auto size-3 shrink-0 opacity-70" />
              </a>
            ) : <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold"><SiteIcon /><span className="truncate">{name}</span></div>}
            {page.picks.map((pick, index) => {
              const path = pick.screenshot && screenshots.get(pick.screenshot)
              return (
                <div key={index} className="min-w-0 border-l-2 border-current/20 pl-2">
                  {pick.elements.map((element, i) => (
                    <p key={i} className="wrap-anywhere text-sm">{element.text ? `“${element.text}”` : "Selected element"}</p>
                  ))}
                  <div className="mt-0.5 flex flex-wrap items-start gap-x-3 text-xs">
                    {path && (
                      <a href={api.rawUrl(path)} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-6 items-center gap-1 underline underline-offset-2">
                        <ImageIcon aria-hidden="true" className="size-3" /> View screenshot
                      </a>
                    )}
                    <details className="group min-w-0">
                      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-0.5 opacity-80 hover:opacity-100 [&::-webkit-details-marker]:hidden">
                        <ChevronRight aria-hidden="true" className="size-3 group-open:rotate-90" /> Details
                      </summary>
                      <ul className="grid gap-1 pb-1 pl-1">
                        {pick.elements.map((element, i) => (
                          <li key={i} className="wrap-anywhere">
                            <code>{element.selector}</code>
                            <span className="block opacity-75">{element.bounds}{element.origin && ` · ${element.origin}`}</span>
                          </li>
                        ))}
                      </ul>
                      {pick.screenshot && <p className="wrap-anywhere pl-1 opacity-75">{pick.screenshot}</p>}
                    </details>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
