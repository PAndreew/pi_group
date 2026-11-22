import { Globe } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

function faviconUrl(href?: string) {
  if (!href) return undefined
  try {
    const { protocol, hostname } = new URL(href)
    // Only send a DNS hostname to the icon service, never the full link, an IP or a local name.
    if (!/^https?:$/.test(protocol) || !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(hostname) || /\.(?:localhost|local|internal|test|invalid|example|lan|home|onion|arpa)$/i.test(hostname)) return undefined
    return `https://www.google.com/s2/favicons?${new URLSearchParams({ domain: hostname, sz: "32" })}`
  } catch {
    return undefined
  }
}

const globe = <Globe className="size-3" />

function Favicon({ src }: { src: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading")
  return <>
    {status !== "ready" && globe}
    {status !== "failed" && <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
      onLoad={() => setStatus("ready")} onError={() => setStatus("failed")}
      className={cn("absolute size-3 rounded-full object-contain", status !== "ready" && "opacity-0")} />}
  </>
}

/** A decorative badge with the same footprint before, after, or without a favicon load. */
export function SiteIcon({ href, icon, className }: { href?: string; icon?: string; className?: string }) {
  const src = icon || faviconUrl(href)
  return (
    <span aria-hidden="true" className={cn("relative inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-current/10 align-[-0.2em]", className)}>
      {src ? <Favicon key={src} src={src} /> : globe}
    </span>
  )
}
